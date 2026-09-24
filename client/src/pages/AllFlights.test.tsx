import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes, deferred } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { flightFixture } from '../test/fixtures';
import { AllFlights } from './AllFlights';

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];

describe('AllFlights', () => {
  it('shows a loading skeleton before the flights request resolves, then the real table row', async () => {
    const flights = deferred<ResponseTuple>();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights': flights.handler,
      '/api/trips': [200, []],
    });

    renderWithProviders(<AllFlights />);

    expect(document.querySelector('.cds--data-table-container.cds--skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/Airbus A320neo/)).not.toBeInTheDocument();
    expect(screen.queryByText('No flights recorded yet.')).not.toBeInTheDocument();

    flights.resolve([200, [flightFixture]]);

    await waitFor(() => expect(screen.getByRole('cell', { name: /Airbus A320neo/ })).toBeInTheDocument());
    expect(document.querySelector('.cds--data-table-container.cds--skeleton')).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Airbus A320neo/ })).toBeInTheDocument();
  });

  it('shows the empty state once the flights request resolves to none', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights': [200, []],
      '/api/trips': [200, []],
    });

    renderWithProviders(<AllFlights />);

    await waitFor(() => expect(screen.getByText('No flights recorded yet.')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
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
