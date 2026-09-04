// Prototype of the chain-sort rule decided for design.md §9.2.
// Returns the ordered legs, or null when the chain does not resolve uniquely.
function chainSort(legs) {
  const dests = new Map();            // destination ident -> count
  const byDep = new Map();            // departure ident -> [legs]
  for (const l of legs) {
    dests.set(l.dst, (dests.get(l.dst) ?? 0) + 1);
    if (!byDep.has(l.dep)) byDep.set(l.dep, []);
    byDep.get(l.dep).push(l);
  }
  // Head: exactly one leg whose departure is no leg's destination.
  const heads = legs.filter(l => !dests.has(l.dep));
  if (heads.length !== 1) return null;

  const out = [];
  const used = new Set();
  let cur = heads[0];
  while (cur) {
    if (used.has(cur)) return null;        // cycle
    used.add(cur); out.push(cur);
    const next = (byDep.get(cur.dst) ?? []).filter(l => !used.has(l));
    if (next.length === 0) break;
    if (next.length > 1) return null;      // branch — ambiguous
    cur = next[0];
  }
  return used.size === legs.length ? out : null;   // must consume all legs
}

const show = (name, legs) => {
  const r = chainSort(legs);
  console.log(name.padEnd(34), r ? '=> ' + r.map(l => l.dep + '->' + l.dst).join('  ') : '=> FALLBACK (upload order + warning)');
};

// The three real files, in the alphabetical order a file picker yields.
const real = [
  { dep: 'KSTS', dst: 'KACV' },
  { dep: 'KMRY', dst: 'KSTS' },
  { dep: 'KSBA', dst: 'KMRY' },
];
show('real 3, alphabetical', real);
show('real 3, shuffled', [real[1], real[2], real[0]]);
show('single leg', [real[2]]);
show('round trip A->B, B->A', [{dep:'KSBA',dst:'KMRY'},{dep:'KMRY',dst:'KSBA'}]);
show('out-and-back A->B,B->C,C->A', [{dep:'A',dst:'B'},{dep:'B',dst:'C'},{dep:'C',dst:'A'}]);
show('two unrelated legs', [{dep:'A',dst:'B'},{dep:'C',dst:'D'}]);
show('branch: A->B and A->C', [{dep:'A',dst:'B'},{dep:'A',dst:'C'}]);
show('repeated visit A->B,B->A,A->C', [{dep:'A',dst:'B'},{dep:'B',dst:'A'},{dep:'A',dst:'C'}]);
show('disjoint chains', [{dep:'A',dst:'B'},{dep:'B',dst:'C'},{dep:'X',dst:'Y'}]);
