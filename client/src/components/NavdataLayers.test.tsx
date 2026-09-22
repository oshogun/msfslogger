import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MapContainer } from 'react-leaflet';
import { airportGlyph, NavdataLayers, NavdataPanes, unwrapAirwayLeg, unwrapPoint, type NavdataVisibility } from './NavdataLayers';
import { FlightMap } from './FlightMap';
import { TripMap } from './TripMap';
import { mockFetchRoutes } from '../test/mockFetch';
import { absentStatus, emptyFeatures, presentStatus } from '../test/navdataFixtures';
import { flightFixture } from '../test/fixtures';
import type { FeatureAirport, FeatureNavaid, FeatureRunway, FeatureWaypoint, FeaturesResponse, FlightPoint } from '../types';

const points: FlightPoint[] = Array.from({ length: 4 }, (_, i) => ({
  id: i, flight_id: 1, ts: '2026-01-01T12:00:00Z', lat: 10 + i * 0.1, lon: 20 + i * 0.1, altitude_ft: 1000,
  airspeed_kts: 100, ground_speed_kts: 100, heading_deg: 90, vertical_speed_fpm: 0, on_ground: 0,
}));
const trip = { ...flightFixture, points };

describe('antimeridian unwrapping', () => {
  it('draws a dateline airway leg through the unwrapped chain, not across the world', () => {
    const [from, to] = unwrapAirwayLeg([0, 179], [0, 179.5], [0, -179.5]);
    expect(from).toEqual([0, 179.5]);
    expect(to).toEqual([0, 180.5]);
  });

  it('places a leg anchored east of the dateline in the same frame', () => {
    const [from, to] = unwrapAirwayLeg([0, -179], [0, 179.5], [0, -179.5]);
    expect(from[1]).toBeCloseTo(-180.5);
    expect(to[1]).toBeCloseTo(-179.5);
  });

  it('puts a marker position beside the anchor, not a world-copy away', () => {
    expect(unwrapPoint([5, 181], 5, -179)).toEqual([5, 181]);
    expect(unwrapPoint([5, -181], 5, 179)).toEqual([5, -181]);
  });
});

describe('maps without navdata', () => {
  afterEach(() => vi.restoreAllMocks());

  it('render identically whether or not the navdata prop is set while the replica is absent', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(absentStatus), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const plain = render(<FlightMap preferCanvas={false} points={points} />);
    const plainHtml = plain.container.innerHTML;
    plain.unmount();
    expect(fetchSpy).not.toHaveBeenCalled();

    const withNav = render(<FlightMap preferCanvas={false} points={points} navdata />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/navdata/status', expect.anything()));
    await new Promise(r => setTimeout(r, 20));
    expect(withNav.container.innerHTML).toBe(plainHtml);
    expect(screen.queryByText('Navdata')).toBeNull();
    expect(withNav.container.querySelector('.leaflet-navdata-pane')).toBeNull();
  });

  it('render no navdata pane or request when the prop is left off, even on a present replica', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(presentStatus), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { container } = render(<TripMap preferCanvas={false} flights={[trip]} />);
    await new Promise(r => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelector('.leaflet-navdata-pane')).toBeNull();
  });

  it('create the panes and the controls when the replica is present', async () => {
    mockFetchRoutes({ '/api/navdata/status': [200, presentStatus] });
    const { container } = render(<FlightMap preferCanvas={false} points={points} navdata />);
    await waitFor(() => expect(screen.getByText('Navdata')).toBeInTheDocument());
    const nav = container.querySelector<HTMLElement>('.leaflet-navdata-pane')!;
    const markers = container.querySelector<HTMLElement>('.leaflet-navdata-markers-pane')!;
    expect(nav.style.zIndex).toBe('350');
    expect(markers.style.zIndex).toBe('360');
  });
});

