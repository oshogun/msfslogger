import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import type { AcarsMessage, AcarsThread } from '../types';
import { AcarsMessages } from './AcarsMessages';

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];
const CANNED_ROUTE: ResponseTuple = [200, { messages: [] }];
const ROUTE_OPTS = { path: '/flight/:id/acars', route: '/flight/1/acars' };

const emptyThread: AcarsThread = { flight_id: 1, planned_leg_id: null, messages: [] };

const importedMessage: AcarsMessage = {
  id: 901,
  flight_id: 1,
  planned_leg_id: null,
  direction: 'downlink',
  category: 'atc',
  label: 'SWA1451',
  body: 'Ground, Southwest 1451, gate 24, ready to taxi with information Kilo.',
  payload_json: null,
  correlation_id: null,
  dedup_key: 'sayintentions:comm:1:51221:out',
  sent_at: '2026-09-17T14:31:02.000Z',
  read_at: null,
};

const notLinkedStatus = { flight_id: 1, linked: false, link: null, api_key_set: true };
const noKeyStatus = { flight_id: 1, linked: false, link: null, api_key_set: false };
const linkedStatus = {
  flight_id: 1,
  linked: true,
  api_key_set: true,
  link: {
    flight_id: 1,
    upstream_flight_id: '8841207',
    since_id: 51224,
    baseline_comm_id: 51220,
    linked_at: '2026-09-17T14:30:00.000Z',
    last_import_at: '2026-09-17T14:40:11.284Z',
    imported_count: 4,
  },
};

const pdcMessage: AcarsMessage = {
  id: 100,
  flight_id: 1,
  planned_leg_id: 1,
  direction: 'uplink',
  category: 'pdc',
  label: 'PDC',
  body: 'CLEARED AS FILED RUNWAY 24R CLIMB VIA SID SQUAWK 1234',
  payload_json: '{"v":1,"departure_icao":"KJFK","destination_icao":"KORD","route":"","initial_altitude_ft":5000,"squawk":"1234"}',
  correlation_id: 99,
  dedup_key: 'pdc:1',
  sent_at: '2026-09-17T14:00:00.000Z',
  read_at: null,
};

const threadWithPdc: AcarsThread = {
  flight_id: 1,
  planned_leg_id: 1,
  messages: [pdcMessage],
};

