import { useState } from 'react';
import { Button, Table, TableBody, TableHead, TableHeader, TableRow } from '@carbon/react';
import { SEED_PLANNED_LEGS } from '../../mock/data/plannedLegs';
import { SEED_FLIGHTS } from '../../mock/data/flights';
import type { PlannedLegImportResponse, PlannedLegStatus, SimbriefImportResult } from '../../mock/types';
import { GHOST_LEG_COLUMNS, GhostLegRow, LnmplnImportPanel, SimbriefImportPanel, SkipLegConfirm } from './index';

const STATUSES: PlannedLegStatus[] = ['planned', 'flown', 'diverted', 'skipped'];
const IMPORT_RESULTS: PlannedLegImportResponse['results'] = [
  { filename: 'SBGR-SBBR.lnmpln', status: 'imported', planned_leg_id: 90,
    warnings: [{ code: 'UNKNOWN_ALT', message: 'Waypoint TIBAM has no altitude; cruise altitude taken from the header' }] },
  { filename: 'broken.lnmpln', status: 'rejected', error: 'Not a valid Little Navmap flight plan (missing <Flightplan>)' },
  { filename: 'SBBR-SBSV.lnmpln', status: 'duplicate', planned_leg_id: 4, error: 'Already imported as leg #4' },
];
const SB_IMPORTED: SimbriefImportResult = {
  status: 'imported', planned_leg_id: 91, label: 'SBGR → SBCT',
  warnings: [{ code: 'NO_ALTERNATE', message: 'The plan has no alternate airport' }],
};
const SB_DUPLICATE: SimbriefImportResult = {
  status: 'duplicate', planned_leg_id: 91, label: 'SBGR → SBCT', warnings: [],
  error: 'This SimBrief plan was already imported as leg #91',
};

/** Shared leg rows and import panels, every state. */
export function LegsGallerySection() {
  const base = SEED_PLANNED_LEGS[0];
  const linkable = SEED_FLIGHTS.slice(0, 4);
  const [pickerOpen, setPickerOpen] = useState<number | null>(2);
  const [choice, setChoice] = useState<number | ''>('');
  const [skipOpen, setSkipOpen] = useState(false);

  return (
    <div id="legs-gallery" style={{ marginTop: '3rem' }}>
      <h2 className="sabia-heading-04">Planned-leg rows and import panels</h2>
      <h3 className="sabia-heading-03" style={{ marginTop: '1rem' }}>GhostLegRow: one per status, snippet, link picker, skip 409</h3>
      <div style={{ overflowX: 'auto' }}>
      <Table size="lg" aria-label="Ghost leg rows">
        <TableHead>
          <TableRow>
            {GHOST_LEG_COLUMNS.map(c => <TableHeader key={c.key}>{c.header}</TableHeader>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {STATUSES.map((s, i) => (
            <GhostLegRow
              key={s}
              leg={{ ...base, id: i + 1, status: s, is_snippet: 0,
                arrival_deviation_nm: s === 'flown' ? 3.2 : s === 'diverted' ? 41 : null }}
              onMove={() => undefined}
              canMoveUp={i > 0}
              canMoveDown={i < STATUSES.length - 1}
              onDelete={() => undefined}
              linkPickerOpen={pickerOpen === i + 1}
              onToggleLinkPicker={() => setPickerOpen(pickerOpen === i + 1 ? null : i + 1)}
              linkableFlights={linkable}
              linkFlightChoice={choice}
              onLinkFlightChoiceChange={setChoice}
              onConfirmLink={() => undefined}
              linkError={i === 1 ? 'Flight 12 is already linked to another leg' : undefined}
              skipError={s === 'skipped' ? 'Leg is linked to a flight; unlink it first (409)' : undefined}
              onToggleSkip={() => setSkipOpen(true)}
            />
          ))}
          <GhostLegRow
            leg={{ ...base, id: 9, status: 'planned', is_snippet: 1, departure_ident: 'WP1', destination_ident: 'WP4' }}
            onDelete={() => undefined}
            linkPickerOpen={false}
            onToggleLinkPicker={() => undefined}
            linkableFlights={null}
            linkFlightChoice=""
            onLinkFlightChoiceChange={() => undefined}
            onConfirmLink={() => undefined}
            onToggleSkip={() => undefined}
          />
        </TableBody>
      </Table>
      </div>
      <div style={{ marginTop: '1rem' }}>
        <Button id="open-skip-confirm" kind="tertiary" onClick={() => setSkipOpen(true)}>Open skip confirm (with 409)</Button>
      </div>
      <SkipLegConfirm
        leg={skipOpen ? { ...base, status: 'planned' } : null}
        error="Leg is linked to a flight and cannot be skipped (409). Unlink the flight first."
        onConfirm={() => undefined}
        onCancel={() => setSkipOpen(false)}
      />

      <div style={{ marginTop: '2rem' }}><LnmplnImportPanel
        headingLevel="h4"
        onFiles={() => undefined}
        results={IMPORT_RESULTS}
        batch={{ ordering: 'upload', reason: 'NO_UNIQUE_HEAD' }}
        error="Import failed: network error"
      /></div>

      <h3 className="sabia-heading-03" style={{ marginTop: '2rem' }}>SimBrief: imported, duplicate, disabled (no user id)</h3>
      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <SimbriefImportPanel headingLevel="h4" userId="123456" onImport={() => undefined} result={SB_IMPORTED} />
        <SimbriefImportPanel headingLevel="h4" userId="123456" onImport={() => undefined} result={SB_DUPLICATE} />
        <SimbriefImportPanel headingLevel="h4" userId={null} onImport={() => undefined} />
      </div>
    </div>
  );
}
