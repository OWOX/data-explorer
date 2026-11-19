import { describe, it, expect, vi } from 'vitest';
import { stubCtx } from '../api/test-ctx';
import { martAppUrl } from '../config';
import { createDataMart, CreateMartError, type CreateStage } from './create';

const req = { title: 'T', storageId: 's1', sql: 'SELECT 1' };
const opts = { pollMs: 1, timeoutMs: 5 };

function setup(o: { statuses?: string[]; result?: unknown; publishFails?: boolean | Error; resultThrows?: Error } = {}) {
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  const statuses = [...(o.statuses ?? ['READY', 'PROCESSING', 'SUCCESS'])];
  const ctx = stubCtx({
    postJson: vi.fn(async (path: string, body?: unknown) => {
      calls.push(`POST ${path}`); bodies[`POST ${path}`] = body;
      return path === '/api/data-marts' ? { id: 'm1' } : { triggerId: 't1' };
    }),
    putJson: vi.fn(async (path: string, body?: unknown) => {
      calls.push(`PUT ${path}`); bodies[`PUT ${path}`] = body;
      if (o.publishFails instanceof Error && path.endsWith('/publish')) throw o.publishFails;
      if (o.publishFails && path.endsWith('/publish')) throw Object.assign(new Error('x'), { payload: { message: 'Bad SQL' } });
      return {};
    }),
    getJson: vi.fn(async (path: string) => {
      calls.push(`GET ${path}`);
      if (path.endsWith('/status')) return { status: statuses.length > 1 ? statuses.shift() : statuses[0] };
      if (o.resultThrows) throw o.resultThrows;
      return o.result ?? { success: true };
    }),
  });
  return { ctx, calls, bodies };
}

