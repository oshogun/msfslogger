import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MapContainer } from 'react-leaflet';
import { airportGlyph, NavdataLayers, NavdataPanes, unwrapAirwayLeg, unwrapPoint, type NavdataVisibility } from './NavdataLayers';
import { FlightMap } from './FlightMap';
import { TripMap } from './TripMap';
import { mockFetchRoutes } from '../test/mockFetch';
import { absentStatus, emptyFeatures, presentStatus } from '../test/navdataFixtures';
import { flightFixture } from '../test/fixtures';
import type { FeatureAirport, FeatureRunway, FlightPoint } from '../types';

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
function stubCanvasContext() {
  const fakeCtx = new Proxy(
    {},
    {
      get: (target, prop) => (prop in target ? (target as Record<PropertyKey, unknown>)[prop] : () => undefined),
      set: (target, prop, value) => {
        (target as Record<PropertyKey, unknown>)[prop] = value;
        return true;
      },
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);
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
      longestRunwayM: null, surface: null, towered: null,
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
      ring: el.getAttribute('data-ring'),
      fill: el.getAttribute('data-fill'),
    }));
  }

  it('renders the unknown diamond with no ring for an index-only airport (nothing known)', () => {
    const { container } = renderAirports([airport({ ident: 'ZZAA', longestRunwayM: null, surface: null, towered: null })]);
    const [g] = glyphEls(container);
    expect(g).toEqual({ ident: 'ZZAA', shape: 'diamond', size: '8', ring: 'none', fill: 'transparent' });
  });

  it('is not the same claim as a known small/soft/untowered airport', () => {
    const indexOnly = airportGlyph(airport({ longestRunwayM: null, surface: null, towered: null }));
    const smallSoftUntowered = airportGlyph(airport({ longestRunwayM: 900, surface: 'soft', towered: false }));
    expect(indexOnly).not.toEqual(smallSoftUntowered);
  });

  it('fills a paved airport with the paved colour', () => {
    const { container } = renderAirports([airport({ ident: 'ZZPV', longestRunwayM: 3714.5, surface: 'paved', towered: true })]);
    const [g] = glyphEls(container);
    expect(g).toEqual({ ident: 'ZZPV', shape: 'disc', size: '18', ring: 'towered', fill: '#334155' });
  });

  it('fills a water airport with the water colour', () => {
    const { container } = renderAirports([airport({ ident: 'ZZWT', longestRunwayM: 1100, surface: 'water', towered: true })]);
    const [g] = glyphEls(container);
    expect(g).toEqual({ ident: 'ZZWT', shape: 'disc', size: '9', ring: 'towered', fill: '#0369a1' });
  });

  it('fills a soft-field airport with the soft colour', () => {
    const { container } = renderAirports([airport({ ident: 'ZZSF', longestRunwayM: 1500, surface: 'soft', towered: false })]);
    const [g] = glyphEls(container);
    expect(g).toEqual({ ident: 'ZZSF', shape: 'disc', size: '13', ring: 'none', fill: '#65a30d' });
  });

  it('differs only by ring between a towered and an untowered airport of the same size and surface', () => {
    const { container } = renderAirports([
      airport({ ident: 'ZZTW', longestRunwayM: 1500, surface: 'soft', towered: true }),
      airport({ ident: 'ZZNT', longestRunwayM: 1500, surface: 'soft', towered: false }),
    ]);
    const [towered, untowered] = glyphEls(container);
    expect(towered).toEqual({ ident: 'ZZTW', shape: 'disc', size: '13', ring: 'towered', fill: '#65a30d' });
    expect(untowered).toEqual({ ident: 'ZZNT', shape: 'disc', size: '13', ring: 'none', fill: '#65a30d' });
  });

  it('gives an unknown-towered airport a dashed ring, distinct from both towered and untowered', () => {
    const { container } = renderAirports([airport({ ident: 'ZZUK', longestRunwayM: 900, surface: 'soft', towered: null })]);
    const [g] = glyphEls(container);
    expect(g.ring).toBe('unknown');
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
