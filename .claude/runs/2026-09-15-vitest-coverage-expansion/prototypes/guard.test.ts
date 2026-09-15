import { describe, it, expect } from 'vitest';
import { SIDE_EFFECTS, fmt } from './guarded-cli';

describe('require.main guard under vitest', () => {
  it('does not run main() on import', () => {
    expect(SIDE_EFFECTS).toEqual([]);
  });
  it('still exposes the helper', () => {
    expect(fmt(125)).toBe('2m 05s');
  });
  it('reports what require/module look like here', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.info('typeof require =', typeof require, '| typeof module =', typeof module,
      '| require.main =', typeof require !== 'undefined' ? String((require as any).main && (require as any).main.filename) : 'n/a');
    expect(true).toBe(true);
  });
});
