import { expect, it } from 'vitest';
import { pickModels, pipelineReady } from '../search/ai';
import type { Ctx } from './types';
import manifest from '../../plugin.json';
// The package does not export this: the mock context always has a decision model, so only the real SDK shows that it builds one.
import { createPluginCredentials } from '../../node_modules/@owox/plugin-sdk/dist/credentials.js';

it('the installed SDK builds every model the manifest declares, so the pipeline is ready', () => {
  const models = manifest.credentials[0]!.models as ('fast' | 'decision')[];
  const credentials = createPluginCredentials({ send: () => Promise.reject(new Error('not called')) } as never, [{ name: 'ai', kind: 'ai', models }]);
  expect(pipelineReady(pickModels({ credentials } as unknown as Ctx))).toBe(true);
});
