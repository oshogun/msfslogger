import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { Settings } from './Settings';

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];
const UNSET_SIMBRIEF: ResponseTuple = [200, { simbrief_user_id: null }];
const NO_SAYINTENTIONS: ResponseTuple = [200, { sayintentions_api_key_set: false, sayintentions_api_key_masked: null }];
const SET_SAYINTENTIONS: ResponseTuple = [200, { sayintentions_api_key_set: true, sayintentions_api_key_masked: '••••cdef' }];

describe('Settings', () => {
  it('loads and shows the saved SimBrief user id and the SayIntentions status', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/settings/simbrief': [200, { simbrief_user_id: 'e2e-simbrief-id' }],
      '/api/settings/sayintentions': SET_SAYINTENTIONS,
    });

    renderWithProviders(<Settings />);

    expect(await screen.findByDisplayValue('e2e-simbrief-id')).toBeInTheDocument();
    expect(screen.getByTestId('si-status')).toHaveTextContent('Saved: ••••cdef');
  });

  it('trims and saves a new SimBrief user id, showing the server echo', async () => {
    const user = userEvent.setup();
    const puts: unknown[] = [];
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/settings/simbrief': {
        GET: UNSET_SIMBRIEF,
        PUT: init => {
          puts.push(JSON.parse(init!.body as string));
          return [200, { simbrief_user_id: 'trimmed-id' }];
        },
      },
      '/api/settings/sayintentions': NO_SAYINTENTIONS,
    });

    renderWithProviders(<Settings />);

    const input = await screen.findByLabelText('SimBrief User ID');
    await user.type(input, '  trimmed-id  ');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    await waitFor(() => expect(screen.getByText('SimBrief user ID saved.')).toBeInTheDocument());
    expect(puts).toEqual([{ simbrief_user_id: 'trimmed-id' }]);
    expect(screen.getByDisplayValue('trimmed-id')).toBeInTheDocument();
  });

  it('saves a SayIntentions key, then clears it', async () => {
    const user = userEvent.setup();
    const puts: unknown[] = [];
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/settings/simbrief': UNSET_SIMBRIEF,
      '/api/settings/sayintentions': {
        GET: NO_SAYINTENTIONS,
        PUT: init => {
          const body = JSON.parse(init!.body as string);
          puts.push(body);
          return body.sayintentions_api_key === null ? NO_SAYINTENTIONS : SET_SAYINTENTIONS;
        },
      },
    });

    renderWithProviders(<Settings />);

    const keyInput = await screen.findByLabelText('SayIntentions API Key');
    await user.type(keyInput, 'sk-live-abcdef');
    const saveButtons = screen.getAllByRole('button', { name: 'Save' });
    await user.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => expect(screen.getByText('SayIntentions API key saved.')).toBeInTheDocument());
    expect(screen.getByTestId('si-status')).toHaveTextContent('Saved: ••••cdef');

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(screen.getByText('SayIntentions API key cleared.')).toBeInTheDocument());
    expect(screen.getByTestId('si-status')).toHaveTextContent('No key saved');
    expect(puts).toEqual([{ sayintentions_api_key: 'sk-live-abcdef' }, { sayintentions_api_key: null }]);
  });

  it('shows the SimBrief save error inline instead of throwing', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/settings/simbrief': {
        GET: UNSET_SIMBRIEF,
        PUT: [500, { error: 'Database is locked' }],
      },
      '/api/settings/sayintentions': NO_SAYINTENTIONS,
    });

    renderWithProviders(<Settings />);

    const input = await screen.findByLabelText('SimBrief User ID');
    await user.type(input, 'e2e-id');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    await waitFor(() => expect(screen.getByText('Database is locked')).toBeInTheDocument());
  });
});
