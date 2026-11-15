import '@testing-library/jest-dom/vitest';

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
(globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class { m22 = 1; constructor() {} };
Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { get() { return 1000; } },
  offsetHeight: { get() { return 800; } },
});
