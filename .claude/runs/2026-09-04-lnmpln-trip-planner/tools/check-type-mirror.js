#!/usr/bin/env node
/*
 * Detects drift between the server's row types (src/types.ts) and the client's
 * hand-maintained mirror (client/src/types.ts).
 *
 * Why this exists: plan.json flags the mirror as a real risk — "client/src/types.ts
 * is hand-maintained; a drift between it and src/types.ts will not be caught by
 * any test". There is no test framework in this project, and tsc cannot catch it
 * either: the two files are separate compilation units that never import each
 * other, so a client field typed `string` against a server `string | null` is
 * invisible until it renders "null" on the page.
 *
 * Compares field names and normalised types. Optional (`f?: T`) is treated as
 * equivalent to `T | undefined` so the two spellings do not read as drift.
 *
 * Usage: node check-type-mirror.js [repo-root]
 * Exit 0 = no drift, 1 = drift found.
 */
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.resolve(__dirname, '../../../..');
const INTERFACES = ['PlannedLeg', 'PlannedWaypoint', 'PlannedAlternate'];

function parse(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const name of INTERFACES) {
    const m = src.match(new RegExp(`export interface ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`));
    if (!m) continue;
    const fields = {};
    for (const line of m[1].split('\n')) {
      const f = line.match(/^\s*(\w+)(\?)?\s*:\s*(.+?);/);
      if (!f) continue;                        // skips comments and blank lines
      const [, key, optional, rawType] = f;
      const parts = rawType.split('|').map(s => s.trim()).filter(Boolean);
      if (optional) parts.push('undefined');
      fields[key] = [...new Set(parts)].sort().join(' | ');
    }
    out[name] = fields;
  }
  return out;
}

const server = parse(path.join(root, 'src/types.ts'));
const client = parse(path.join(root, 'client/src/types.ts'));

let problems = 0;
for (const name of INTERFACES) {
  const s = server[name], c = client[name];
  if (!s) { console.log(`- ${name}: MISSING from src/types.ts`); problems++; continue; }
  if (!c) { console.log(`- ${name}: MISSING from client/src/types.ts (server has ${Object.keys(s).length} fields)`); problems++; continue; }

  const missing = Object.keys(s).filter(k => !(k in c));
  const extra   = Object.keys(c).filter(k => !(k in s));
  const differ  = Object.keys(s).filter(k => k in c && s[k] !== c[k]);

  if (!missing.length && !extra.length && !differ.length) {
    console.log(`- ${name}: OK (${Object.keys(s).length} fields match)`);
    continue;
  }
  problems++;
  console.log(`- ${name}: DRIFT`);
  for (const k of missing) console.log(`    missing on client: ${k}: ${s[k]}`);
  for (const k of extra)   console.log(`    extra on client:   ${k}: ${c[k]}`);
  for (const k of differ)  console.log(`    type differs:      ${k}\n        server: ${s[k]}\n        client: ${c[k]}`);
}

console.log(problems === 0 ? '\nNo drift.' : `\n${problems} interface(s) with drift.`);
process.exit(problems === 0 ? 0 : 1);
