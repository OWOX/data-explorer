import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ErrorBox, errorMessage } from './ErrorBox';
import { buildErrorReport } from './errorDetails';
import { TooltipProvider } from './Tooltip';

class TransportError extends Error {
  constructor(public payload: Record<string, unknown>) { super(String(payload.message)); this.name = 'PluginTransportError'; }
}
class ApiError extends Error {
  constructor(message: string, public details: unknown, options: { cause: unknown }) { super(message, options); this.name = 'OWOXApiError'; }
}
const failure = () => new ApiError('Failed to open OWOX Data Mart data stream', { dataMartId: 'dm-1' },
  { cause: new TransportError({ code: 'FORBIDDEN', message: 'No access to this data mart', status: 403, token: 'sekret' }) });

test('errorMessage adds each cause with its code and status', () => {
  expect(errorMessage(failure())).toBe('Failed to open OWOX Data Mart data stream: No access to this data mart (FORBIDDEN, 403)');
  expect(errorMessage(new Error('boom'))).toBe('boom');
  expect(errorMessage(new Error('same', { cause: new Error('same') }))).toBe('same');
});

test('the report lists the chain, details, request and run id, and leaves credentials out', () => {
  const text = buildErrorReport(failure(), { dataMartId: 'dm-1', runId: 'run-9', options: { column: ['a'], limit: 51 } }, new Date('2026-11-20T10:00:00Z'));
  expect(text).toMatchInlineSnapshot(`
    "Data Explorer error report
    time: 2026-11-20T10:00:00.000Z
    plugin version: dev

    name: OWOXApiError
    message: Failed to open OWOX Data Mart data stream
    details: {"dataMartId":"dm-1"}

    cause 1:
      name: PluginTransportError
      message: No access to this data mart
      code: FORBIDDEN
      status: 403
      payload: {"code":"FORBIDDEN","message":"No access to this data mart","status":403,"token":"[redacted]"}

    request:
    data mart id: dm-1
    run id: run-9
    traverse options: {
      "column": [
        "a"
      ],
      "limit": 51
    }"
  `);
  expect(text).not.toContain('sekret');
});

test('the copy button writes the report and confirms', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<TooltipProvider><ErrorBox error={failure()} onRetry={() => undefined} context={{ dataMartId: 'dm-1' }} /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Copy error details' }));
  await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
  expect(writeText).toHaveBeenCalledTimes(1);
  const copied = writeText.mock.calls[0]?.[0] as string;
  expect(copied).toContain('data mart id: dm-1');
  expect(copied).toContain('FORBIDDEN');
});

test('the report masks bearer values, JWTs and token-like query parameters inside strings', () => {
  const jwt = 'eyJhbGciOi.eyJzdWIiOiIx.c2ln_na-ture';
  const err = new Error('failed');
  (err as Error & { details?: unknown }).details = { note: `Authorization failed: Bearer abc.def ${jwt}`, url: 'https://x.io/a?id=1&access_token=zzz&api_key=yyy&sig=qq&page=2' };
  const text = buildErrorReport(err, {}, new Date(0));
  for (const s of ['abc.def', jwt, 'zzz', 'yyy', '=qq']) expect(text).not.toContain(s);
  expect(text).toContain('id=1');
  expect(text).toContain('page=2');
});
