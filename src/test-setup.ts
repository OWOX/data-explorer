import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// CI runners are slower than a laptop: a record that loads in 0.3 s here can take over the 1 s default there.
configure({ asyncUtilTimeout: 5000 });

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
(globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class { m22 = 1; constructor() {} };
Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { get() { return 1000; } },
  offsetHeight: { get() { return 800; } },
});
