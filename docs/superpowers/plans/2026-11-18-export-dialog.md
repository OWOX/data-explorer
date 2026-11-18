# Export Dialog Implementation Plan

**Goal:** Rework the Export menu in the Data band: new order, one dialog per Google Sheets destination instead of a flyout, a "Recently used" report, report data read live from OWOX on demand, toasts at the top center in the host's style, and the menu closing on any outside click.

**Spec:** the user's decisions in this session, restated in Global Constraints below. They are binding.

## Global Constraints

1. Menu order: group 1 is Claude, ChatGPT (each with its external-link button, as today). Separator. Group 2 is one item per Google Sheets destination (Sheets icon, destination title, no chevron). Separator. Group 3 is "Copy to clipboard", then "Copy SQL". Separators use the existing `.dm-menu-sep` element (`<div role="separator" className="dm-menu-sep" />`). A separator next to an empty group is not rendered (no destinations means one separator between AIs and copy items).
2. A destination item closes the menu and opens the export dialog for that destination. There is no second-level menu. Remove the flyout code (`openDest`, `flyout`, the flyout layout effect, `flyoutOf`, flyout keyboard handling, `.dm-cascade-sub/-left/-right/-row` CSS that becomes unused).
3. Export dialog, titled "Export to {destination title}", has three radio options:
   1. "New spreadsheet"
   2. "Existing spreadsheet" (shows the spreadsheet link field and its hint, as today)
   3. "Update existing report" (shows this mart's reports whose live destination is this destination)
   The report title field shows only for options 1 and 2. Option 3 updates the chosen report keeping its OWOX title. Validation messages and the failed-spreadsheet fallback behave as today's NewReportDialog.
4. Stored data: the member-scoped `exports` collection document per mart becomes `{ reports: { reportId: string; usedAt?: string }[] }`. `usedAt` is an ISO timestamp. Nothing else is stored: destination, spreadsheet id, sheet id and title are read live from `GET /api/reports/{id}` only. Older documents with extra fields are read as `{ reportId, usedAt }` (extra fields ignored, no `usedAt` means never used); the next save writes the slim shape.
5. `usedAt` is set to now whenever an export writes to a report: when a new report is created (new or existing spreadsheet) and when an existing report is updated (after the PUT succeeds, before the run).
6. "Recently used" = `usedAt` within the last 60 days (`RECENT_MS = 60 * 24 * 60 * 60 * 1000`). In the dialog, if this destination has a recently used report: option 3 is first and preselected, its most recent report is preselected and carries a "Recently used" badge (only that one report). Otherwise the order is 1, 2, 3 with option 1 preselected. Reports in option 3 are ordered by `usedAt` descending, never-used last.
7. Live report reads: start on the first open of the Export menu for a mart (not on mart load), all in parallel, cached per mart for the session (the exporter outlives the menu). Later openings read nothing. The cache for a mart is re-read after an export to that mart finishes, and dropped for all marts on a model reload (the existing `modelVersion` change that calls `exporter.invalidate()`). Closing the dialog does not cancel the session reads; it only stops listening.
8. The dialog opens immediately. While reads are pending, option 3 shows skeleton rows with "Loading reports…" and cannot be chosen. Each report appears as soon as its own read returns. A failed read (not 404) shows "Couldn't load" with an inline Retry that re-reads that report only. A 404 read drops the report from the list and the stored document. A report whose live target is not a plain spreadsheet id is listed but disabled with "Unrecognised spreadsheet".
9. Ordering before live data: the stored `usedAt` is known without OWOX. If any of this mart's reports has a recent `usedAt`, option 3 starts first and preselected (still loading). When live data shows the recent report is not in this destination (or the reads finish with no recent report here), option 3 moves back to last and option 1 is selected, but only if the member has not changed the selection in the dialog yet.
10. Update of a report OWOX no longer has (PUT returns 404): drop it from the list, the session cache and the stored document, close nothing else, and show the error toast text "This report no longer exists in OWOX".
11. Outside click: the menu closes on a `pointerdown` anywhere outside it, listened on `document` in the capture phase, and on `window` `blur` (a click in the host page outside the plugin frame). Escape keeps working. Only the Export menu changes.
12. Toasts (src/ui/Toast.tsx, shared by every plugin toast): the stack moves to the top center (fixed, top 1rem, horizontally centered, z-index unchanged). The card takes the host app's react-hot-toast look: pill (border-radius 32px), no shadow, padding 0.4rem 1rem, max width 800px, font size 0.875rem, a 1px solid bottom border only. A new optional `tone` prop: `'success'` (bg #ECFDF5, text #166534, bottom border #D6DFE6), `'error'` (bg #FEE2E2, text #991B1B, border #EAD1D1), `'info'` (bg #E8EDFB, text #1D4ED8, border #CAD5F6); no tone is a neutral card using existing tokens. Dark mode: define tone colours as CSS custom properties with dark variants that keep the same hue family and pass contrast. Timer, Dismiss, actions, `hold`, `persistent`, focus return and the `dm-toast-stack` id stay as they are. Export menu tones: ok and copied-ok are success, error and copy failures are error, timeout ("Still running") is info.
13. No new dependencies; no change to plugin.json or src/sdk/types.ts.
14. Tests: `npx vitest run` (config caps workers at 4); `npx tsc --noEmit`; `npx eslint .`; e2e `npx playwright test --workers=1 --trace off` only for specs that touch the export menu or toasts. Tests are updated to the new behaviour, never deleted to get green.
15. Plain English in commits and comments, no em dashes. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 1: Exporter storage and the session report cache (src/api/exports.ts)

Implement constraints 4, 5, 7 (cache side), 8 (data side), 10 (data side).

1. Stored type `StoredReport = { reportId: string; usedAt?: string }`; document `{ reports: StoredReport[] }`. Reading tolerates old documents (keep `reportId`, keep `usedAt` only when it is a string).
2. `ExportedReport` (live) = `{ reportId, destinationId, spreadsheetId, sheetId, title, usedAt? }`, built only from a live read plus the stored `usedAt`.
3. Replace `reports(martId, verify?)` with a session cache API the UI can subscribe to, for example:
   - `stored(martId): Promise<StoredReport[]>` (no OWOX call),
   - `load(martId): void` starts the parallel live reads once per mart per session (idempotent),
   - `entries(martId): ReportEntry[]` where `ReportEntry = { reportId; usedAt?; state: 'loading' | 'ready' | 'failed'; report?: ExportedReport }` (404s are removed and saved away),
   - `subscribe(martId, cb): () => void` notified on each change,
   - `retry(martId, reportId): void`,
   - `forget(martId, reportId): Promise<void>` removes from cache and document.
   Exact names are the implementer's call; keep the interface small and documented.
4. `invalidate()` also drops every mart's live cache. After `run()` settles, the mart's live cache is re-read (a fresh `load`).
5. `run()` with `source.kind === 'update'`: set `usedAt` after the PUT succeeds; a 404 from the PUT throws an `ExportError('report', ...)` that the UI can recognise as gone (add `gone: true` or a helper `isGone(e)`), and the exporter forgets the report. New reports are saved as `{ reportId, usedAt: now }`.
6. Update `src/api/exports.test.ts` and anything else that used the old API outside ExportMenu.tsx (ExportMenu.tsx itself is Task 3, but keep the build compiling: a minimal adaptation in ExportMenu.tsx that keeps today's menu working is allowed).

### Task 2: Toast at the top center in the host style (src/ui/Toast.tsx)

Implement constraint 12 except the Export menu tone mapping (Task 3). Update src/ui/Toast.test.tsx and any test asserting the old position classes.

### Task 3: Export menu and dialog (src/ui/explorer/ExportMenu.tsx, src/ui/bands/bands.css)

Implement constraints 1, 2, 3, 6, 7 (trigger), 8, 9, 10 (UI), 11, and the tone mapping of 12, on top of Tasks 1 and 2. Update src/ui/explorer/ExportMenu.test.tsx and e2e specs that drive the export menu (e2e/smoke.spec.ts and any other spec using the flyout or "New report…"). Cover: menu order and separators; destination click opens the dialog; three options and title-field visibility; recent report on top with badge and preselection; 60-day boundary; loading skeleton then progressive rows; failed read with Retry; 404 drop; option 3 moving back when the recent report is in another destination and the member had not touched the selection, and staying when they had; outside pointerdown and window blur close the menu; toast tones.
