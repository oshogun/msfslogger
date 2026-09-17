import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes, deferred } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { tripFixture } from '../test/fixtures';
import { TripDetail } from './TripDetail';

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];
const SIMBRIEF_ROUTE: ResponseTuple = [200, { simbrief_user_id: null }];
const ROUTE_OPTS = { path: '/trip/:id', route: '/trip/1' };

describe('TripDetail', () => {
  it('shows "Loading..." before the trip resolves, then the trip', async () => {
    const trip = deferred<ResponseTuple>();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/trips/1': trip.handler,
      '/api/settings/simbrief': SIMBRIEF_ROUTE,
    });

    renderWithProviders(<TripDetail />, ROUTE_OPTS);

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    trip.resolve([200, tripFixture]);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'E2E Baltic Hop' })).toBeInTheDocument());
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('renders the load error when the trip fetch fails (e.g. a 404 for an unknown id)', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/trips/1': [404, { error: 'Not found' }],
      '/api/settings/simbrief': SIMBRIEF_ROUTE,
    });

    renderWithProviders(<TripDetail />, ROUTE_OPTS);

    await waitFor(() => expect(screen.getByText('Failed to load trip: Not found')).toBeInTheDocument());
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});
