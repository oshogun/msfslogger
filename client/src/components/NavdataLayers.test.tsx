import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { unwrapAirwayLeg, unwrapPoint } from './NavdataLayers';
import { FlightMap } from './FlightMap';
import { TripMap } from './TripMap';
import { mockFetchRoutes } from '../test/mockFetch';
import { absentStatus, presentStatus } from '../test/navdataFixtures';
import { flightFixture } from '../test/fixtures';
import type { FlightPoint } from '../types';

const points: FlightPoint[] = Array.from({ length: 4 }, (_, i) => ({
  id: i, flight_id: 1, ts: '2026-01-01T12:00:00Z', lat: 10 + i * 0.1, lon: 20 + i * 0.1, altitude_ft: 1000,
  airspeed_kts: 100, ground_speed_kts: 100, heading_deg: 90, vertical_speed_fpm: 0, on_ground: 0,
}));
const trip = { ...flightFixture, points };

describe('antimeridian unwrapping', () => {
  it('draws a dateline airway leg through the unwrapped chain, not across the world', () => {
    const [from, to] = unwrapAirwayLeg([0, 179], [0, 179.5], [0, -179.5]);
    expect(from).toEqual([0, 179.5]);
    expect(to).toEqual([0, 180.5]);
  });

  it('places a leg anchored east of the dateline in the same frame', () => {
    const [from, to] = unwrapAirwayLeg([0, -179], [0, 179.5], [0, -179.5]);
    expect(from[1]).toBeCloseTo(-180.5);
    expect(to[1]).toBeCloseTo(-179.5);
  });

  it('puts a marker position beside the anchor, not a world-copy away', () => {
    expect(unwrapPoint([5, 181], 5, -179)).toEqual([5, 181]);
    expect(unwrapPoint([5, -181], 5, 179)).toEqual([5, -181]);
  });
});

describe('maps without navdata', () => {
  afterEach(() => vi.restoreAllMocks());

  it('render identically whether or not the navdata prop is set while the replica is absent', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(absentStatus), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const plain = render(<FlightMap preferCanvas={false} points={points} />);
    const plainHtml = plain.container.innerHTML;
    plain.unmount();
    expect(fetchSpy).not.toHaveBeenCalled();

    const withNav = render(<FlightMap preferCanvas={false} points={points} navdata />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/navdata/status', expect.anything()));
    await new Promise(r => setTimeout(r, 20));
    expect(withNav.container.innerHTML).toBe(plainHtml);
    expect(screen.queryByText('Navdata')).toBeNull();
    expect(withNav.container.querySelector('.leaflet-navdata-pane')).toBeNull();
  });

  it('render no navdata pane or request when the prop is left off, even on a present replica', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(presentStatus), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { container } = render(<TripMap preferCanvas={false} flights={[trip]} />);
    await new Promise(r => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelector('.leaflet-navdata-pane')).toBeNull();
  });

  it('create the panes and the controls when the replica is present', async () => {
    mockFetchRoutes({ '/api/navdata/status': [200, presentStatus] });
    const { container } = render(<FlightMap preferCanvas={false} points={points} navdata />);
    await waitFor(() => expect(screen.getByText('Navdata')).toBeInTheDocument());
    const nav = container.querySelector<HTMLElement>('.leaflet-navdata-pane')!;
    const markers = container.querySelector<HTMLElement>('.leaflet-navdata-markers-pane')!;
    expect(nav.style.zIndex).toBe('350');
    expect(markers.style.zIndex).toBe('360');
  });
});
