import { Link } from 'react-router-dom';
import type { Status } from '../types';

interface Props {
  status: Status | null;
  serverError: boolean;
}

export function Header({ status, serverError }: Props) {
  let dotClass = 'dot disconnected';
  let label = 'Checking...';

  if (serverError) {
    label = 'Server unreachable';
  } else if (status) {
    if (!status.connected) {
      label = 'Sim not connected';
    } else if (status.flightState === 'FLYING') {
      dotClass = 'dot flying';
      label = `Recording · ${status.aircraft || 'Unknown'}`;
    } else {
      dotClass = 'dot connected';
      label = 'Connected · Idle';
    }
  }

  return (
    <header className="header">
      <h1><Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>msfs<span>logger</span></Link></h1>
      <div className="header-right">
        <div className="status-badge">
          <div className={dotClass}></div>
          <span>{label}</span>
        </div>
      </div>
    </header>
  );
}
