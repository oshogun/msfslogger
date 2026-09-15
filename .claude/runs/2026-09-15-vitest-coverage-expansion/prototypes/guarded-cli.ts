// Prototype: does `if (require.main === module)` survive Vitest's transform?
// Mimics src/backfill-durations.ts: ES import syntax, a main() with a side
// effect, an unexported helper we want to test.
import path from 'path';

export const SIDE_EFFECTS: string[] = [];

export function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}m ${String(sec % 60).padStart(2, '0')}s`;
}

function main(): void {
  SIDE_EFFECTS.push('main ran');
  console.log('MAIN_RAN ' + path.basename(__filename));
}

if (require.main === module) {
  main();
}
