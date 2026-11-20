import { useEffect, useRef, useState } from 'react';
import {
  ExportError, isGone, reportMayExist, REPORT_GONE, sheetUrl,
  type Flight, type Stage,
} from '../../../api/exports';
import type { DestinationDto } from '../../../sdk/types';
import { errorMessage } from '../../../model/guards';
import { useServices } from '../../../state/store';

export type Result = { kind: 'ok' | 'timeout' | 'error'; text: string; url?: string };
/** The destination dialog that is open, the message of a failed attempt it shows, and a key that is new for each opening. */
type ExportDialogState = { destination: DestinationDto; error?: string; seq: number };

const STAGE_LABEL: Record<Stage, string> = { sheet: 'Creating the spreadsheet…', report: 'Saving the report…', run: 'Running the report…' };
const MAYBE_CREATED = 'The report may have been created; check OWOX before trying again.';
export const UNRECOGNISED = 'This report targets an unrecognised spreadsheet.';

/**
 * What the menu shows of an export: the stage it is in (`busy`), its outcome (`result`) and the destination dialog.
 * `follow` shows the outcome of a flight whoever started it, and a flight this mart already has under way is picked up on mount.
 * `generation` changes when the mart does or the menu goes away, so work finishing later can tell it is no longer in front of the member.
 */
export function useExportFlight(martId: string) {
  const { ctx, exporter } = useServices();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dialog, setDialog] = useState<ExportDialogState | null>(null);
  const seq = useRef(0);
  const gen = useRef(0);
  useEffect(() => { gen.current += 1; return () => { gen.current += 1; }; }, [martId]);
  const generation = () => gen.current;
  const nextSeq = () => ++seq.current;

  // An export this mart already has under way (it outlives the menu): pick it up, with the outcome of one that finished while away.
  useEffect(() => {
    const flight = exporter.inFlight(martId);
    if (flight) follow(flight, { openWhenDone: !flight.settled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exporter, martId]);

  /** Shows the outcome of an export, whoever started it. Only a menu still on the mart acts on it; the sheet is opened only when the member was there to see it finish. */
  function follow(flight: Flight, o: { fromDialog?: boolean; destination?: DestinationDto; openWhenDone: boolean }) {
    const home = gen.current;
    const here = () => gen.current === home;
    const { notes, sourceKind } = flight;
    setBusy(STAGE_LABEL[flight.stage]);
    const unsubscribe = flight.subscribe((s) => { if (here()) setBusy(STAGE_LABEL[s]); });
    flight.promise.then(async ({ report, outcome }) => {
      unsubscribe();
      if (!here()) return;
      exporter.acknowledge(martId);
      const url = sheetUrl(report) ?? undefined;
      const note = notes.length ? ` ${notes.join(' ')}` : '';
      setDialog(null);
      if (outcome.state === 'success') {
        setResult({ kind: 'ok', text: url ? `Exported to "${report.title}".${note}` : `Exported to "${report.title}", but ${UNRECOGNISED.toLowerCase()}${note}`, url });
        if (url && o.openWhenDone && here()) await ctx.ui.openExternal(url).catch(() => undefined);
      } else if (outcome.state === 'busy') {
        setResult({ kind: 'error', text: sourceKind === 'update' ? 'This report is already running. The new settings were saved but not run; try again when it finishes.' : 'This report is already running; try again when it finishes.', url });
      } else if (outcome.state === 'failed') {
        setResult({ kind: 'error', text: `The run failed: ${outcome.error}${note}`, url });
      } else {
        setResult({ kind: 'timeout', text: `Still running.${note}`, url });
      }
    }, async (e) => {
      unsubscribe();
      if (!here()) return;
      exporter.acknowledge(martId);
      const text = errorMessage(e);
      const { destination, fromDialog } = o;
      if (isGone(e)) {
        // The exporter already dropped the report from its list; the dialog, if open, stays for another choice.
        setResult({ kind: 'error', text: REPORT_GONE });
      } else if (destination && e instanceof ExportError && e.stage === 'sheet') {
        // The spreadsheet could not be made: offer the pasted-URL way instead.
        setDialog((cur) => ({ destination, error: `Could not create a spreadsheet: ${text}`, seq: cur?.seq ?? ++seq.current }));
      } else if (destination && fromDialog && e instanceof ExportError && e.stage === 'report' && !reportMayExist(e)) {
        // The spreadsheet stays: a retry reuses it instead of leaving an orphan behind.
        setDialog((cur) => ({ destination, error: text, seq: cur?.seq ?? ++seq.current }));
      } else if (reportMayExist(e)) {
        // The request may have reached OWOX: a retry could make a second report.
        setDialog(null);
        setResult({ kind: 'error', text: MAYBE_CREATED });
      } else {
        // Past this point the report exists (and may be running): a retry from the dialog would make a second one.
        setDialog(null);
        setResult({ kind: 'error', text: e instanceof ExportError && e.stage === 'run' ? `The run could not be followed: ${text}` : text });
      }
    }).finally(() => { if (here()) setBusy(null); });
  }

  return { busy, result, setResult, dialog, setDialog, follow, generation, nextSeq };
}
