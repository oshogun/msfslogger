import type { AcarsMessage, CannedAcarsMessage } from '../types';

let nextId = 1;
function msg(
  m: Pick<AcarsMessage, 'direction' | 'category' | 'body' | 'sent_at'> & Partial<AcarsMessage>,
): AcarsMessage {
  return {
    id: nextId++, flight_id: null, planned_leg_id: null, label: null, payload_json: null,
    correlation_id: null, dedup_key: null, read_at: null, ...m,
  };
}

const METAR_SBPA = 'SBPA 231300Z 17008KT 9999 FEW030 SCT100 21/14 Q1017';
const wxPayload = (icao: string, metar: string, taf: string | null) =>
  JSON.stringify({ icao, metar, taf, fetched_at: '2026-09-23T13:10:00.000Z' });

export const SEED_ACARS: AcarsMessage[] = [
  // Pre-flight thread for leg 3 (ESSA -> EFHK), no flight yet.
  msg({ planned_leg_id: 3, direction: 'downlink', category: 'freetext', label: 'FREE TEXT', body: 'Planning the Stockholm return, any slot restrictions?', sent_at: '2026-09-20T09:00:00.000Z' }),
  msg({ planned_leg_id: 3, direction: 'uplink', category: 'dispatch', label: 'DISPATCH', body: 'No restrictions for ESSA departures. Expect runway 19R.', sent_at: '2026-09-20T09:01:10.000Z' }),
  // Flight 1 (EFHK -> EETN).
  msg({ flight_id: 1, direction: 'downlink', category: 'oooi', label: 'OUT', body: 'OUT 0802Z EFHK', sent_at: '2026-08-12T08:02:00.000Z' }),
  msg({ flight_id: 1, direction: 'downlink', category: 'oooi', label: 'OFF', body: 'OFF 0811Z EFHK', sent_at: '2026-08-12T08:11:00.000Z' }),
  msg({ flight_id: 1, direction: 'downlink', category: 'oooi', label: 'ON', body: 'ON 0832Z EETN', sent_at: '2026-08-12T08:32:00.000Z' }),
  msg({ flight_id: 1, direction: 'downlink', category: 'oooi', label: 'IN', body: 'IN 0838Z EETN', sent_at: '2026-08-12T08:38:00.000Z' }),
  // Flight 2.
  msg({ flight_id: 2, direction: 'uplink', category: 'freetext', label: 'FREE TEXT', body: 'Welcome to Sweden. Enjoy the flight.', sent_at: '2026-08-12T11:29:00.000Z' }),
  // Flight 13 (in progress, SBCT -> SBPA, leg 13).
  msg({ planned_leg_id: 13, direction: 'downlink', category: 'wx', label: 'REQUEST WX SBCT', body: 'REQUEST WX SBCT', sent_at: '2026-09-23T12:52:00.000Z' }),
  msg({ planned_leg_id: 13, direction: 'uplink', category: 'wx', label: 'WX SBCT', body: 'SBCT 231250Z 15006KT 9999 SCT040 19/12 Q1019', payload_json: wxPayload('SBCT', 'SBCT 231250Z 15006KT 9999 SCT040 19/12 Q1019', null), sent_at: '2026-09-23T12:52:05.000Z' }),
  msg({ planned_leg_id: 13, direction: 'downlink', category: 'pdc', label: 'REQUEST CLEARANCE', body: 'REQUEST CLEARANCE SBCT-SBPA', sent_at: '2026-09-23T13:00:00.000Z' }),
  msg({ planned_leg_id: 13, direction: 'uplink', category: 'pdc', label: 'PDC', body: 'CLEARED TO SBPA VIA TNOL1A, ROUTE AS FILED. CLIMB FL350. SQUAWK 4521.', payload_json: JSON.stringify({ v: 1, departure_icao: 'SBCT', destination_icao: 'SBPA', route: 'TNOL1A UZ21 ISOB1A', initial_altitude_ft: 5000, squawk: '4521' }), correlation_id: 10, sent_at: '2026-09-23T13:00:07.000Z' }),
  msg({ flight_id: 13, direction: 'downlink', category: 'oooi', label: 'OUT', body: 'OUT 1322Z SBCT', sent_at: '2026-09-23T13:22:00.000Z' }),
  msg({ flight_id: 13, direction: 'downlink', category: 'oooi', label: 'OFF', body: 'OFF 1331Z SBCT', sent_at: '2026-09-23T13:31:00.000Z' }),
  msg({ flight_id: 13, direction: 'downlink', category: 'position-report', label: 'POSITION', body: 'POS 2718S 04953W FL240 1338Z', payload_json: JSON.stringify({ lat: -27.3, lon: -49.88, altitude_ft: 24000 }), sent_at: '2026-09-23T13:38:00.000Z' }),
  msg({ flight_id: 13, direction: 'uplink', category: 'dispatch', label: 'DISPATCH', body: 'Weather deteriorating at SBPA after 1500Z. Alternate SBCT.', sent_at: '2026-09-23T13:41:00.000Z' }),
  msg({ flight_id: 13, direction: 'downlink', category: 'freetext', label: 'FREE TEXT', body: 'Copy, monitoring. Request higher when able.', sent_at: '2026-09-23T13:42:30.000Z' }),
  msg({ flight_id: 13, direction: 'uplink', category: 'freetext', label: 'FREE TEXT', body: 'Climb approved FL370 when ready.', sent_at: '2026-09-23T13:43:00.000Z' }),
  msg({ flight_id: 13, direction: 'downlink', category: 'wx', label: 'REQUEST WX SBPA', body: 'REQUEST WX SBPA', sent_at: '2026-09-23T13:44:00.000Z' }),
  msg({ flight_id: 13, direction: 'uplink', category: 'wx', label: 'WX SBPA', body: METAR_SBPA, payload_json: wxPayload('SBPA', METAR_SBPA, 'TAF SBPA 231100Z 2312/2418 17008KT 9999 SCT030'), correlation_id: 18, sent_at: '2026-09-23T13:44:04.000Z' }),
  msg({ flight_id: 13, direction: 'downlink', category: 'position-report', label: 'POSITION', body: 'POS 2801S 04942W FL370 1348Z', sent_at: '2026-09-23T13:48:00.000Z' }),
  // Flight 7 (diverted).
  msg({ flight_id: 7, direction: 'downlink', category: 'freetext', label: 'FREE TEXT', body: 'Diverting to SBJP, weather at SBRF.', sent_at: '2026-09-05T13:05:00.000Z' }),
  msg({ flight_id: 7, direction: 'uplink', category: 'dispatch', label: 'DISPATCH', body: 'Diversion acknowledged. Gate 3 at SBJP available.', sent_at: '2026-09-05T13:06:00.000Z' }),
  msg({ flight_id: 7, direction: 'uplink', category: 'pdc', label: 'PDC', body: 'CLEARED TO SBJP DIRECT.', sent_at: '2026-09-05T12:01:00.000Z' }),
];

