import { LiveMap } from './LiveMap';
import type { Status } from '../types';

interface Props {
  status: Status;
}

export function LivePanel({ status }: Props) {
  const { frame, flightState, aircraft } = status;
  if (flightState !== 'FLYING' || !frame) return null;

  const vs = Math.round(frame.verticalSpeedFpm);
  const vsColor = vs > 100 ? '#34d399' : vs < -100 ? '#f87171' : undefined;

  return (
    <div className="live-panel">
      <div className="live-panel-inner container">
        <div className="live-title">
          <span className="dot flying"></span>
          <span>{aircraft || 'Unknown'}</span>
        </div>
        <div className="live-grid">
          <div className="live-item">
            <div className="live-label">Airspeed</div>
            <div className="live-value">{Math.round(frame.airspeedKnots)}<span className="live-unit">kts</span></div>
          </div>
          <div className="live-item">
            <div className="live-label">Ground Speed</div>
            <div className="live-value">{Math.round(frame.groundSpeedKnots)}<span className="live-unit">kts</span></div>
          </div>
          <div className="live-item">
            <div className="live-label">Altitude</div>
            <div className="live-value">{Math.round(frame.altitudeFt).toLocaleString()}<span className="live-unit">ft</span></div>
          </div>
          <div className="live-item">
            <div className="live-label">Heading</div>
            <div className="live-value">{String(Math.round(frame.headingDeg)).padStart(3, '0')}<span className="live-unit">°</span></div>
          </div>
          <div className="live-item">
            <div className="live-label">Vert Speed</div>
            <div className="live-value" style={{ color: vsColor }}>
              {(vs >= 0 ? '+' : '') + vs.toLocaleString()}<span className="live-unit">fpm</span>
            </div>
          </div>
          <div className="live-item">
            <div className="live-label">Position</div>
            <div className="live-value" style={{ fontSize: '1rem' }}>{frame.lat.toFixed(3)}, {frame.lon.toFixed(3)}</div>
          </div>
        </div>
        <LiveMap status={status} />
      </div>
    </div>
  );
}
