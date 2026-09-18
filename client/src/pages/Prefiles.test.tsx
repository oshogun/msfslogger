import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { Prefiles } from './Prefiles';

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];
const LEGS_ROUTE: ResponseTuple = [200, []];
const SIMBRIEF_ROUTE: ResponseTuple = [200, { simbrief_user_id: null }];

describe('Prefiles - SayIntentions API key field', () => {
  it('renders "not set" when GET returns no key', async () => {
    const sayintentionsRoute: ResponseTuple = [200, { sayintentions_api_key_set: false, sayintentions_api_key_masked: null }];
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/planned-legs': LEGS_ROUTE,
      '/api/settings/simbrief': SIMBRIEF_ROUTE,
      '/api/settings/sayintentions': sayintentionsRoute,
    });

    renderWithProviders(<Prefiles />);

    await waitFor(() => expect(screen.getByText('No key saved')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Prefiles' })).toBeInTheDocument();
  });

  it('renders the masked value when GET returns a set key', async () => {
    const sayintentionsRoute: ResponseTuple = [200, { sayintentions_api_key_set: true, sayintentions_api_key_masked: '••••••••' }];
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/planned-legs': LEGS_ROUTE,
      '/api/settings/simbrief': SIMBRIEF_ROUTE,
      '/api/settings/sayintentions': sayintentionsRoute,
    });

    renderWithProviders(<Prefiles />);

    await waitFor(() => expect(screen.getByText('Saved: ••••••••')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('saves and clears input, showing masked value after successful PUT', async () => {
    const user = userEvent.setup();
    let putCallCount = 0;
    const sayintentionsRoute = (init?: RequestInit): ResponseTuple => {
      if (init?.method === 'PUT') {
        putCallCount++;
        if (putCallCount === 1) {
          // First PUT: save the key
          return [200, { sayintentions_api_key_set: true, sayintentions_api_key_masked: '••••••••' }];
        }
      }
      // GET or initial state
      return [200, { sayintentions_api_key_set: false, sayintentions_api_key_masked: null }];
    };

    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/planned-legs': LEGS_ROUTE,
      '/api/settings/simbrief': SIMBRIEF_ROUTE,
      '/api/settings/sayintentions': { GET: sayintentionsRoute, PUT: sayintentionsRoute },
    });

    renderWithProviders(<Prefiles />);

    // Wait for initial "not set" state
    await waitFor(() => expect(screen.getByText('No key saved')).toBeInTheDocument());

    // Type a key in the input
    const input = screen.getByLabelText('SayIntentions API Key') as HTMLInputElement;
    expect(input.type).toBe('password'); // Verify it's a password input
    await user.type(input, 'si_1a2b3c4d5e6f7g8h9test');

    // Click Save — scoped to this section since the SimBrief field above has
    // its own identically-labelled "Save" button.
    const sayintentionsSection = screen.getByText('SayIntentions').closest('.simbrief-import-section') as HTMLElement;
    const saveButton = within(sayintentionsSection).getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    // Wait for the masked value to appear and input to be cleared
    await waitFor(() => {
      expect(screen.getByText('Saved: ••••••••')).toBeInTheDocument();
      expect(input.value).toBe('');
    });
  });

  it('renders error without crashing the page when PUT fails', async () => {
    const user = userEvent.setup();
    const errorMessage = 'A SayIntentions API key must be 8 to 200 characters with no spaces — copy it from your SayIntentions account page.';
    const sayintentionsRoute = (init?: RequestInit): ResponseTuple => {
      if (init?.method === 'PUT') {
        return [400, { error: errorMessage, code: 'INVALID_API_KEY' }];
      }
      return [200, { sayintentions_api_key_set: false, sayintentions_api_key_masked: null }];
    };

    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/planned-legs': LEGS_ROUTE,
      '/api/settings/simbrief': SIMBRIEF_ROUTE,
      '/api/settings/sayintentions': { GET: sayintentionsRoute, PUT: sayintentionsRoute },
    });

    renderWithProviders(<Prefiles />);

    // Wait for initial state
    await waitFor(() => expect(screen.getByText('No key saved')).toBeInTheDocument());

    // Type an invalid key
    const input = screen.getByLabelText('SayIntentions API Key') as HTMLInputElement;
    await user.type(input, 'short');

    // Click Save — scoped to this section since the SimBrief field above has
    // its own identically-labelled "Save" button.
    const sayintentionsSection = screen.getByText('SayIntentions').closest('.simbrief-import-section') as HTMLElement;
    const saveButton = within(sayintentionsSection).getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    // Wait for error to appear
    await waitFor(() => expect(screen.getByText(errorMessage)).toBeInTheDocument());

    // Verify the page is still functional: the heading is still there
    expect(screen.getByRole('heading', { name: 'Prefiles' })).toBeInTheDocument();

    // Verify the input still has the user's text (not reverted)
    expect(input.value).toBe('short');
  });
});
