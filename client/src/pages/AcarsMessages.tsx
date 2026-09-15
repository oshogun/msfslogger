import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, UnauthorizedError } from '../utils/api';
import { formatDate } from '../utils/format';
import type {
  AcarsMessage,
  AcarsThread,
  CannedAcarsMessage,
  CannedAcarsMessageList,
  LoadsheetRequestResponse,
  PlannedLegAcarsThread,
  PlannedLegWithChildren,
  PlannedLegWxRequestResponse,
  WxRequestResponse,
} from '../types';

/** Sentinel id for sendingId while a load sheet request is in flight — cannot collide with a canned id. */
const LOADSHEET_SENDING_ID = 'loadsheet';
/** Sentinel id for sendingId while a weather request is in flight — cannot collide with a canned id. */
const WX_SENDING_ID = 'wx';

/** A client-side-only sanity check; the server is still the authority (400 INVALID_ICAO). */
function isPlausibleIcao(v: string): boolean {
  return /^[A-Za-z0-9]{4}$/.test(v.trim());
}

/**
 * The categories this client has a badge colour for. Any other well-shaped
 * category the server stores still renders — it falls back to the neutral
 * "other" badge rather than interpolating an unknown class name.
 */
const KNOWN_CATEGORIES = ['pdc', 'wx', 'freetext', 'position-report', 'dispatch', 'oooi'];

function categoryClass(category: string): string {
  return KNOWN_CATEGORIES.includes(category) ? category : 'other';
}

/**
 * The words, not the jargon: "uplink"/"downlink" is exactly the pair a reader
 * has to look up. The raw direction stays in the DOM as the row's class.
 */
function directionLabel(direction: string): string {
  return direction === 'uplink' ? 'Dispatch' : 'Cockpit';
}

function AcarsRow({ message }: { message: AcarsMessage }) {
  return (
    <div className={`acars-msg acars-msg--${message.direction === 'uplink' ? 'uplink' : 'downlink'}`}>
      <div className="acars-msg-head">
        <span className={`badge badge-${message.direction === 'uplink' ? 'uplink' : 'downlink'}`}>
          {directionLabel(message.direction)}
        </span>
        <span className={`badge badge-acars-${categoryClass(message.category)}`}>{message.category}</span>
        <span>{message.label || message.category}</span>
        <span className="acars-msg-time">{formatDate(message.sent_at)}</span>
      </div>
      <div className="acars-msg-body">{message.body}</div>
    </div>
  );
}

