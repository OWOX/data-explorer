import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

const CI = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CI;

// CI runners are much slower than a laptop: a wait that takes 0.3 s here can take over 5 s on the build server.
configure({ asyncUtilTimeout: CI ? 15000 : 5000 });

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
(globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class { m22 = 1; constructor() {} };
Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { get() { return 1000; } },
  offsetHeight: { get() { return 800; } },
});
