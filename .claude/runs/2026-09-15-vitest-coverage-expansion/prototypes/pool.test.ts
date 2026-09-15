import { describe, it, expect } from 'vitest';
import wt from 'worker_threads';
describe('pool shape', () => {
  it('reports isolation model', () => {
    console.info(`pid=${process.pid} isMainThread=${wt.isMainThread} threadId=${wt.threadId}`);
    expect(true).toBe(true);
  });
});
