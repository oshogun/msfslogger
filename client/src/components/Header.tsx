import { Link, useNavigate } from 'react-router-dom';
import type { Status } from '../types';
import { useSession } from '../hooks/useSession';

interface Props {
  status: Status | null;
  serverError: boolean;
}

export function Header({ status, serverError }: Props) {
  const session = useSession();
  const navigate = useNavigate();

  async function handleLogout() {
    await session.logout();
    navigate('/login');
  }

  let dotClass = 'dot disconnected';
  let label = 'Checking...';

  if (serverError) {
    label = 'Server unreachable';
  } else if (status) {
    if (!status.connected) {
      label = 'Sim not connected';
    } else if (status.flightState === 'FLYING') {
      if (status.paused) {
        // Make it obvious the flight clock has stopped, not just the aircraft
        dotClass = 'dot paused';
        label = `Paused · ${status.aircraft || 'Unknown'}`;
      } else {
        dotClass = 'dot flying';
        label = `Recording · ${status.aircraft || 'Unknown'}`;
      }
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
        {session.user && (
          <div className="header-account">
            <span className="header-username">{session.user.username}</span>
            <button type="button" className="header-logout" onClick={handleLogout}>
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
