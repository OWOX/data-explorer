# Deep join paths in the AI pipeline, and counts on pass-through cards

No separate spec: this plan carries the requirements.

## Global Constraints

1. Tests run with Vitest, capped: `npx vitest run --poolOptions.threads.maxThreads=4 <files>`. Never run unbounded.
2. `npx tsc -b` and `npx eslint <changed files>` must pass.
3. Code comments follow the repo's style: plain sentences, no filler.
4. No new dependency.

## Task 1: The path step offers joined marts up to depth 4, one route per mart

**Problem.** Query "which problem topics drives qualified users?" picks 🥈 User | Entity as main. Problem Topic | Entity is first
reachable from it at depth 4 (`contact_entity.first_session.page.problem_topic`), but `src/search/steps/path.ts` keeps only
sources with `depth <= PATH_DEPTH` (2), so the AI is never asked about it. The same mart is also reachable by several deeper
routes, some of which multiply the main rows (through Pageview, many sessions per visitor).

**Files.** `src/search/steps/path.ts`, `src/search/steps/path.test.ts`, `src/search/words.ts` and its test.

**Requirements.**
1. `PATH_DEPTH = 4`.
2. In `pathCandidates`, keep one candidate per `martId`: among that mart's sources within `PATH_DEPTH`, prefer
   `mainGrainMultiplication === 'none'`, then the smallest `depth`, then the original order. Apply this before the word sort
   and the `MAX_QUESTIONS` cap.
3. Word matching tolerates a plural: in `words.ts` `overlap`, a word ending in "s" (length > 3) also matches its form without
   the trailing "s", in both directions ("topics" ↔ "topic"). Keep `words()` itself unchanged.
4. Nothing else in the step changes: `applyPath` still keeps the best `PATH_KEEP` (5), and the join tree adds the bare parents.
5. Tests: update the existing depth test (it asserts depth 2 or less) to depth 4; add a test that a mart reachable by a
   depth-3 multiplying route and a depth-4 non-multiplying route yields one candidate, the depth-4 one; add a test that a
   depth-4 source whose title shares a word with the query sorts first; add an `overlap` test for "topics" vs "Problem Topic".

## Task 2: Pass-through cards in the join tree get their count and quality

**Problem.** In the join tree, a mart that the path passes through but that has no column on the grid (a bare node, e.g.
Contact and Contact First Session on the way to Problem Topic) never gets a record count: it shows "Waiting to count
records" forever. `src/ui/App.tsx` passes only `visible.ids` to `useCardStatus`; bare nodes are not in it, so the queue in
`src/ui/useModelData.ts` drops their request as "no longer shown", and their data-quality summary is never loaded either.

**Files.** `src/ui/App.tsx`, and a test (`src/ui/useModelData.test.tsx` or a page test, whichever fits).

**Requirements.**
1. In `App.tsx`, build the ids passed to `useCardStatus` as `visible.ids` plus every `martId` of the join tree's nodes
   (`buildJoinTree` from `src/state/join-tree.ts`, called with the same arguments `CardBands` uses for its `canvasTree`),
   deduplicated, `visible.ids` order first. Memoise it.
2. Do not change `computeVisible`: the band's own list and its count stay as they are.
3. Test: a join tree with a bare node gets that node's mart counted (state reaches `ok`), where before it stayed idle.
