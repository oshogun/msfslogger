import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { plannedLegListItemFixture } from '../test/fixtures';
import { Prefiles } from './Prefiles';

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];
const UNSET_SIMBRIEF: ResponseTuple = [200, { simbrief_user_id: null }];
const SET_SIMBRIEF: ResponseTuple = [200, { simbrief_user_id: 'e2e-simbrief-id' }];

describe('Prefiles', () => {
  it('renders the empty state when no planned legs exist', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/planned-legs': [200, []],
      '/api/settings/simbrief': UNSET_SIMBRIEF,
    });

    renderWithProviders(<Prefiles />);

    expect(screen.getByRole('heading', { name: 'Prefiles' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No planned legs yet.')).toBeInTheDocument());
  });

  it('renders the load-error banner when the planned-legs fetch fails', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/planned-legs': [500, { error: 'Database is locked' }],
      '/api/settings/simbrief': UNSET_SIMBRIEF,
    });

    renderWithProviders(<Prefiles />);

    await waitFor(() => expect(screen.getByText('Failed to load planned legs')).toBeInTheDocument());
    expect(screen.getByText('Database is locked')).toBeInTheDocument();
  });

  it('lists a planned leg under its trip, once the fetch resolves', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/planned-legs': [200, [plannedLegListItemFixture]],
      '/api/settings/simbrief': UNSET_SIMBRIEF,
    });

    renderWithProviders(<Prefiles />);

    await waitFor(() => expect(screen.getByTestId('legs-table')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: plannedLegListItemFixture.trip_name! })).toBeInTheDocument();
  });

  describe('SimBrief import action', () => {
    it('is disabled and links to Settings when no SimBrief pilot ID is saved', async () => {
      mockFetchRoutes({
        '/api/auth/session': SESSION_ROUTE,
        '/api/planned-legs': [200, []],
        '/api/settings/simbrief': UNSET_SIMBRIEF,
      });

      renderWithProviders(<Prefiles />);

      const importButton = await screen.findByRole('button', { name: 'Import from SimBrief' });
      await waitFor(() => expect(importButton).toBeDisabled());
      expect(screen.getByRole('link', { name: 'Set it in Settings' })).toHaveAttribute('href', '/settings');
    });

    it('imports a leg and shows the success banner once a SimBrief pilot ID is saved', async () => {
      const user = userEvent.setup();
      mockFetchRoutes({
        '/api/auth/session': SESSION_ROUTE,
        '/api/planned-legs': [200, []],
        '/api/settings/simbrief': SET_SIMBRIEF,
        '/api/planned-legs/simbrief': [200, {
          result: { status: 'imported', label: 'EETN → ESSA', warnings: [] },
        }],
      });

      renderWithProviders(<Prefiles />);

      const importButton = await screen.findByRole('button', { name: 'Import from SimBrief' });
      await waitFor(() => expect(importButton).toBeEnabled());
      await user.click(importButton);

      await waitFor(() => expect(screen.getByText('Imported EETN → ESSA as a new planned leg.')).toBeInTheDocument());
    });
  });
});
