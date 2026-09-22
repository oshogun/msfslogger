import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NavdataControls, kindNote, type NavdataControlsProps } from './NavdataControls';
import { mockFetchRoutes } from '../test/mockFetch';
import { absentStatus, cov, emptyFeatures, presentStatus } from '../test/navdataFixtures';
import type { FeaturesResponse } from '../types';

const allOff = { airports: false, navaids: false, waypoints: false, airways: false, runways: false };

function renderControls(data: FeaturesResponse | null, over: Partial<NavdataControlsProps> = {}) {
  return render(
    <NavdataControls
      status={presentStatus}
      visible={{ ...allOff, airports: true, waypoints: true }}
      onToggle={() => {}}
      features={{ data, anchor: [0, 0], loading: false, error: null }}
      {...over}
    />
  );
}

describe('kindNote', () => {
  it('says not fetched yet when no cell was harvested', () => {
    const d = emptyFeatures({ coverage: { ...emptyFeatures().coverage, byKind: { V: cov(0, 0), N: cov(0, 0), W: cov(0, 0) } } });
    expect(kindNote('waypoints', d)).toMatch(/Not fetched here yet/);
  });

  it('says none here only when every cell was harvested and nothing came back', () => {
    expect(kindNote('waypoints', emptyFeatures())).toBe('None here');
  });

  it('says partly fetched with the percentage', () => {
    const d = emptyFeatures({ coverage: { ...emptyFeatures().coverage, byKind: { V: cov(4, 1), N: cov(4, 1), W: cov(2, 0.42) } } });
    expect(kindNote('waypoints', d)).toBe('Partly fetched here (42%)');
  });

  it('has no note for a fully harvested kind that returned rows', () => {
    const d = emptyFeatures({ waypoints: [{ key: 'k', ident: 'ZZAAA', region: 'ZZ', lat: 1, lon: 1, terminal: null }] });
    expect(kindNote('waypoints', d)).toBeNull();
  });

  it('reports a gated kind as needing zoom, ahead of coverage', () => {
    expect(kindNote('waypoints', emptyFeatures({ gated: ['waypoints'] }))).toBe('Zoom in to see waypoints');
  });

  it('trusts an empty airport answer because the index is global', () => {
    expect(kindNote('airports', emptyFeatures())).toBe('None here');
  });
});

describe('NavdataControls', () => {
  it('renders nothing when the replica is absent or status is unknown', () => {
    const { container, rerender } = renderControls(null, { status: absentStatus });
    expect(container).toBeEmptyDOMElement();
    rerender(
      <NavdataControls status={null} visible={allOff} onToggle={() => {}} features={{ data: null, anchor: null, loading: false, error: null }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a toggle per kind and reports clicks', () => {
    const toggled: string[] = [];
    renderControls(null, { onToggle: k => toggled.push(k) });
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Navaids' }));
    expect(toggled).toEqual(['navaids']);
  });

  it('greys a gated toggle and gives the reason', () => {
    renderControls(emptyFeatures({ gated: ['waypoints'] }));
    expect(screen.getByText('Waypoints: Zoom in to see waypoints')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Waypoints' }).closest('label')).toHaveStyle({ opacity: '0.45' });
  });

  it('warns when the answer was truncated', () => {
    renderControls(emptyFeatures({ truncated: true }));
    expect(screen.getByText(/Too many to draw — zoom in for more/)).toBeInTheDocument();
  });

  it('shows coverage messages per enabled kind only', () => {
    renderControls(emptyFeatures());
    expect(screen.getByText('Waypoints: None here')).toBeInTheDocument();
    expect(screen.getByText('Airports: None here')).toBeInTheDocument();
    expect(screen.queryByText(/Navaids:/)).toBeNull();
  });

  it('offers fetch detail for index-only airports and posts the request', async () => {
    const posts: unknown[] = [];
    mockFetchRoutes({
      '/api/navdata/request': { POST: init => {
        posts.push(JSON.parse(init!.body as string));
        return [200, { ok: true, state: 'queued', ident: 'ZZAA' }];
      } },
    });
    renderControls(emptyFeatures({
      airports: [
        { ident: 'ZZAA', lat: 1, lon: 1, name: null, hasDetail: false, runways: null, procedures: null, longestRunwayM: null, surface: null, towered: null, longestRunwayHeadingDeg: null },
        { ident: 'ZZBB', lat: 1, lon: 1, name: null, hasDetail: true, runways: 1, procedures: 1, longestRunwayM: null, surface: null, towered: null, longestRunwayHeadingDeg: null },
      ],
    }));
    const buttons = screen.getAllByRole('button', { name: 'Fetch detail' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.getByText('Queued')).toBeInTheDocument());
    expect(posts).toEqual([{ kind: 'A', ident: 'ZZAA' }]);
  });

  it('shows a failed request instead of throwing, and lets it be retried', async () => {
    mockFetchRoutes({ '/api/navdata/request': { POST: [500, { error: 'nope' }] } });
    renderControls(emptyFeatures({
      airports: [{ ident: 'ZZAA', lat: 1, lon: 1, name: null, hasDetail: false, runways: null, procedures: null, longestRunwayM: null, surface: null, towered: null, longestRunwayHeadingDeg: null }],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch detail' }));
    await waitFor(() => expect(screen.getByText('Request failed: nope')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Fetch detail' })).toBeInTheDocument();
  });

  it('never offers fetch detail for an ident that is not airport-shaped', () => {
    renderControls(emptyFeatures({
      airports: [{ ident: 'ZZ-BAD!', lat: 1, lon: 1, name: null, hasDetail: false, runways: null, procedures: null, longestRunwayM: null, surface: null, towered: null, longestRunwayHeadingDeg: null }],
    }));
    expect(screen.queryByRole('button', { name: 'Fetch detail' })).toBeNull();
  });
});