// jsdom has no real <canvas> 2D context, and the runway polyline always draws
// through Leaflet's own canvas renderer (never the SVG one), so exercising it
// here needs a context stub — every draw call is a no-op, only property
// assignment is kept, which is all the renderer needs to not throw.
function stubCanvasContext(): Record<PropertyKey, unknown> {
  const target: Record<PropertyKey, unknown> = {};
  const fakeCtx = new Proxy(
    target,
    {
      get: (t, prop) => (prop in t ? t[prop as PropertyKey] : () => undefined),
      set: (t, prop, value) => {
        t[prop as PropertyKey] = value;
        return true;
      },
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);
  return target;
}

describe('runway-end labels', () => {
  const allOff: NavdataVisibility = { airports: false, navaids: false, waypoints: false, airways: false, runways: false };

  beforeEach(() => stubCanvasContext());

  function runway(over: Partial<FeatureRunway> = {}): FeatureRunway {
    return {
      airport: 'ZZAA', lat: 10, lon: 20, headingDeg: 140, lengthM: 2000, widthM: 45,
      designation: '14L', secondaryDesignation: '32R',
      ...over,
    };
  }

  function renderRunways(runways: FeatureRunway[], runwaysVisible: boolean) {
    const data = emptyFeatures({ runways });
    return render(
      <MapContainer center={[10, 20]} zoom={13} style={{ height: 300, width: 300 }}>
        <NavdataPanes>
          <NavdataLayers data={data} anchor={[10, 20]} visible={{ ...allOff, runways: runwaysVisible }} />
        </NavdataPanes>
      </MapContainer>
    );
  }

  // Runway-end labels are the only rotated element this layer draws — the
  // dot-plus-text markers for waypoints/navaids/airports never rotate.
  function rotatedLabels(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>('div'))
      .filter(el => (el.getAttribute('style') ?? '').includes('rotate('))
      .map(el => ({ text: el.textContent, style: el.getAttribute('style') ?? '' }));
  }

  it('draws both ends, each rotated to its own approach heading', () => {
    const { container } = renderRunways([runway()], true);
    const labels = rotatedLabels(container);
    expect(labels).toHaveLength(2);
    const primary = labels.find(l => l.text === '14L');
    const secondary = labels.find(l => l.text === '32R');
    expect(primary?.style).toContain('rotate(140deg)');
    expect(secondary?.style).toContain('rotate(320deg)');
  });

  it('wraps the secondary end past 360 back into 0-360', () => {
    const { container } = renderRunways([runway({ headingDeg: 250, designation: '25', secondaryDesignation: '07' })], true);
    const labels = rotatedLabels(container);
    const primary = labels.find(l => l.text === '25');
    const secondary = labels.find(l => l.text === '07');
    expect(primary?.style).toContain('rotate(250deg)');
    expect(secondary?.style).toContain('rotate(70deg)');
  });

  it('draws only the primary label when the secondary designation is unknown', () => {
    const { container } = renderRunways([runway({ secondaryDesignation: '' })], true);
    const labels = rotatedLabels(container);
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('14L');
    expect(labels[0].style).toContain('rotate(140deg)');
  });

  it('draws only the secondary label when the primary designation is unknown', () => {
    const { container } = renderRunways([runway({ designation: '' })], true);
    const labels = rotatedLabels(container);
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('32R');
    expect(labels[0].style).toContain('rotate(320deg)');
  });

  it('draws no runway labels at all when runways are hidden', () => {
    const { container } = renderRunways([runway()], false);
    expect(rotatedLabels(container)).toHaveLength(0);
  });
});

