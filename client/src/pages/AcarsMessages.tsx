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
} from '../types';

/** Sentinel id for sendingId while a load sheet request is in flight — cannot collide with a canned id. */
const LOADSHEET_SENDING_ID = 'loadsheet';

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
  const { id } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<AcarsMessage[]>([]);
  const [plannedLegId, setPlannedLegId] = useState<number | null>(null);
  const [canned, setCanned] = useState<CannedAcarsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cannedError, setCannedError] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setCannedError('');
    Promise.all([
      apiFetch<AcarsThread>(`/api/flights/${id}/acars-messages`),
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
        setPlannedLegId(thread.planned_leg_id);
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
  }, [id]);

  async function handleSend(cannedId: string) {
    setSendingId(cannedId);
    setSendError('');
    try {
      const created = await apiFetch<AcarsMessage>(`/api/flights/${id}/acars-messages`, {
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

  const backLink = <Link to={`/flight/${id}`} className="back-link">← Flight #{id}</Link>;

  if (loadError) {
    // The thread endpoint answers a missing flight with exactly this text. The
    // fetch helper surfaces the server's message but not its status, so the
    // message is what identifies the case.
    const notFound = loadError === `Flight ${id} not found`;
    return (
      <main className="container">
        {backLink}
        <p className="edit-error">{notFound ? 'Flight not found' : loadError}</p>
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

      <h2 className="flight-title">ACARS Messages — Flight #{id}</h2>
      <p className="flight-subtitle">
        {messages.length} messages{plannedLegId != null ? ` · including planned leg ${plannedLegId}` : ''}
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
              </div>
            )}
            {sendError && <p className="edit-error">{sendError}</p>}
          </div>

          <div className="notes-section">
            <div className="section-title">Thread</div>
            <div className="acars-thread">
              {ordered.length === 0 ? (
                <p className="acars-empty">No ACARS messages for this flight yet.</p>
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