export function AcarsMessages() {
  // Two mutually exclusive scopes on one page: a flight's own ACARS log
  // (`id`), or a planned leg's pre-flight log before any flight is linked
  // (`legId`). Exactly one of the two params is ever set by the routes in
  // App.tsx, so `scope` is derived once and used throughout.
  const { id, legId } = useParams<{ id?: string; legId?: string }>();
  const scope: 'flight' | 'planned-leg' = legId != null ? 'planned-leg' : 'flight';
  const [messages, setMessages] = useState<AcarsMessage[]>([]);
  const [plannedLegId, setPlannedLegId] = useState<number | null>(scope === 'planned-leg' ? Number(legId) : null);
  const [plannedLeg, setPlannedLeg] = useState<PlannedLegWithChildren | null>(null);
  const [canned, setCanned] = useState<CannedAcarsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cannedError, setCannedError] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState('');
  const [wxIcao, setWxIcao] = useState('');

  const threadPath = scope === 'planned-leg'
    ? `/api/planned-legs/${legId}/acars-messages`
    : `/api/flights/${id}/acars-messages`;
  const sendPath = scope === 'planned-leg'
    ? `/api/planned-legs/${legId}/acars-messages`
    : `/api/flights/${id}/acars-messages`;
  const wxPath = scope === 'planned-leg'
    ? `/api/planned-legs/${legId}/acars-messages/wx`
    : `/api/flights/${id}/acars-messages/wx`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setCannedError('');
    Promise.all([
      apiFetch<AcarsThread | PlannedLegAcarsThread>(threadPath),
      // The canned set is a separate resource: if only it fails, the thread is
      // still worth rendering read-only, so its failure is folded into a null
      // here instead of rejecting the pair. A 401 is re-thrown so the session
      // bounce still happens.
      apiFetch<CannedAcarsMessageList>('/api/acars/canned-messages').catch(err => {
        if (err instanceof UnauthorizedError) throw err;
        return null;
      }),
    ])
      .then(([thread, cannedList]) => {
        if (cancelled) return;
        setMessages(thread.messages);
        // A planned-leg thread's own id is always the route param; only the
        // flight-scoped thread can name a leg (or not) as an extra fact.
        setPlannedLegId(scope === 'planned-leg' ? Number(legId) : (thread as AcarsThread).planned_leg_id);
        if (cannedList) setCanned(cannedList.messages);
        else setCannedError('Canned messages unavailable');
      })
      .catch(err => {
        // A 401 has already been handled by the fetch helper, which redirects
        // to the login page — showing "Authentication required" as a page
        // error on the way out would be noise.
        if (cancelled || err instanceof UnauthorizedError) return;
        setLoadError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, legId, scope, threadPath]);

  // Convenience-only lookup for the REQUEST WX default: a failure here means no
  // suggested ICAO, not a page error. A 401 still bounces via apiFetch itself;
  // anything else is swallowed silently — the quick-fill buttons simply don't
  // render, same as a non-airport waypoint would. In the planned-leg scope
  // this is also how the back link finds the leg's trip.
  useEffect(() => {
    if (plannedLegId === null) {
      setPlannedLeg(null);
      return;
    }
    let cancelled = false;
    apiFetch<PlannedLegWithChildren>(`/api/planned-legs/${plannedLegId}`)
      .then(leg => { if (!cancelled) setPlannedLeg(leg); })
      .catch(err => {
        if (!(err instanceof UnauthorizedError)) setPlannedLeg(null);
      });
    return () => { cancelled = true; };
  }, [plannedLegId]);

  // Re-derive the default whenever the leg (or its absence) changes — but only
  // while the user has not already typed something, so a fetched leg cannot
  // clobber mid-edit input.
  useEffect(() => {
    if (wxIcao !== '') return;
    if (plannedLeg?.destination_is_airport) setWxIcao(plannedLeg.destination_ident);
    else if (plannedLeg?.departure_is_airport) setWxIcao(plannedLeg.departure_ident);
  }, [plannedLeg]);

  async function handleSend(cannedId: string) {
    setSendingId(cannedId);
    setSendError('');
    try {
      const created = await apiFetch<AcarsMessage>(sendPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canned_id: cannedId }),
      });
      // The 201 is the row the server actually stored, so appending it is all
      // the thread needs — no refetch, no reload, and nothing optimistic to
      // reconcile if the send is rejected.
      setMessages(prev => [...prev, created]);
    } catch (err) {
      if (err instanceof UnauthorizedError) return;
      setSendError((err as Error).message);
    } finally {
      setSendingId(null);
    }
  }

  async function handleRequestLoadsheet() {
    if (plannedLegId === null) return;
    setSendingId(LOADSHEET_SENDING_ID);
    setSendError('');
    try {
      const response = await apiFetch<LoadsheetRequestResponse>(
        `/api/planned-legs/${plannedLegId}/acars-messages/loadsheet`,
        { method: 'POST' },
      );
      // A re-request returns the same stored pair (created: false), already in
      // the thread — merge by id rather than push, or the duplicate rows would
      // collide on React key.
      setMessages(prev => {
        const merged = [...prev];
        for (const m of [response.request, response.reply]) {
          const existingIndex = merged.findIndex(existing => existing.id === m.id);
          if (existingIndex === -1) merged.push(m);
          else merged[existingIndex] = m;
        }
        merged.sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id - b.id);
        return merged;
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) return;
      setSendError((err as Error).message);
    } finally {
      setSendingId(null);
    }
  }

  async function handleRequestWx() {
    const icao = wxIcao.trim().toUpperCase();
    setSendingId(WX_SENDING_ID);
    setSendError('');
    try {
      const response = await apiFetch<WxRequestResponse | PlannedLegWxRequestResponse>(wxPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icao }),
      });
      // Every accepted call creates two brand-new rows — never rows already in
      // state, unlike the load sheet's re-request. A plain append is correct
      // here, the same shape as handleSend's canned-message append.
      setMessages(prev => [...prev, response.request, response.reply]);
    } catch (err) {
      if (err instanceof UnauthorizedError) return;
      setSendError((err as Error).message);
    } finally {
      setSendingId(null);
    }
  }

  const title = scope === 'planned-leg'
    ? `ACARS Messages — Planned leg #${legId}`
    : `ACARS Messages — Flight #${id}`;

  // The planned-leg scope's back link goes to the leg's trip, known only once
  // the leg itself has loaded; until then it falls back to the trips list
  // rather than a link that might point at the wrong place.
  const backLink = scope === 'planned-leg'
    ? (
      <Link to={plannedLeg ? `/trip/${plannedLeg.trip_id}` : '/flights'} className="back-link">
        ← Back to trip
      </Link>
    )
    : <Link to={`/flight/${id}`} className="back-link">← Flight #{id}</Link>;

  if (loadError) {
    // Each thread endpoint answers a missing parent with exactly this text.
    // The fetch helper surfaces the server's message but not its status, so
    // the message is what identifies the case.
    const notFound = scope === 'planned-leg'
      ? loadError === `Planned leg ${legId} not found`
      : loadError === `Flight ${id} not found`;
    return (
      <main className="container">
        {backLink}
        <p className="edit-error">{notFound ? (scope === 'planned-leg' ? 'Planned leg not found' : 'Flight not found') : loadError}</p>
      </main>
    );
  }

  // Newest at top, the convention of the message list this page stands in for.
  // A copy, never messages.reverse(): the state stays oldest-first, the order
  // the API returns and the order an appended message belongs at the end of.
  const ordered = [...messages].reverse();

  return (
    <main className="container" id="acars-messages">
      {backLink}

      <h2 className="flight-title">{title}</h2>
      <p className="flight-subtitle">
        {messages.length} messages
        {scope === 'flight' && plannedLegId != null ? ` · including planned leg ${plannedLegId}` : ''}
      </p>

      {loading ? (
        <p className="flight-plan-status">Loading messages…</p>
      ) : (
        <>
          <div className="notes-section">
            <div className="section-title">Send</div>
            {cannedError ? (
              <p className="edit-error">{cannedError}</p>
            ) : (
              <div className="acars-send">
                {canned.map(m => (
                  <button
                    key={m.id}
                    className="btn btn-ghost"
                    disabled={sendingId !== null}
                    onClick={() => handleSend(m.id)}
                  >
                    {sendingId === m.id ? 'Sending…' : m.label}
                  </button>
                ))}
                <button
                  className="btn btn-ghost"
                  disabled={plannedLegId === null || sendingId !== null}
                  title={plannedLegId === null ? 'No planned leg linked to this flight' : undefined}
                  onClick={handleRequestLoadsheet}
                >
                  {sendingId === LOADSHEET_SENDING_ID ? 'Requesting…' : 'REQUEST LOADSHEET'}
                </button>
                <input
                  type="text"
                  value={wxIcao}
                  placeholder="ICAO"
                  disabled={sendingId !== null}
                  onChange={e => setWxIcao(e.target.value)}
                />
                {plannedLeg?.departure_is_airport ? (
                  <button
                    className="btn btn-ghost"
                    disabled={sendingId !== null}
                    onClick={() => setWxIcao(plannedLeg.departure_ident)}
                  >
                    {plannedLeg.departure_ident}
                  </button>
                ) : null}
                {plannedLeg?.destination_is_airport ? (
                  <button
                    className="btn btn-ghost"
                    disabled={sendingId !== null}
                    onClick={() => setWxIcao(plannedLeg.destination_ident)}
                  >
                    {plannedLeg.destination_ident}
                  </button>
                ) : null}
                <button
                  className="btn btn-ghost"
                  disabled={sendingId !== null || !isPlausibleIcao(wxIcao)}
                  onClick={handleRequestWx}
                >
                  {sendingId === WX_SENDING_ID ? 'Requesting…' : 'REQUEST WX'}
                </button>
              </div>
            )}
            {sendError && <p className="edit-error">{sendError}</p>}
          </div>

          <div className="notes-section">
            <div className="section-title">Thread</div>
            <div className="acars-thread">
              {ordered.length === 0 ? (
                <p className="acars-empty">
                  {scope === 'planned-leg' ? 'No ACARS messages for this planned leg yet.' : 'No ACARS messages for this flight yet.'}
                </p>
              ) : (
                ordered.map(m => <AcarsRow key={m.id} message={m} />)
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