describe('airport glyphs', () => {
  const allOff: NavdataVisibility = { airports: false, navaids: false, waypoints: false, airways: false, runways: false };

  function airport(over: Partial<FeatureAirport> = {}): FeatureAirport {
    return {
      ident: 'ZZAA', lat: 10, lon: 20, name: null, hasDetail: true, runways: 1, procedures: 1,
      longestRunwayM: null, surface: null, towered: null, longestRunwayHeadingDeg: null,
      ...over,
    };
  }

  function renderAirports(airports: FeatureAirport[]) {
    const data = emptyFeatures({ airports });
    return render(
      <MapContainer center={[10, 20]} zoom={13} style={{ height: 300, width: 300 }}>
        <NavdataPanes>
          <NavdataLayers data={data} anchor={[10, 20]} visible={{ ...allOff, airports: true }} />
        </NavdataPanes>
      </MapContainer>
    );
  }

  // The `data-*` attributes are the contract: a test reads the glyph's own
  // claim off them, never the inline CSS that renders it.
  function glyphEls(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>('div[data-glyph]')).map(el => ({
      ident: el.textContent,
      shape: el.getAttribute('data-glyph'),
      size: el.getAttribute('data-size'),
      color: el.getAttribute('data-color'),
      fill: el.getAttribute('data-fill'),
    }));
  }

  function directionLines(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>('span[data-direction-line]')).map(el => ({
      rotateDeg: el.getAttribute('data-rotate-deg'),
      style: el.getAttribute('style') ?? '',
    }));
  }

  it('renders the unknown diamond with no color claim and no line for an index-only airport (nothing known)', () => {
    const { container } = renderAirports([airport({ ident: 'ZZAA', longestRunwayM: null, surface: null, towered: null, longestRunwayHeadingDeg: null })]);
    const [g] = glyphEls(container);
    expect(g).toEqual({ ident: 'ZZAA', shape: 'diamond', size: '8', color: 'none', fill: 'none' });
    expect(directionLines(container)).toHaveLength(0);
  });

  it('is not the same claim as a known small/soft/untowered airport', () => {
    const indexOnly = airportGlyph(airport({ longestRunwayM: null, surface: null, towered: null }));
    const smallSoftUntowered = airportGlyph(airport({ longestRunwayM: 900, surface: 'soft', towered: false }));
    expect(indexOnly).not.toEqual(smallSoftUntowered);
  });

  it('colors a towered airport blue', () => {
    const { container } = renderAirports([airport({ ident: 'ZZTW', longestRunwayM: 1500, surface: 'soft', towered: true })]);
    const [g] = glyphEls(container);
    expect(g.color).toBe('#1d4ed8');
  });

  it('colors an uncontrolled airport purple', () => {
    const { container } = renderAirports([airport({ ident: 'ZZNT', longestRunwayM: 1500, surface: 'soft', towered: false })]);
    const [g] = glyphEls(container);
    expect(g.color).toBe('#c026d3');
  });

  it('colors a tower-unknown airport gray, distinct from both towered and untowered', () => {
    const { container } = renderAirports([airport({ ident: 'ZZUK', longestRunwayM: 900, surface: 'soft', towered: null })]);
    const [g] = glyphEls(container);
    expect(g.color).toBe('#94a3b8');
    expect(g.color).not.toBe('#1d4ed8');
    expect(g.color).not.toBe('#c026d3');
  });

  it('renders a paved airport hollow', () => {
    const { container } = renderAirports([airport({ ident: 'ZZPV', longestRunwayM: 3714.5, surface: 'paved', towered: true })]);
    const [g] = glyphEls(container);
    expect(g).toEqual({ ident: 'ZZPV', shape: 'disc', size: '18', color: '#1d4ed8', fill: 'hollow' });
  });

  it('renders a soft-field airport filled', () => {
    const { container } = renderAirports([airport({ ident: 'ZZSF', longestRunwayM: 1500, surface: 'soft', towered: false })]);
    const [g] = glyphEls(container);
    expect(g).toEqual({ ident: 'ZZSF', shape: 'disc', size: '13', color: '#c026d3', fill: 'filled' });
  });

  it('renders a water airport filled, same treatment as soft', () => {
    const { container } = renderAirports([airport({ ident: 'ZZWT', longestRunwayM: 1100, surface: 'water', towered: true })]);
    const [g] = glyphEls(container);
    expect(g).toEqual({ ident: 'ZZWT', shape: 'disc', size: '9', color: '#1d4ed8', fill: 'filled' });
  });

  it('renders a surface-unknown airport as reduced-opacity filled, distinct from both hollow and filled', () => {
    const { container } = renderAirports([airport({ ident: 'ZZSU', longestRunwayM: 1500, surface: null, towered: true })]);
    const [g] = glyphEls(container);
    expect(g.fill).toBe('faded');
  });

  it('draws a runway-direction line at the mod-180 rotation for a known heading', () => {
    const { container } = renderAirports([airport({ ident: 'ZZHD', longestRunwayM: 1500, surface: 'paved', towered: true, longestRunwayHeadingDeg: 70 })]);
    const lines = directionLines(container);
    expect(lines).toHaveLength(1);
    expect(lines[0].rotateDeg).toBe('70');
  });

  it('draws the same rotation for headings 180 degrees apart, since a line has no direction', () => {
    const { container } = renderAirports([
      airport({ ident: 'ZZH1', longestRunwayM: 1500, surface: 'paved', towered: true, longestRunwayHeadingDeg: 250 }),
      airport({ ident: 'ZZH2', longestRunwayM: 1500, surface: 'paved', towered: true, longestRunwayHeadingDeg: 70 }),
    ]);
    const lines = directionLines(container);
    expect(lines).toHaveLength(2);
    expect(lines[0].rotateDeg).toBe(lines[1].rotateDeg);
    expect(lines[0].rotateDeg).toBe('70');
  });

  it('draws no line at all when the heading is unknown', () => {
    const { container } = renderAirports([airport({ ident: 'ZZNH', longestRunwayM: 1500, surface: 'paved', towered: true, longestRunwayHeadingDeg: null })]);
    expect(directionLines(container)).toHaveLength(0);
  });

  // The line's own span is a horizontal bar at rest (its long axis lies
  // along screen bearing 090), so pointing it at a given heading needs a
  // -90 correction on top of the raw heading — pinning the actual applied
  // CSS rotation for two cardinal headings catches a constant-90°-off bug
  // that the mod-180 test above would not (a line 90° off at every heading
  // still renders N and N+180 identically).
  it('rotates the CSS transform 90 degrees short of a north heading, since the bar itself rests along bearing 090', () => {
    const { container } = renderAirports([airport({ ident: 'ZZN', longestRunwayM: 1500, surface: 'paved', towered: true, longestRunwayHeadingDeg: 0 })]);
    const [line] = directionLines(container);
    expect(line.style).toContain('rotate(-90deg)');
  });

  it('applies no rotation offset for an east heading, which already matches the bar\'s resting axis', () => {
    const { container } = renderAirports([airport({ ident: 'ZZE', longestRunwayM: 1500, surface: 'paved', towered: true, longestRunwayHeadingDeg: 90 })]);
    const [line] = directionLines(container);
    expect(line.style).toContain('rotate(0deg)');
  });

  it('sizes at the large/medium tier boundary, 2500 m', () => {
    expect(airportGlyph(airport({ longestRunwayM: 2500 })).sizePx).toBe(18);
    expect(airportGlyph(airport({ longestRunwayM: 2499.99 })).sizePx).toBe(13);
  });

  it('sizes at the medium/small tier boundary, 1200 m', () => {
    expect(airportGlyph(airport({ longestRunwayM: 1200 })).sizePx).toBe(13);
    expect(airportGlyph(airport({ longestRunwayM: 1199.99 })).sizePx).toBe(9);
  });

  it('gives an unknown length no size claim at all: an 8px diamond, not a small disc', () => {
    const g = airportGlyph(airport({ longestRunwayM: null }));
    expect(g.shape).toBe('diamond');
    expect(g.sizePx).toBe(8);
  });
});

