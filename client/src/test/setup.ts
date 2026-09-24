import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// jsdom has neither of these. The component library relies on both regardless
// of whether a given test exercises the behavior they back (element resizing,
// prefers-reduced-motion), so without stubs any component using them throws
// on mount.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// Set directly rather than via vi.stubGlobal: afterEach below undoes
// per-test stubs with vi.unstubAllGlobals, and this polyfill needs to
// outlive every test, not just the first.
globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

beforeEach(() => {
  // No test may reach the network. A component that fetches without the test
  // saying what the answer is fails loudly instead of hanging.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch not stubbed in this test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
