import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Button, InlineLoading, InlineNotification, Link } from '@carbon/react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import {
  getFlightAcars, getPlannedLeg, getPlannedLegAcars, getSayIntentionsLink, getSayIntentionsSettings,
  importSayIntentions, linkSayIntentions, listCannedMessages, pushClearanceToSayIntentions, requestAcarsPair,
  requestWx, sendCannedAcars, unlinkSayIntentions,
} from '../mock/api';
import type {
  AcarsMessage, CannedAcarsMessage, PlannedLegWithChildren, SayIntentionsLinkStatus,
} from '../mock/types';
import { MessageCard } from './acars/MessageCard';
import { SayIntentionsPanel } from './acars/SayIntentionsPanel';
import {
  CLEARANCE_SENDING_ID, LOADSHEET_SENDING_ID, SendToolbar, SI_IMPORT_SENDING_ID, SI_LINK_SENDING_ID,
  SI_PUSH_SENDING_ID, SI_UNLINK_SENDING_ID, WX_SENDING_ID,
} from './acars/SendToolbar';
import { mergeById } from './acars/thread';
import './acars/acars.scss';

export function AcarsMessages() {
  // Two mutually exclusive scopes on one page: a flight's own ACARS log (`id`),
  // or a planned leg's pre-flight log before any flight is linked (`legId`).
  const { id, legId } = useParams<{ id?: string; legId?: string }>();
  const scope: 'flight' | 'planned-leg' = legId != null ? 'planned-leg' : 'flight';
  const flightId = Number(id);
  const [messages, setMessages] = useState<AcarsMessage[]>([]);
  const [plannedLegId, setPlannedLegId] = useState<number | null>(scope === 'planned-leg' ? Number(legId) : null);
  const [plannedLeg, setPlannedLeg] = useState<PlannedLegWithChildren | null>(null);
  const [canned, setCanned] = useState<CannedAcarsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cannedError, setCannedError] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [wxIcao, setWxIcao] = useState('');
  // null covers both "not loaded yet" and "unavailable" (no key, or the fetch
  // itself failed): the flight-scoped panel renders the same muted line.
  const [siLinkStatus, setSiLinkStatus] = useState<SayIntentionsLinkStatus | null>(null);
  const [siMessage, setSiMessage] = useState('');
  // false: no key saved; null: the check has not completed. Separate from the
  // link status because the planned-leg scope has no link fetch, only this.
  const [siKeySet, setSiKeySet] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setCannedError('');
    setMessages([]);
    Promise.all([
      scope === 'planned-leg' ? getPlannedLegAcars(Number(legId)) : getFlightAcars(flightId),
      // The canned set is its own resource: if only it fails, the thread is
      // still worth rendering read-only.
      listCannedMessages().catch(() => null),
      scope === 'flight' ? getSayIntentionsLink(flightId).catch(() => null) : Promise.resolve(null),
      getSayIntentionsSettings().catch(() => null),
    ])
      .then(([thread, cannedList, siStatus, siSettings]) => {
        if (cancelled) return;
        setMessages(thread.messages);
        setPlannedLegId(scope === 'planned-leg' ? Number(legId) : (thread as { planned_leg_id: number | null }).planned_leg_id);
        if (cannedList) setCanned(cannedList);
        else setCannedError('Canned messages unavailable');
        setSiLinkStatus(siStatus);
        setSiKeySet(siSettings ? siSettings.sayintentions_api_key_set : false);
      })
      .catch(err => { if (!cancelled) setLoadError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, legId, scope, flightId]);

  // Convenience-only lookup for the REQUEST WX default and the back link: a
  // failure means no suggested ICAO, not a page error.
  useEffect(() => {
    if (plannedLegId === null) {
      setPlannedLeg(null);
      return;
    }
    let cancelled = false;
    getPlannedLeg(plannedLegId)
      .then(leg => { if (!cancelled) setPlannedLeg(leg); })
      .catch(() => { if (!cancelled) setPlannedLeg(null); });
    return () => { cancelled = true; };
  }, [plannedLegId]);

  // Re-derive the default whenever the leg changes, but only while the user
  // has not typed anything, so a fetched leg cannot clobber mid-edit input.
  useEffect(() => {
    if (wxIcao !== '') return;
    if (plannedLeg?.destination_is_airport) setWxIcao(plannedLeg.destination_ident);
    else if (plannedLeg?.departure_is_airport) setWxIcao(plannedLeg.departure_ident);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedLeg]);

  /** Runs one send action with the single in-flight id and the shared error slot. */
  async function run(sending: string, action: () => Promise<void>, clearSi = false) {
    setSendingId(sending);
    setSendError('');
    if (clearSi) setSiMessage('');
    try {
      await action();
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setSendingId(null);
    }
  }

  // Refetches the thread and merges by id: rows already on screen are replaced
  // in place and new ones added, and the list never blanks, so scroll position
  // survives.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setSendError('');
    try {
      const thread = scope === 'planned-leg' ? await getPlannedLegAcars(Number(legId)) : await getFlightAcars(flightId);
      setMessages(prev => mergeById(prev, thread.messages));
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [scope, legId, flightId]);

  const scopeArg = scope === 'planned-leg' ? { legId: Number(legId) } : { flightId };

  const handleSend = (cannedId: string) => run(cannedId, async () => {
    const created = await sendCannedAcars(scopeArg, cannedId);
    // The response is the row the server stored, so appending is all the
    // thread needs: nothing optimistic to reconcile if a send is rejected.
    setMessages(prev => [...prev, created]);
  });

  // A re-request returns the pair already in the thread, so it merges by id.
  const handleLoadsheet = () => plannedLegId !== null
    ? run(LOADSHEET_SENDING_ID, async () => {
      const r = await requestAcarsPair({ legId: plannedLegId }, 'loadsheet');
      setMessages(prev => mergeById(prev, [r.request, r.reply]));
    })
    : undefined;

  const handleClearance = () => plannedLegId !== null
    ? run(CLEARANCE_SENDING_ID, async () => {
      const r = await requestAcarsPair({ legId: plannedLegId }, 'clearance');
      setMessages(prev => mergeById(prev, [r.request, r.reply]));
    })
    : undefined;

  // Every accepted WX call creates two brand-new rows, so a plain append.
  const handleWx = () => run(WX_SENDING_ID, async () => {
    const r = await requestWx(scopeArg, wxIcao.trim().toUpperCase());
    setMessages(prev => [...prev, r.request, r.reply]);
  });

  // LINK and RELINK share the same call.
  const handleSiLink = () => run(SI_LINK_SENDING_ID, async () => {
    const r = await linkSayIntentions(flightId);
    setSiLinkStatus({ flight_id: flightId, linked: true, link: r.link, api_key_set: true });
    setSiMessage(`Linked to SayIntentions session ${r.link.upstream_flight_id ?? 'current'} — ${r.pending_messages} messages waiting.`);
  }, true);

  const handleSiUnlink = () => run(SI_UNLINK_SENDING_ID, async () => {
    await unlinkSayIntentions(flightId);
    setSiLinkStatus(prev => (prev ? { ...prev, linked: false, link: null } : prev));
  }, true);

  const handleSiImport = () => run(SI_IMPORT_SENDING_ID, async () => {
    const r = await importSayIntentions(flightId);
    // A repeat import with nothing new is a success and the merge a no-op.
    if (r.messages.length > 0) setMessages(prev => mergeById(prev, r.messages));
    setSiMessage(r.imported > 0 ? `Imported ${r.imported} message(s).` : 'No new messages.');
    setSiLinkStatus(prev => (prev && prev.link
      ? { ...prev, link: { ...prev.link, last_import_at: new Date().toISOString(), imported_count: prev.link.imported_count + r.imported } }
      : prev));
  }, true);

  const handleSiPush = () => {
    if (plannedLegId === null) return undefined;
    const pdc = messages.find(m => m.category === 'pdc' && m.direction === 'uplink' && m.label === 'PDC');
    return run(SI_PUSH_SENDING_ID, async () => {
      const m = await pushClearanceToSayIntentions(plannedLegId, pdc?.body ?? '');
      // The new stored row is appended directly, not merged.
      setMessages(prev => [...prev, m]);
      setSiMessage(`Sent to SayIntentions: ${m.body}`);
    }, true);
  };

  const title = scope === 'planned-leg' ? `ACARS messages — Planned leg #${legId}` : `ACARS messages — Flight #${id}`;

  // The planned-leg back link goes to the leg's trip once the leg has loaded;
  // until then, or with no trip, it falls back to a list page.
  const backLink = scope === 'planned-leg'
    ? (plannedLeg?.trip_id != null
      ? <Link as={RouterLink} to={`/trip/${plannedLeg.trip_id}`}>← Back to trip</Link>
      : <Link as={RouterLink} to={plannedLeg ? '/prefiles' : '/flights'}>{plannedLeg ? '← Back to prefiles' : '← Back to trip'}</Link>)
    : <Link as={RouterLink} to={`/flight/${id}`}>← Flight #{id}</Link>;

  if (loadError) {
    const notFound = /not found/i.test(loadError);
    return (
      <>
        <div style={{ marginBottom: '1rem' }}>{backLink}</div>
        <InlineNotification
          kind="error" role="alert" lowContrast hideCloseButton
          title={notFound ? (scope === 'planned-leg' ? 'Planned leg not found' : 'Flight not found') : 'Could not load messages'}
          subtitle={notFound ? undefined : loadError}
        />
      </>
    );
  }

  // Newest at top. A copy, never messages.reverse(): state stays oldest-first,
  // the order the API returns and the order an appended message belongs in.
  const ordered = [...messages].reverse();
  const hasPdcUplink = messages.some(m => m.category === 'pdc' && m.direction === 'uplink' && m.label === 'PDC');

  return (
    <div id="acars-messages">
      <div style={{ marginBottom: '1rem' }}>{backLink}</div>
      <PageHeader
        title={title}
        subtitle={`${messages.length} messages${scope === 'flight' && plannedLegId != null ? ` · including planned leg ${plannedLegId}` : ''}`}
        actions={loading ? undefined : (
          <Button kind="tertiary" size="md" disabled={refreshing} onClick={refresh}>
            {refreshing ? <InlineLoading description="Refreshing…" /> : 'Refresh'}
          </Button>
        )}
      />

      {loading ? (
        <InlineLoading description="Loading messages…" />
      ) : (
        <div className="acars-stack">
          <SendToolbar
            canned={canned} cannedError={cannedError} sendingId={sendingId}
            plannedLegId={plannedLegId} plannedLeg={plannedLeg}
            wxIcao={wxIcao} onWxIcaoChange={setWxIcao}
            siKeySet={siKeySet} hasPdcUplink={hasPdcUplink}
            sendError={sendError} siMessage={siMessage}
            onSend={handleSend} onLoadsheet={handleLoadsheet} onClearance={handleClearance}
            onPush={handleSiPush} onWx={handleWx}
          />
          {scope === 'flight' && (
            <SayIntentionsPanel
              status={siLinkStatus} sendingId={sendingId}
              onLink={handleSiLink} onUnlink={handleSiUnlink} onImport={handleSiImport}
            />
          )}
          <section aria-label="Thread">
            {ordered.length === 0 ? (
              <EmptyState
                title="No messages yet"
                description={scope === 'planned-leg' ? 'No ACARS messages for this planned leg yet.' : 'No ACARS messages for this flight yet.'}
              />
            ) : (
              <div className="acars-thread">
                {ordered.map(m => <MessageCard key={m.id} message={m} />)}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