describe('AcarsMessages - SayIntentions link/import section', () => {
  it('shows the disabled explanatory line and no controls when no API key is saved', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, emptyThread],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': [200, noKeyStatus],
      '/api/settings/sayintentions': [200, { sayintentions_api_key_set: false, sayintentions_api_key_masked: null }],
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    // The paragraph's own text is split across the "Settings" link, so its
    // full copy has to be read off textContent rather than matched as one
    // run of text (RTL's getByText only sees a node's direct text children).
    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'SayIntentions: no API key saved. Add one in Settings.')
      ).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'LINK SAYINTENTIONS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'IMPORT SAYINTENTIONS COMMS' })).not.toBeInTheDocument();
  });

  it('links on success and shows the pending-messages outcome', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, emptyThread],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': {
        GET: [200, notLinkedStatus],
        POST: [
          201,
          {
            flight_id: 1,
            created: true,
            pending_messages: 4,
            link: {
              flight_id: 1,
              upstream_flight_id: '8841207',
              since_id: null,
              baseline_comm_id: 51224,
              linked_at: '2026-09-17T14:30:00.000Z',
              last_import_at: null,
              imported_count: 0,
            },
          },
        ],
      },
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    const linkButton = await screen.findByRole('button', { name: 'LINK SAYINTENTIONS' });
    await user.click(linkButton);

    await waitFor(() =>
      expect(
        screen.getByText('Linked to SayIntentions session 8841207 — 4 messages waiting.')
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'RELINK' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'UNLINK' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'IMPORT SAYINTENTIONS COMMS' })).toBeEnabled();
  });

  it('renders the server error verbatim without crashing when linking fails', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, emptyThread],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': {
        GET: [200, notLinkedStatus],
        POST: [502, { error: 'SayIntentions is unreachable right now.', code: 'NETWORK' }],
      },
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    const linkButton = await screen.findByRole('button', { name: 'LINK SAYINTENTIONS' });
    await user.click(linkButton);

    await waitFor(() =>
      expect(screen.getByText('SayIntentions is unreachable right now.')).toBeInTheDocument()
    );
    // Page still renders and the control is still usable.
    expect(screen.getByRole('button', { name: 'LINK SAYINTENTIONS' })).toBeInTheDocument();
  });

  it('imports new rows into the thread and refreshes the linked-state line', async () => {
    const user = userEvent.setup();
    let linkGetCallCount = 0;
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, emptyThread],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': {
        GET: () => {
          linkGetCallCount++;
          if (linkGetCallCount === 1) return [200, linkedStatus];
          return [
            200,
            {
              ...linkedStatus,
              link: { ...linkedStatus.link, imported_count: 5, last_import_at: '2026-09-17T15:00:00.000Z' },
            },
          ];
        },
      },
      '/api/flights/1/sayintentions/import': [
        201,
        {
          flight_id: 1,
          imported: 1,
          already_seen: 0,
          skipped: 0,
          since_id: 51225,
          messages: [importedMessage],
        },
      ],
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    const importButton = await screen.findByRole('button', { name: 'IMPORT SAYINTENTIONS COMMS' });
    await user.click(importButton);

    await waitFor(() => expect(screen.getByText('Imported 1 message(s).')).toBeInTheDocument());
    expect(
      screen.getByText('Ground, Southwest 1451, gate 24, ready to taxi with information Kilo.')
    ).toBeInTheDocument();
    // Imported rows use the 'atc' category, which has no dedicated tag colour
    // and falls back to the same neutral tag as any other unknown category
    // this client doesn't recognise.
    expect(screen.getByText('atc').closest('.cds--tag')).toHaveClass('cds--tag--cool-gray');
    await waitFor(() => expect(screen.getByText(/5 imported\./)).toBeInTheDocument());
  });

  it('shows "no new messages" rather than an error on a repeat import', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, emptyThread],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': { GET: [200, linkedStatus] },
      '/api/flights/1/sayintentions/import': [
        200,
        { flight_id: 1, imported: 0, already_seen: 2, skipped: 0, since_id: 51224, messages: [] },
      ],
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    const importButton = await screen.findByRole('button', { name: 'IMPORT SAYINTENTIONS COMMS' });
    await user.click(importButton);

    await waitFor(() => expect(screen.getByText('No new messages.')).toBeInTheDocument());
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it('renders the server error verbatim without crashing when import fails upstream', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, emptyThread],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': { GET: [200, linkedStatus] },
      '/api/flights/1/sayintentions/import': [
        502,
        { error: 'SayIntentions is unreachable right now.', code: 'NETWORK' },
      ],
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    const importButton = await screen.findByRole('button', { name: 'IMPORT SAYINTENTIONS COMMS' });
    await user.click(importButton);

    await waitFor(() =>
      expect(screen.getByText('SayIntentions is unreachable right now.')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'IMPORT SAYINTENTIONS COMMS' })).toBeInTheDocument();
  });
});