describe('createDataMart', () => {
  it('runs the five calls in order and polls until SUCCESS', async () => {
    const { ctx, calls, bodies } = setup();
    const stages: CreateStage[] = [];
    const r = await createDataMart(ctx, req, (s) => stages.push(s), { pollMs: 1, timeoutMs: 1000 });
    const b = '/api/data-marts/m1';
    const t = `${b}/schema-actualize-triggers`;
    expect(calls).toEqual([
      'POST /api/data-marts', `PUT ${b}/definition`, `POST ${t}`,
      `GET ${t}/t1/status`, `GET ${t}/t1/status`, `GET ${t}/t1/status`, `GET ${t}/t1`,
      `PUT ${b}/publish`, `PUT ${b}/availability`,
    ]);
    expect(bodies['POST /api/data-marts']).toEqual({ title: 'T', storageId: 's1' });
    expect(bodies[`PUT ${b}/definition`]).toEqual({ definitionType: 'SQL', definition: { sqlQuery: 'SELECT 1' } });
    expect(bodies[`PUT ${b}/publish`]).toEqual({});
    expect(bodies[`PUT ${b}/availability`]).toEqual({ availableForReporting: true, availableForMaintenance: false });
    expect(stages).toEqual(['create', 'define', 'schema', 'publish', 'share']);
    expect(r).toEqual({ id: 'm1', url: martAppUrl('p1', 'm1') });
  });

  it('fails the schema stage with the server error and the mart id', async () => {
    const { ctx } = setup({ statuses: ['SUCCESS'], result: { success: false, error: 'Syntax error at 3:1' } });
    const e = await createDataMart(ctx, req, undefined, opts).catch((x) => x);
    expect(e).toBeInstanceOf(CreateMartError);
    expect(e).toMatchObject({ stage: 'schema', martId: 'm1', message: 'Syntax error at 3:1' });
  });

  it('on status ERROR reads the trigger and surfaces its reason', async () => {
    const { ctx, calls } = setup({ statuses: ['ERROR'], result: { success: false, error: 'Unrecognized name: foo' } });
    await expect(createDataMart(ctx, req, undefined, opts)).rejects.toMatchObject({ stage: 'schema', martId: 'm1', message: 'Unrecognized name: foo' });
    expect(calls.at(-1)).toBe('GET /api/data-marts/m1/schema-actualize-triggers/t1');
  });

  it('on status ERROR with a failing trigger read, uses the thrown message', async () => {
    const { ctx } = setup({ statuses: ['ERROR'], resultThrows: Object.assign(new Error('Request failed with 500'), { payload: { message: 'Table not found' } }) });
    await expect(createDataMart(ctx, req, undefined, opts)).rejects.toMatchObject({ stage: 'schema', message: 'Table not found' });
  });

  it('on status ERROR with no usable reason, points to the draft', async () => {
    const generic = 'OWOX could not read the columns of this SQL. Open the draft to see why.';
    const nest = Object.assign(new Error('Bad Request Exception'), { payload: { code: 'HTTP_ERROR', status: 400, message: 'Bad Request Exception', apiCode: 'SOME_CODE' } });
    for (const o of [{ result: { success: false } }, { result: { success: false, error: '' } }, { result: { success: false, error: 'Bad Request Exception' } }, { resultThrows: new Error('Request failed with status code 500') }, { resultThrows: nest }]) {
      const { ctx } = setup({ statuses: ['ERROR'], ...o });
      await expect(createDataMart(ctx, req, undefined, opts)).rejects.toMatchObject({ stage: 'schema', martId: 'm1', message: generic });
    }
  });

  it('fails any other terminal non-success status', async () => {
    const { ctx } = setup({ statuses: ['CANCELLED'] });
    await expect(createDataMart(ctx, req, undefined, opts)).rejects.toMatchObject({ stage: 'schema', martId: 'm1', message: 'Reading the columns ended with status CANCELLED.' });
  });

  it('resumes from schema with a fresh trigger', async () => {
    const { ctx, calls } = setup();
    await createDataMart(ctx, { ...req, martId: 'm1', from: 'schema' }, undefined, opts);
    expect(calls[0]).toBe('POST /api/data-marts/m1/schema-actualize-triggers');
    expect(calls).not.toContain('POST /api/data-marts');
    expect(calls.at(-2)).toBe('PUT /api/data-marts/m1/publish');
  });

  it('treats an already-published mart as published and shares it', async () => {
    for (const err of [Object.assign(new Error('x'), { payload: { code: 'HTTP_ERROR', status: 400, message: 'Bad Request Exception', apiCode: 'DATA_MART_ALREADY_PUBLISHED' } }), Object.assign(new Error('x'), { payload: { message: 'Data Mart is already published' } })]) {
      const { ctx, calls } = setup({ publishFails: err });
      const r = await createDataMart(ctx, { ...req, martId: 'm1', from: 'publish' }, undefined, opts);
      expect(r.id).toBe('m1');
      expect(calls.at(-1)).toBe('PUT /api/data-marts/m1/availability');
    }
  });

  it('times out while the status stays PROCESSING', async () => {
    const { ctx } = setup({ statuses: ['PROCESSING'] });
    await expect(createDataMart(ctx, req, undefined, opts)).rejects.toMatchObject({
      stage: 'schema', martId: 'm1', message: 'OWOX is still reading the columns. Open the data mart to publish it.',
    });
  });

  it('fails publish with its stage, mart id and server message', async () => {
    const { ctx } = setup({ publishFails: true });
    await expect(createDataMart(ctx, req, undefined, opts)).rejects.toMatchObject({ stage: 'publish', martId: 'm1', message: 'Bad SQL' });
  });

  it('resumes from publish with only publish and availability', async () => {
    const { ctx, calls } = setup();
    const r = await createDataMart(ctx, { ...req, martId: 'm1', from: 'publish' }, undefined, opts);
    expect(calls).toEqual(['PUT /api/data-marts/m1/publish', 'PUT /api/data-marts/m1/availability']);
    expect(r.id).toBe('m1');
  });

  it('stops polling when the signal aborts', async () => {
    const { ctx } = setup({ statuses: ['PROCESSING'] });
    const ac = new AbortController();
    const p = createDataMart(ctx, { ...req, signal: ac.signal }, undefined, { pollMs: 1, timeoutMs: 60_000 });
    setTimeout(() => ac.abort(), 5);
    await expect(p).rejects.toMatchObject({ stage: 'schema', martId: 'm1' });
  });
});
