import type { ReactNode } from 'react';
import { Column, Grid, Tag, Tile } from '@carbon/react';
import type { Status } from '../../mock/types';
import { formatAlt, formatDistance } from '../../utils/format';
import { LiveMapSlot } from './LiveMapSlot';

function Readout({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <Column sm={2} md={2} lg={wide ? 4 : 2} style={{ marginBottom: '1rem' }}>
      <div style={{ fontSize: '0.75rem', letterSpacing: '0.32px', color: 'var(--cds-text-secondary)' }}>{label}</div>
      <div style={{ fontSize: '1.75rem', lineHeight: 1.29, fontFamily: "'IBM Plex Mono', monospace" }}>{children}</div>
    </Column>
  );
}

const Unit = ({ children }: { children: string }) => (
  <span style={{ fontSize: '0.875rem', color: 'var(--cds-text-secondary)', marginInlineStart: '0.25rem' }}>{children}</span>
);

export function LivePanel({ status }: { status: Status }) {
  const { frame, flightState, aircraft, plannedLeg, paused } = status;
  if (flightState !== 'FLYING' || !frame) return null;

  const vs = Math.round(frame.verticalSpeedFpm);
  const vsColor = vs > 100 ? 'var(--cds-support-success)' : vs < -100 ? 'var(--cds-support-error)' : undefined;

  return (
    <Tile data-testid="live-panel" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <Tag type={paused ? 'magenta' : 'green'} size="md">{paused ? 'Paused' : 'Recording'}</Tag>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 400 }}>{aircraft || 'Unknown'}</h3>
      </div>
      <Grid condensed narrow style={{ padding: 0, marginInline: 0 }}>
        <Readout label="Airspeed">{Math.round(frame.airspeedKnots)}<Unit>kts</Unit></Readout>
        <Readout label="Ground speed">{Math.round(frame.groundSpeedKnots)}<Unit>kts</Unit></Readout>
        <Readout label="Altitude">{formatAlt(frame.altitudeFt)}<Unit>ft</Unit></Readout>
        <Readout label="Heading">{String(Math.round(frame.headingDeg)).padStart(3, '0')}<Unit>°</Unit></Readout>
        <Readout label="Vertical speed">
          <span style={{ color: vsColor }}>{(vs >= 0 ? '+' : '') + vs.toLocaleString()}</span><Unit>fpm</Unit>
        </Readout>
        <Readout label="Position" wide>
          <span style={{ fontSize: '1rem' }}>{frame.lat.toFixed(3)}, {frame.lon.toFixed(3)}</span>
        </Readout>
        {plannedLeg && (
          <>
            <Readout label={`Next waypoint → ${plannedLeg.destinationIdent}`} wide>{plannedLeg.nextWaypointIdent}</Readout>
            <Readout label="Remaining (planned route)" wide>
              <span style={{ fontSize: '1.25rem' }}>approx. {formatDistance(plannedLeg.remainingDistanceNm)}</span><Unit>nm</Unit>
            </Readout>
          </>
        )}
      </Grid>
      <LiveMapSlot status={status} />
    </Tile>
  );
}