describe('AcarsMessages - SayIntentions push section', () => {
  it('disables the push button when no API key is saved', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, threadWithPdc],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': [200, noKeyStatus],
      '/api/settings/sayintentions': [200, { sayintentions_api_key_set: false, sayintentions_api_key_masked: null }],
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    // Wait for the real post-load state, not the pre-load DOM (which also
    // has no button in it, for an unrelated reason — the thread hasn't
    // rendered yet). The button stays present but disabled once a key is
    // known to be unset, same as the other disabled-reason cases below.
    const pushButton = await screen.findByRole('button', { name: 'SEND TO SAYINTENTIONS' });
    expect(pushButton).toBeDisabled();
    expect(pushButton).toHaveAttribute('title', 'No SayIntentions key saved (save it in Settings)');
  });

  it('disables the push button when no PDC message exists yet', async () => {
    const threadWithoutPdc: AcarsThread = {
      flight_id: 1,
      planned_leg_id: 1,
      messages: [],
    };

    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, threadWithoutPdc],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': [200, notLinkedStatus],
      '/api/settings/sayintentions': [200, { sayintentions_api_key_set: true, sayintentions_api_key_masked: '••••••••' }],
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    const pushButton = await screen.findByRole('button', { name: 'SEND TO SAYINTENTIONS' });
    expect(pushButton).toBeDisabled();
    expect(pushButton).toHaveAttribute('title', 'No PDC clearance to send yet');
  });

  it('sends the PDC to SayIntentions on success and shows the sent text', async () => {
    const user = userEvent.setup();
    const sentMessage: AcarsMessage = {
      id: 200,
      flight_id: 1,
      planned_leg_id: 1,
      direction: 'uplink',
      category: 'pdc',
      label: 'PDC SENT',
      body: 'CLEARED AS FILED RUNWAY 24R CLIMB VIA SID SQUAWK 1234',
      payload_json: '{"upstream_excerpt":""}',
      correlation_id: 100,
      dedup_key: null,
      sent_at: '2026-09-17T14:05:00.000Z',
      read_at: null,
    };

    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, threadWithPdc],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': [200, notLinkedStatus],
      '/api/settings/sayintentions': [200, { sayintentions_api_key_set: true, sayintentions_api_key_masked: '••••••••' }],
      '/api/planned-legs/1/sayintentions/clearance': [201, { planned_leg_id: 1, message: sentMessage }],
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    const pushButton = await screen.findByRole('button', { name: 'SEND TO SAYINTENTIONS' });
    expect(pushButton).toBeEnabled();
    await user.click(pushButton);

    await waitFor(() =>
      expect(screen.getByText('Sent to SayIntentions: CLEARED AS FILED RUNWAY 24R CLIMB VIA SID SQUAWK 1234')).toBeInTheDocument()
    );
    expect(screen.getByText('PDC SENT')).toBeInTheDocument();
  });

  it('shows the NO_ACTIVE_SESSION error message when SayIntentions has no active session', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, threadWithPdc],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': [200, notLinkedStatus],
      '/api/settings/sayintentions': [200, { sayintentions_api_key_set: true, sayintentions_api_key_masked: '••••••••' }],
      '/api/planned-legs/1/sayintentions/clearance': [
        409,
        { error: 'SayIntentions has no active flight session for this key right now, so the message was not sent. Start the sim with SayIntentions connected and try again.', code: 'NO_ACTIVE_SESSION' },
      ],
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    const pushButton = await screen.findByRole('button', { name: 'SEND TO SAYINTENTIONS' });
    await user.click(pushButton);

    await waitFor(() =>
      expect(screen.getByText('SayIntentions has no active flight session for this key right now, so the message was not sent. Start the sim with SayIntentions connected and try again.')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'SEND TO SAYINTENTIONS' })).toBeInTheDocument();
  });

  it('renders the server error verbatim when push fails with a generic error', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': [200, threadWithPdc],
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': [200, notLinkedStatus],
      '/api/settings/sayintentions': [200, { sayintentions_api_key_set: true, sayintentions_api_key_masked: '••••••••' }],
      '/api/planned-legs/1/sayintentions/clearance': [
        502,
        { error: 'SayIntentions is unreachable right now.', code: 'NETWORK' },
      ],
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    const pushButton = await screen.findByRole('button', { name: 'SEND TO SAYINTENTIONS' });
    await user.click(pushButton);

    await waitFor(() =>
      expect(screen.getByText('SayIntentions is unreachable right now.')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'SEND TO SAYINTENTIONS' })).toBeInTheDocument();
  });
});

describe('AcarsMessages - manual refresh', () => {
  it('re-fetches the thread and merges in a new row when Refresh is clicked', async () => {
    const user = userEvent.setup();
    let acarsGetCallCount = 0;
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/flights/1/acars-messages': () => {
        acarsGetCallCount++;
        return acarsGetCallCount === 1 ? [200, emptyThread] : [200, { ...emptyThread, messages: [importedMessage] }];
      },
      '/api/acars/canned-messages': CANNED_ROUTE,
      '/api/flights/1/sayintentions/link': [200, noKeyStatus],
      '/api/settings/sayintentions': [200, { sayintentions_api_key_set: false, sayintentions_api_key_masked: null }],
    });

    renderWithProviders(<AcarsMessages />, ROUTE_OPTS);

    await waitFor(() => expect(screen.getByText('No messages yet')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(
        screen.getByText('Ground, Southwest 1451, gate 24, ready to taxi with information Kilo.')
      ).toBeInTheDocument()
    );
    expect(acarsGetCallCount).toBe(2);
  });
});