/** The fixed outgoing set. */
export const SEED_CANNED: CannedAcarsMessage[] = [
  { id: 'request-pushback', label: 'Request pushback', body: 'REQUEST PUSHBACK', category: 'freetext', direction: 'downlink' },
  { id: 'ready-for-taxi', label: 'Ready for taxi', body: 'READY FOR TAXI', category: 'freetext', direction: 'downlink' },
  { id: 'request-higher', label: 'Request higher', body: 'REQUEST HIGHER FL', category: 'freetext', direction: 'downlink' },
  { id: 'request-direct', label: 'Request direct', body: 'REQUEST DIRECT TO NEXT FIX', category: 'freetext', direction: 'downlink' },
  { id: 'position-report', label: 'Position report', body: 'POSITION REPORT', category: 'position-report', direction: 'downlink' },
  { id: 'on-blocks', label: 'On blocks', body: 'ON BLOCKS', category: 'oooi', direction: 'downlink' },
];

/** METARs handed back by the mock WX request; anything else gets a generic one. */
export const SEED_METARS: Record<string, string> = {
  SBGR: 'SBGR 231300Z 09006KT 9999 FEW025 24/15 Q1016',
  SBBR: 'SBBR 231300Z 06008KT CAVOK 27/09 Q1015',
  SBSV: 'SBSV 231300Z 12010KT 9999 SCT020 28/22 Q1013',
  SBPA: METAR_SBPA,
  SBCT: 'SBCT 231300Z 15006KT 9999 SCT040 19/12 Q1019',
  EFHK: 'EFHK 231250Z 24010KT 9999 FEW040 11/06 Q1012',
};
