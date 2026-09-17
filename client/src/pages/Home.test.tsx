import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes, deferred } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { flightFixture } from '../test/fixtures';
import { Home } from './Home';

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];

describe('Home', () => {
  it('shows the empty state before the flights request resolves, then the real stats', async () => {
    const flights = deferred<ResponseTuple>();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights': flights.handler,
      '/api/trips': [200, []],
      '/api/ground-sessions/current': [200, { session: null }],
      '/api/planned-legs': [200, []],
    });

    renderWithProviders(<Home status={null} />);

    // Nothing has resolved yet: flights is still [], so the same branch a
    // genuinely empty log renders is what's on screen right now.
    expect(screen.getByText('No flights recorded yet.')).toBeInTheDocument();
    expect(screen.queryByText('Total Flights')).not.toBeInTheDocument();

    flights.resolve([200, [flightFixture]]);

    await waitFor(() => expect(screen.getByText('Total Flights')).toBeInTheDocument());
    expect(screen.queryByText('No flights recorded yet.')).not.toBeInTheDocument();
  });

  it('renders the flights-fetch error inline instead of the flight list', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights': [500, { error: 'Database is locked' }],
      '/api/trips': [200, []],
      '/api/ground-sessions/current': [200, { session: null }],
      '/api/planned-legs': [200, []],
    });

    renderWithProviders(<Home status={null} />);

    await waitFor(() => expect(screen.getByText('Database is locked')).toBeInTheDocument());
  });
});
