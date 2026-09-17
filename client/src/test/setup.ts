import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  // No test may reach the network. A component that fetches without the test
  // saying what the answer is fails loudly instead of hanging.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch not stubbed in this test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
