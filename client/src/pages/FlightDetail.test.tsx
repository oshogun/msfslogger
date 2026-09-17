import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes, deferred } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { flightFixture } from '../test/fixtures';
import { FlightDetail } from './FlightDetail';

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
});
