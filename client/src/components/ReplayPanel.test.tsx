import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import L from 'leaflet';
import type { FlightPoint } from '../types';

// Counts renders of a component that sits inside the MapContainer, so a test
// can prove animation frames never re-render the map subtree.
const polylineRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('react-leaflet', async () => {
  const actual = await vi.importActual<typeof import('react-leaflet')>('react-leaflet');
  return {
    ...actual,
    Polyline: (props: React.ComponentProps<typeof actual.Polyline>) => {
      polylineRenders.count++;
      return <actual.Polyline {...props} />;
    },
  };
});

import { ReplayPanel } from './ReplayPanel';

const T0 = Date.parse('2026-01-01T12:00:00.000Z');

function pt(i: number, over: Partial<FlightPoint> = {}): FlightPoint {
  return {
    id: i,
    flight_id: 1,
    ts: new Date(T0 + i * 5000).toISOString(),
    lat: 50 + i * 0.01,
    lon: 8 + i * 0.01,
    altitude_ft: 100 + i * 100,
    airspeed_kts: 100 + i,
    ground_speed_kts: 110 + i,
    heading_deg: 90,
    vertical_speed_fpm: 0,
    on_ground: i === 0 ? 1 : 0,
    ...over,
  };
}

const track = (n: number) => Array.from({ length: n }, (_, i) => pt(i));
const field = (name: string) =>
  document.querySelector<HTMLElement>(`[data-field="${name}"]`)!.textContent;

describe('ReplayPanel', () => {
  beforeEach(() => {
    polylineRenders.count = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders play, scrubber, speed and follow controls by accessible name', () => {
    render(<ReplayPanel points={track(10)} />);
    expect(screen.getByRole('button', { name: 'Play replay' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Replay position' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Replay speed' })).toHaveValue('16');
    expect(screen.getByRole('checkbox', { name: /Follow aircraft/ })).toBeChecked();
  });

  it('shows the first point in the readout on mount', () => {
    render(<ReplayPanel points={track(10)} />);
    expect(field('alt')).toBe('100 ft');
    expect(field('ias')).toBe('100 kt');
    expect(field('gs')).toBe('110 kt');
    expect(field('hdg')).toBe('090°');
    expect(field('state')).toBe('On ground');
    expect(field('point')).toBe('1 / 10');
    expect(field('time')).toBe('12:00:00Z');
  });

  it('updates the readout from the scrubber without starting playback', () => {
    render(<ReplayPanel points={track(10)} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Replay position' }), { target: { value: '10' } });
    expect(field('time')).toBe('12:00:10Z');
    expect(field('alt')).toBe('300 ft');
    expect(field('state')).toBe('Airborne');
    expect(screen.getByRole('button', { name: 'Play replay' })).toBeInTheDocument();
  });

  it('advances on play and freezes on pause', () => {
    vi.useFakeTimers();
    render(<ReplayPanel points={track(200)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play replay' }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const advanced = field('time');
    expect(advanced).not.toBe('12:00:00Z');
    fireEvent.click(screen.getByRole('button', { name: 'Pause replay' }));
    const frozen = field('time');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(field('time')).toBe(frozen);
  });

  it('shows Restart after reaching the end and plays again from the start', () => {
    vi.useFakeTimers();
    render(<ReplayPanel points={track(3)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play replay' }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(field('point')).toBe('3 / 3');
    const restart = screen.getByRole('button', { name: 'Restart replay' });
    fireEvent.click(restart);
    expect(screen.getByRole('button', { name: 'Pause replay' })).toBeInTheDocument();
    expect(field('point')).toBe('1 / 3');
  });

  it('moves the marker imperatively without re-rendering the map', () => {
    vi.useFakeTimers();
    const setLatLng = vi.spyOn(L.Marker.prototype, 'setLatLng');
    render(<ReplayPanel points={track(200)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play replay' }));
    const rendersAfterPlay = polylineRenders.count;
    const callsAfterPlay = setLatLng.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(setLatLng.mock.calls.length).toBeGreaterThan(callsAfterPlay + 20);
    expect(polylineRenders.count).toBe(rendersAfterPlay);
  });

  it('rotates the aircraft to heading - 90 degrees', () => {
    render(<ReplayPanel points={track(10).map(p => ({ ...p, heading_deg: 180 }))} />);
    const el = document.querySelector<HTMLElement>('.replay-aircraft')!;
    expect(el.style.transform).toBe('rotate(90deg)');
    fireEvent.change(screen.getByRole('slider', { name: 'Replay position' }), { target: { value: '10' } });
    expect(el.style.transform).toBe('rotate(90deg)');
  });

  it('handles Space, ArrowRight, and ignores keys from the scrubber', () => {
    render(<ReplayPanel points={track(200)} />);
    const panel = screen.getByRole('region', { name: 'Flight replay' });
    fireEvent.keyDown(panel, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Pause replay' })).toBeInTheDocument();
    fireEvent.keyDown(panel, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Play replay' })).toBeInTheDocument();

    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(field('time')).toBe('12:00:05Z');

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Replay position' }), { key: 'ArrowRight' });
    expect(field('time')).toBe('12:00:05Z');
  });

  it('renders a track that is entirely recording gaps without NaN', () => {
    const pts = [0, 1, 2].map(i => pt(i, { ts: new Date(T0 + i * 3600_000).toISOString() }));
    render(<ReplayPanel points={pts} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Replay position' }), { target: { value: '1' } });
    expect(field('state')).toMatch(/^Recording gap — /);
    for (const f of ['alt', 'ias', 'gs', 'vs', 'hdg', 'time']) {
      expect(field(f)).not.toMatch(/NaN/);
    }
  });

  it('says so when no point is usable', () => {
    render(<ReplayPanel points={[pt(0, { ts: 'bad' }), pt(1, { ts: 'bad' })]} />);
    expect(screen.getByText(/No replayable GPS points/)).toBeInTheDocument();
  });
});
