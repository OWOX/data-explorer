import { withJoined } from '../api/blendable';
import type { ChartSettingsStore } from '../api/chart-settings';
import type { GridState } from '../state/store';
import { readIntent, type Intent } from './intent';
import { mergeCharts, runCharts } from './steps/charts';
import { runFields } from './steps/fields';
import { runMain } from './steps/main';
import { runPath } from './steps/path';
import { runShape } from './steps/shape';
import type { StepDeps, StepInput } from './steps/types';

export type Progress = 'main' | 'path' | 'fields' | 'filters' | 'charts';
export type PipelineHost = {
  open(martId: string): Promise<GridState | null>;
  fill(martId: string, expect: GridState, grid: GridState): void;
  progress(p: Progress | null): void;
  alternatives(ids: string[]): void;
  chartSettings: Pick<ChartSettingsStore, 'load' | 'save'>;
};
export type PipelineResult = { status: 'done' | 'failed' | 'aborted' | 'nothing'; intent: Intent };

/** Steps 0 to 5 in order. Each fill expects the grid the previous one set, so an edit made meanwhile stops the rest in the reducer. */
export async function runPipeline(raw: Omit<StepInput, 'intent'> & { intent?: Intent; mainId?: string }, deps: StepDeps, host: PipelineHost): Promise<PipelineResult> {
  const off = () => deps.signal.aborted;
  const intent = raw.intent ?? await readIntent(deps.fast, raw.query, deps.signal);
  const input: StepInput = { query: raw.query, hits: raw.hits, model: raw.model, intent };
  if (off()) return { status: 'aborted', intent };
  const end = (status: PipelineResult['status']): PipelineResult => { if (status !== 'aborted') host.progress(null); return { status, intent }; };

  let mainId = raw.mainId ?? null;
  if (!mainId) {
    host.progress('main');
    const main = await runMain(input, deps);
    if (off()) return end('aborted');
    if (!main.martId) return end('nothing');
    mainId = main.martId;
    host.alternatives(main.alternatives);
    if (main.failed) { const g = await host.open(mainId); return end(g ? 'failed' : 'nothing'); }
  }
  let grid = await host.open(mainId);
  if (off()) return end('aborted');
  if (!grid) return end('nothing');

  host.progress('path');
  const path = await runPath(input, deps, mainId);
  if (off()) return end('aborted');
  if (path.failed) return end('failed');

  host.progress('fields');
  const native = await deps.schemas.get(mainId);
  if (off()) return end('aborted');
  const fields = await runFields(input, deps, { schema: native, title: raw.model.marts.get(mainId)?.title ?? mainId }, path.sources);
  if (off()) return end('aborted');
  const sources = path.sources.filter((s) => fields.keptPaths.includes(s.aliasPath));
  const schema = withJoined(native, path.all);
  const withFields: GridState = { ...grid, columns: fields.columns };
  host.fill(mainId, grid, withFields);
  grid = withFields;
  if (fields.failedMain) return end('failed');

  host.progress('filters');
  const shape = await runShape(input, deps, mainId, { schema, columns: fields.columns, needed: fields.needed, sources });
  if (off()) return end('aborted');
  host.fill(mainId, grid, shape.grid);
  grid = shape.grid;
  if (shape.failed) return end('failed');

  host.progress('charts');
  const charts = await runCharts(input, deps, grid, schema);
  if (off()) return end('aborted');
  if (charts.failed) return end('failed');
  if (charts.picked.length) {
    const saved = await host.chartSettings.load(mainId);
    if (off()) return end('aborted');
    host.chartSettings.save(mainId, mergeCharts(saved, charts.picked));
    host.fill(mainId, grid, { ...grid, view: 'charts' });
  }
  return end('done');
}
