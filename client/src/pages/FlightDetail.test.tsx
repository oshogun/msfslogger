import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes, deferred } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { flightFixture } from '../test/fixtures';
import { FlightDetail } from './FlightDetail';
import type { FlightPoint } from '../types';

// The GPS Track map draws on a canvas, which jsdom cannot host; the replay
// panel under test uses SVG and runs for real.
vi.mock('../components/FlightMap', () => ({ FlightMap: () => <div data-testid="flight-map" /> }));

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];
const ROUTE_OPTS = { path: '/flight/:id', route: '/flight/1' };

describe('FlightDetail', () => {
  it('shows "Loading..." before the flight resolves, then the flight', async () => {
    const flight = deferred<ResponseTuple>();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1': flight.handler,
    });

    renderWithProviders(<FlightDetail />, ROUTE_OPTS);

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    flight.resolve([200, flightFixture]);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Flight #1.*Airbus A320neo/ })).toBeInTheDocument()
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('renders the load error when the flight fetch fails (e.g. a 404 for an unknown id)', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1': [404, { error: 'Not found' }],
    });

    renderWithProviders(<FlightDetail />, ROUTE_OPTS);

    await waitFor(() => expect(screen.getByText('Failed to load flight: Not found')).toBeInTheDocument());
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  describe('replay entry', () => {
    const points: FlightPoint[] = [0, 1, 2].map(i => ({
      id: i,
      flight_id: 1,
      ts: new Date(Date.UTC(2026, 2, 1, 8, 0, i * 5)).toISOString(),
      lat: 60 + i * 0.01,
      lon: 24 + i * 0.01,
      altitude_ft: 1000 * i,
      airspeed_kts: 100,
      ground_speed_kts: 110,
      heading_deg: 90,
      vertical_speed_fpm: 0,
      on_ground: 0,
    }));

    function load(pts: FlightPoint[], end_time: string | null = flightFixture.end_time) {
      mockFetchRoutes({
        '/api/auth/session': SESSION_ROUTE,
        '/api/flights/1': [200, { ...flightFixture, end_time, points: pts, point_count: pts.length }],
      });
      renderWithProviders(<FlightDetail />, ROUTE_OPTS);
    }

    it('offers no Replay button for a flight with fewer than two points', async () => {
      load([points[0]]);
      await screen.findByRole('heading', { name: /Flight #1/ });
      expect(screen.queryByRole('button', { name: 'Replay flight' })).not.toBeInTheDocument();
    });

    it('offers no Replay button for a flight still in progress', async () => {
      load(points, null);
      await screen.findByRole('heading', { name: /Flight #1/ });
      expect(screen.queryByRole('button', { name: 'Replay flight' })).not.toBeInTheDocument();
    });

    it('mounts the panel only after the button is clicked, and unmounts it on a second click', async () => {
      load(points);
      const button = await screen.findByRole('button', { name: 'Replay flight' });
      expect(screen.queryByRole('region', { name: 'Flight replay' })).not.toBeInTheDocument();

      fireEvent.click(button);
      expect(screen.getByRole('region', { name: 'Flight replay' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Play replay' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Replay speed' })).toBeInTheDocument();
      expect(screen.getByRole('slider', { name: 'Replay position' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Hide replay' }));
      expect(screen.queryByRole('region', { name: 'Flight replay' })).not.toBeInTheDocument();
    });
  });
});
