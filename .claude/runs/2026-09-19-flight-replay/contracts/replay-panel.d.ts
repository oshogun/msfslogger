// Reference stub — NOT wired into the build. The frozen component seam for
// client/src/components/ReplayPanel.tsx and its entry point in
// client/src/pages/FlightDetail.tsx.
//
// Prose, DOM contract, camera and keyboard rules: design.md §7.

import type { FlightPoint, FrameScheduler, ReplayEventMarker } from './replay-engine';

export interface ReplayPanelProps {
  /** The flight's full, non-downsampled point list, straight from GET /api/flights/:id. */
  points: FlightPoint[];
  /** DOM id, so FlightDetail's toggle can name it in aria-controls. */
  id?: string;
  /**
   * Phase 2 (design.md §8). Absent in phase 1. No tick is drawn for an event
   * whose realMs falls outside the recorded span.
   */
  events?: ReplayEventMarker[];
  /** Test seam, forwarded to useReplayClock. Undefined in the app. */
  scheduler?: FrameScheduler;
}

export declare function ReplayPanel(props: ReplayPanelProps): JSX.Element;

/**
 * FlightDetail renders, between the "GPS Track" section and the "Altitude
 * Profile" section, and only when (flight.points?.length ?? 0) >= 2:
 *
 *   <div className="replay-section">
 *     <div className="section-title">Replay</div>
 *     <button className="btn btn-ghost" aria-expanded={replayOpen}
 *             aria-controls="replay-panel"
 *             onClick={() => setReplayOpen(o => !o)}>
 *       {replayOpen ? 'Hide replay' : 'Replay flight'}
 *     </button>
 *     {replayOpen && <ReplayPanel id="replay-panel" points={flight.points!} />}
 *   </div>
 *
 * Mounted on demand, never merely hidden: no Leaflet map exists until the
 * operator asks for one.
 */
export declare const FLIGHT_DETAIL_ENTRY: unique symbol;