describe('waypoint markers', () => {
  const allOff: NavdataVisibility = { airports: false, navaids: false, waypoints: false, airways: false, runways: false };

  function waypoint(over: Partial<FeatureWaypoint> = {}): FeatureWaypoint {
    return { key: 'W1', ident: 'ZAKRO', region: 'ZZ', lat: 10, lon: 20, terminal: null, ...over };
  }

  function navaid(over: Partial<FeatureNavaid> = {}): FeatureNavaid {
    return { kind: 'V', ident: 'ZZVR', region: 'ZZ', lat: 10, lon: 20, frequencyHz: null, name: null, navType: null, isDme: null, ...over };
  }

  function renderNavdata(data: Partial<FeaturesResponse>, visible: Partial<NavdataVisibility>) {
    const full = emptyFeatures(data);
    return render(
      <MapContainer center={[10, 20]} zoom={13} style={{ height: 300, width: 300 }}>
        <NavdataPanes>
          <NavdataLayers data={full} anchor={[10, 20]} visible={{ ...allOff, ...visible }} />
        </NavdataPanes>
      </MapContainer>
    );
  }

  it('draws the labelled waypoint as a hollow magenta triangle, not a filled dot', () => {
    const { container } = renderNavdata({ waypoints: [waypoint()] }, { waypoints: true });
    const polygon = container.querySelector('svg polygon');
    expect(polygon).not.toBeNull();
    expect(polygon!.getAttribute('fill')).toBe('none');
    expect(polygon!.getAttribute('stroke')).toBe('#c026d3');
    // no dot markup like the other labelled navdata markers use
    expect(container.querySelector('span[style*="border-radius:50%"]')).toBeNull();
  });

  it('labels the waypoint magenta with a white halo, not the black halo other labels use', () => {
    renderNavdata({ waypoints: [waypoint({ ident: 'ZAKRO' })] }, { waypoints: true });
    const label = screen.getByText('ZAKRO');
    const style = label.getAttribute('style') ?? '';
    expect(style).toContain('color:#c026d3');
    expect(style).toContain('text-shadow:0 0 3px #fff');
  });

  it('keeps the dense fallback a canvas CircleMarker recolored to magenta, not a per-node icon', async () => {
    const ctx = stubCanvasContext();
    const dense = Array.from({ length: 151 }, (_, i) => waypoint({ key: `W${i}`, ident: `W${i}`, lat: 10 + i * 0.001 }));
    const { container } = renderNavdata({ waypoints: dense }, { waypoints: true });
    // Leaflet's canvas renderer schedules its draw on the next frame.
    await new Promise(r => setTimeout(r, 50));
    expect(container.querySelector('svg polygon')).toBeNull();
    expect(container.querySelector('.leaflet-marker-icon')).toBeNull();
    expect(ctx.strokeStyle).toBe('#c026d3');
  });

  it('leaves navaids on their own sky-blue dot-and-label styling, unaffected by the waypoint change', () => {
    const { container } = renderNavdata({ navaids: [navaid({ ident: 'ZZVR' })] }, { navaids: true });
    expect(container.querySelector('svg polygon')).toBeNull();
    const dot = container.querySelector<HTMLElement>('span[style*="border-radius:50%"]');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute('style')).toContain('background:#38bdf8');
    const label = screen.getByText('ZZVR');
    const style = label.getAttribute('style') ?? '';
    expect(style).toContain('color:#e2e8f0');
    expect(style).toContain('text-shadow:0 0 3px #000');
  });
});
