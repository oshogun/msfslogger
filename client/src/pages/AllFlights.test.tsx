import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes, deferred } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { flightFixture } from '../test/fixtures';
import { AllFlights } from './AllFlights';

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];

describe('AllFlights', () => {
  it('shows the empty state before the flights request resolves, then the real table', async () => {
    const flights = deferred<ResponseTuple>();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights': flights.handler,
      '/api/trips': [200, []],
    });

    renderWithProviders(<AllFlights />);

    expect(screen.getByText('No flights recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    flights.resolve([200, [flightFixture]]);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getByRole('cell', { name: /Airbus A320neo/ })).toBeInTheDocument();
    expect(screen.queryByText('No flights recorded yet.')).not.toBeInTheDocument();
  });

  it('renders the flights-fetch error inline instead of the table', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights': [500, { error: 'Database is locked' }],
      '/api/trips': [200, []],
    });

    renderWithProviders(<AllFlights />);

    await waitFor(() => expect(screen.getByText('Database is locked')).toBeInTheDocument());
  });
});
