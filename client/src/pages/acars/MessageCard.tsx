import { Tag, Tile } from '@carbon/react';
import { StatusTag } from '../../components/StatusTag';
import type { StatusKind } from '../../components/StatusTag';
import type { AcarsMessage } from '../../types';
import { formatDate } from '../../utils/format';
import './acars.scss';

const KNOWN = ['pdc', 'wx', 'freetext', 'position-report', 'dispatch', 'oooi'];

/** Any other category the server stores still renders, as the neutral kind. */
function categoryKind(category: string): StatusKind {
  return (KNOWN.includes(category) ? `acars-${category}` : 'acars-unknown') as StatusKind;
}

/** The words, not the jargon: uplink is Dispatch speaking, downlink is the cockpit. */
const isUplink = (m: AcarsMessage) => m.direction === 'uplink';

export function MessageCard({ message }: { message: AcarsMessage }) {
  const up = isUplink(message);
  return (
    <Tile className={`acars-msg acars-msg--${up ? 'uplink' : 'downlink'}`} data-testid="acars-msg" data-message-id={message.id}>
      <div className="acars-msg__head">
        <Tag type={up ? 'blue' : 'teal'} size="md" title={up ? 'Uplink' : 'Downlink'}>{up ? 'Dispatch' : 'Cockpit'}</Tag>
        <StatusTag kind={categoryKind(message.category)}>{message.category}</StatusTag>
        <span className="acars-msg__label">{message.label || message.category}</span>
        <span className="acars-msg__time">{formatDate(message.sent_at)}</span>
      </div>
      <pre className="acars-msg__body">{message.body}</pre>
    </Tile>
  );
}
