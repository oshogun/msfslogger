const { XMLParser } = require('fast-xml-parser');
const fs = require('fs'), path = require('path');

// The config frozen in design.md §5.1 — verbatim.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name, jpath) => [
    'LittleNavmap.Flightplan.Waypoints',
    'LittleNavmap.Flightplan.Waypoints.Waypoint',
    'LittleNavmap.Flightplan.Alternates',
    'LittleNavmap.Flightplan.Alternates.Alternate',
  ].includes(jpath),
});

const R = 3440.065;
const hav = (a,b,c,d) => { const t=x=>x*Math.PI/180, dLa=t(c-a), dLo=t(d-b);
  const h=Math.sin(dLa/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(dLo/2)**2;
  return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)); };

const dir = '/home/guilherme/msfslogger';
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.lnmpln'))) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '');
  const o = parser.parse(raw);
  const fp = o?.LittleNavmap?.Flightplan;
  const h = fp?.Header ?? {};
  const wps = (fp?.Waypoints ?? []).flatMap(b => b.Waypoint ?? []);
  const dep = wps[0], dst = wps[wps.length - 1];
  const num = v => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : n; };
  let dist = 0;
  for (let i = 1; i < wps.length; i++)
    dist += hav(num(wps[i-1].Pos['@_Lat']), num(wps[i-1].Pos['@_Lon']),
                num(wps[i].Pos['@_Lat']),   num(wps[i].Pos['@_Lon']));

  console.log('---', f);
  console.log('  FileVersion=%s  prog=%s  type=%s  cruise=%s/%s  ac=%s',
    h.FileVersion, fp.ProgramVersion ?? h.ProgramVersion, h.FlightplanType,
    h.CruisingAltF, h.CruisingAlt, fp.AircraftPerformance?.Type);
  console.log('  CreationDate=%s -> %s', h.CreationDate, new Date(h.CreationDate).toISOString());
  console.log('  Departure elem present: %s | Procedures: %s | Alternates: %s',
    fp.Departure !== undefined, fp.Procedures !== undefined, fp.Alternates !== undefined);
  console.log('  waypoints=%d  blocks=%d', wps.length, (fp.Waypoints ?? []).length);
  console.log('  dep=%s(%s) isAirport=%s   dst=%s(%s) isAirport=%s',
    dep.Ident, typeof dep.Ident, dep.Type === 'AIRPORT',
    dst.Ident, typeof dst.Ident, dst.Type === 'AIRPORT');
  console.log('  approx distance = %s nm', dist.toFixed(1));
  console.log('  idents:', wps.map(w => `${w.Ident}:${w.Type}`).join(' '));
  console.log('  AircraftPerformance.FilePath present:', fp.AircraftPerformance?.FilePath !== undefined);
}
