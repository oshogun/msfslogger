import { useCallback, useEffect, useMemo, useState } from 'react';
import { useExportPdf } from '../components/ExportPdfButton';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Button, ContentSwitcher, InlineNotification, Link, SkeletonText, Switch, Tile,
} from '@carbon/react';
import { ConfirmModal } from '../components/ConfirmModal';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatTiles } from '../components/StatTiles';
import { StatusTag } from '../components/StatusTag';
import { LnmplnImportPanel, SimbriefImportPanel, SkipLegConfirm } from '../components/legs';
import {
  detailTargets, FetchDetailPrompt, geometryHasChains, NavdataOverlay, procedureNote, RouteGeometryLayer, TripMap,
  useRouteGeometry,
} from '../components/maps';
import type { LegOverlay } from '../components/maps';
import * as api from '../mock/api';
import type {
  Flight, Journey, PlannedLegImportResponse, PlannedLegListItem, PlannedLegWithChildren, SimbriefImportResult, Trip,
} from '../mock/types';
import { formatAlt, formatDistance, formatDuration } from '../utils/format';
import { buildTripKml, downloadKml } from '../utils/kml';
import { EditTripModal } from './tripdetail/EditTripModal';
import { LegsTable } from './tripdetail/LegsTable';
import type { LegsTableProps } from './tripdetail/legsTableProps';
import { TripAtlas } from './tripdetail/TripAtlas';

type Confirm =
  | { kind: 'active'; activating: boolean }
  | { kind: 'deleteTrip' }
  | { kind: 'removeFlight'; flightId: number }
  | { kind: 'deleteLeg'; legId: number }
  | { kind: 'unlink'; flightId: number };

const without = <T,>(rec: Record<number, T>, key: number): Record<number, T> => {
  const { [key]: _drop, ...rest } = rec;
  void _drop;
  return rest;
};

const NOT_FOUND = /not found/i;

/** One trip: overview (stats, notes, map, imports, legs) and atlas views. */
export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const tripId = Number(id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'atlas' ? 'atlas' : 'overview';

  const exportPdf = useExportPdf('tertiary');
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loadError, setLoadError] = useState('');
  const [tracksError, setTracksError] = useState(false);
  const [actionError, setActionError] = useState('');

  const [journey, setJourney] = useState<Journey | null>(null);
  const [journeyError, setJourneyError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [activeBusy, setActiveBusy] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResponse, setImportResponse] = useState<PlannedLegImportResponse | null>(null);
  const [simbriefId, setSimbriefId] = useState<string | null | undefined>(undefined);
  const [simbriefImporting, setSimbriefImporting] = useState(false);
  const [simbriefError, setSimbriefError] = useState('');
  const [simbriefResult, setSimbriefResult] = useState<SimbriefImportResult | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [reorderError, setReorderError] = useState('');
  const [reorderingLegId, setReorderingLegId] = useState<number | null>(null);

  const [skipTarget, setSkipTarget] = useState<PlannedLegWithChildren | null>(null);
  const [skipBusyLegId, setSkipBusyLegId] = useState<number | null>(null);
  const [skipErrorByLeg, setSkipErrorByLeg] = useState<Record<number, string>>({});

  const [unlinkBusyFlightId, setUnlinkBusyFlightId] = useState<number | null>(null);
  const [unlinkErrorByFlight, setUnlinkErrorByFlight] = useState<Record<number, string>>({});

  const [linkingLegId, setLinkingLegId] = useState<number | null>(null);
  const [linkFlightChoice, setLinkFlightChoice] = useState<number | ''>('');
  const [linkableFlights, setLinkableFlights] = useState<Flight[] | null>(null);
  const [linkFlightsError, setLinkFlightsError] = useState('');
  const [linkBusyLegId, setLinkBusyLegId] = useState<number | null>(null);
  const [linkErrorByLeg, setLinkErrorByLeg] = useState<Record<number, string>>({});

  const [linkingFlightId, setLinkingFlightId] = useState<number | null>(null);
  const [linkLegChoice, setLinkLegChoice] = useState<number | ''>('');
  const [linkableLegs, setLinkableLegs] = useState<PlannedLegListItem[] | null>(null);
  const [linkLegsError, setLinkLegsError] = useState('');
  const [linkBusyFlightId, setLinkBusyFlightId] = useState<number | null>(null);
  const [linkErrorByFlight, setLinkErrorByFlight] = useState<Record<number, string>>({});

  const [exportingKml, setExportingKml] = useState(false);

  const routeGeometry = useRouteGeometry(trip ? trip.planned_legs.map(l => l.id) : []);

  /**
   * The trip with each flight's track attached. The trip endpoint strips
   * points, so every flight is fetched too; a failed track fetch degrades to
   * a map without that track and a warning, never to a failed page.
   */
  const fetchTrip = useCallback(async (): Promise<Trip> => {
    const t = await api.getTrip(tripId);
    const full = await Promise.allSettled(t.flights.map(f => api.getFlight(f.id)));
    setTracksError(full.some(r => r.status === 'rejected'));
    return {
      ...t,
      flights: t.flights.map((f, i) => {
        const r = full[i];
        return r.status === 'fulfilled' ? { ...f, points: r.value.points } : f;
      }),
    };
  }, [tripId]);

  /** Reloads after a mutation. The atlas summary is stale once flights change, so it is dropped. */
  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      setTrip(await fetchTrip());
      setJourney(null);
      setJourneyError('');
    } catch (err) {
      setActionError('Could not reload the trip: ' + (err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [fetchTrip]);

  useEffect(() => {
    if (!Number.isInteger(tripId)) { setLoadError('Trip not found'); return; }
    let cancelled = false;
    setTrip(null);
    setLoadError('');
    fetchTrip()
      .then(t => {
        if (cancelled) return;
        setTrip(t);
        document.title = `${t.name} — Sabiá`;
      })
      .catch(err => { if (!cancelled) setLoadError((err as Error).message); });
    // A user-level setting that fails independently: the import panels then
    // read as "not set" instead of blocking the page.
    api.getSimbriefSettings()
      .then(s => { if (!cancelled) setSimbriefId(s.simbrief_user_id); })
      .catch(() => { if (!cancelled) setSimbriefId(null); });
    return () => { cancelled = true; };
  }, [tripId, fetchTrip]);

  useEffect(() => {
    // The tracks are only paid for once the atlas is opened.
    if (view !== 'atlas' || journey || journeyError || !Number.isInteger(tripId)) return;
    let cancelled = false;
    api.getJourney(tripId)
      .then(j => { if (!cancelled) setJourney(j); })
      .catch(err => { if (!cancelled) setJourneyError((err as Error).message); });
    return () => { cancelled = true; };
  }, [view, journey, journeyError, tripId]);

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams);
    if (value === null) params.delete(key);
    else params.set(key, value);
    setSearchParams(params, { replace: true });
  }

  function openEdit() {
    if (!trip) return;
    setEditName(trip.name);
    setEditNotes(trip.notes ?? '');
    setSaveError('');
    setEditOpen(true);
  }

  async function handleSave() {
    if (!trip) return;
    if (!editName.trim()) { setSaveError('Name is required'); return; }
    setSaving(true);
    setSaveError('');
    try {
      await api.patchTrip(trip.id, { name: editName.trim(), notes: editNotes.trim() || null });
      setEditOpen(false);
      await reload();
      document.title = `${editName.trim()} — Sabiá`;
    } catch (err) {
      setSaveError('Save failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runConfirmed() {
    const c = confirm;
    setConfirm(null);
    if (!c || !trip) return;
    setActionError('');
    switch (c.kind) {
      case 'active': {
        setActiveBusy(true);
        try {
          await api.setActiveTrip(c.activating ? trip.id : null);
          await reload();
        } catch (err) {
          setActionError('Failed: ' + (err as Error).message);
        } finally {
          setActiveBusy(false);
        }
        return;
      }
      case 'deleteTrip':
        try {
          await api.deleteTrip(trip.id);
          navigate('/');
        } catch (err) {
          setActionError('Delete failed: ' + (err as Error).message);
        }
        return;
      case 'removeFlight':
        try {
          await api.removeFlightFromTrip(trip.id, c.flightId);
          await reload();
        } catch (err) {
          setActionError('Failed to remove leg: ' + (err as Error).message);
        }
        return;
      case 'deleteLeg':
        try {
          await api.deletePlannedLeg(c.legId);
          await reload();
        } catch (err) {
          setActionError('Failed to delete planned leg: ' + (err as Error).message);
        }
        return;
      case 'unlink': {
        setUnlinkErrorByFlight(prev => without(prev, c.flightId));
        setUnlinkBusyFlightId(c.flightId);
        try {
          await api.linkFlightToLeg(c.flightId, null);
          setLinkableFlights(null);
          setLinkableLegs(null);
          await reload();
        } catch (err) {
          setUnlinkErrorByFlight(prev => ({ ...prev, [c.flightId]: (err as Error).message }));
        } finally {
          setUnlinkBusyFlightId(null);
        }
      }
    }
  }

  /** Imports attach to this trip; per-file outcomes are shown whether or not any file was accepted. */
  async function handleFiles(files: File[]) {
    setImporting(true);
    setImportError('');
    setImportResponse(null);
    try {
      setImportResponse(await api.importPlannedLegs(files, tripId));
      await reload();
    } catch (err) {
      setImportError('Import failed: ' + (err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function handleImportSimbrief() {
    setSimbriefImporting(true);
    setSimbriefError('');
    setSimbriefResult(null);
    try {
      const result = await api.importSimbriefLeg(tripId);
      setSimbriefResult(result);
      if (result.status === 'imported') await reload();
    } catch (err) {
      setSimbriefError((err as Error).message);
    } finally {
      setSimbriefImporting(false);
    }
  }

  /** Swaps a leg with its neighbour in the trip's full ordering and sends the whole permutation. */
  async function handleMoveLeg(legId: number, direction: 'up' | 'down') {
    if (!trip) return;
    const all = [...trip.planned_legs].sort((a, b) => a.seq - b.seq || a.id - b.id);
    const idx = all.findIndex(l => l.id === legId);
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapWith < 0 || swapWith >= all.length) return;
    const legIds = all.map(l => l.id);
    [legIds[idx], legIds[swapWith]] = [legIds[swapWith], legIds[idx]];
    setReorderError('');
    setReorderingLegId(legId);
    try {
      const updated = await api.reorderPlannedLegs(trip.id, legIds);
      setTrip(t => (t ? { ...t, planned_legs: updated } : t));
    } catch (err) {
      setReorderError('Reorder failed: ' + (err as Error).message);
    } finally {
      setReorderingLegId(null);
    }
  }

  async function confirmSkip() {
    if (!skipTarget) return;
    const target = skipTarget;
    setSkipErrorByLeg(prev => without(prev, target.id));
    setSkipBusyLegId(target.id);
    try {
      await api.setPlannedLegStatus(target.id, target.status === 'skipped' ? 'planned' : 'skipped');
      setSkipTarget(null);
      await reload();
    } catch (err) {
      // A 409 means a flight got linked to the leg since the page loaded; the
      // server's message stays inside the dialog.
      setSkipErrorByLeg(prev => ({ ...prev, [target.id]: (err as Error).message }));
    } finally {
      setSkipBusyLegId(null);
    }
  }

  async function loadLinkableFlights() {
    setLinkFlightsError('');
    try {
      setLinkableFlights((await api.listFlights()).filter(f => f.planned_leg_id === null));
    } catch (err) {
      setLinkFlightsError((err as Error).message);
    }
  }

  /** Not scoped to this trip: manual linking must reach any unflown leg, or one with no trip. */
  async function loadLinkableLegs() {
    setLinkLegsError('');
    try {
      setLinkableLegs((await api.listPlannedLegs()).filter(l => l.linked_flight_id === null));
    } catch (err) {
      setLinkLegsError((err as Error).message);
    }
  }

  async function linkAndReload(flightId: number, legId: number) {
    await api.linkFlightToLeg(flightId, legId);
    setLinkableFlights(null);
    setLinkableLegs(null);
    await reload();
  }

  async function handleLinkFromLeg(legId: number) {
    if (!linkFlightChoice) return;
    setLinkErrorByLeg(prev => without(prev, legId));
    setLinkBusyLegId(legId);
    try {
      await linkAndReload(Number(linkFlightChoice), legId);
      setLinkingLegId(null);
      setLinkFlightChoice('');
    } catch (err) {
      setLinkErrorByLeg(prev => ({ ...prev, [legId]: (err as Error).message }));
    } finally {
      setLinkBusyLegId(null);
    }
  }

  async function handleLinkFromFlight(flightId: number) {
    if (!linkLegChoice) return;
    setLinkErrorByFlight(prev => without(prev, flightId));
    setLinkBusyFlightId(flightId);
    try {
      await linkAndReload(flightId, Number(linkLegChoice));
      setLinkingFlightId(null);
      setLinkLegChoice('');
    } catch (err) {
      setLinkErrorByFlight(prev => ({ ...prev, [flightId]: (err as Error).message }));
    } finally {
      setLinkBusyFlightId(null);
    }
  }

  async function handleExportKml() {
    if (!trip) return;
    setExportingKml(true);
    setActionError('');
    try {
      downloadKml(`trip-${trip.id}.kml`, buildTripKml(trip.name, trip.flights));
    } catch (err) {
      setActionError('Export failed: ' + (err as Error).message);
    } finally {
      setExportingKml(false);
    }
  }

  const geometries = routeGeometry.geometries;
  // One prompt per airport across all legs, rendered once inside the map.
  const fetchTargets = useMemo(() => {
    const byIdent = new Map<string, ReturnType<typeof detailTargets>[number]>();
    for (const g of Object.values(geometries)) for (const t of detailTargets(g)) byIdent.set(t.ident, t);
    return [...byIdent.values()];
  }, [geometries]);

  const legOverlay = (leg: PlannedLegWithChildren, chain: [number, number][]): LegOverlay | null => {
    const g = geometries[leg.id];
    if (!g || !geometryHasChains(g)) return null;
    return {
      replacesPlanned: g.enroute.points.length > 0,
      layer: (
        <RouteGeometryLayer
          legId={leg.id}
          legSeq={leg.seq}
          geometry={g}
          label={`Planned route: ${leg.departure_ident} → ${leg.destination_ident}`}
          note={procedureNote(leg, g)}
          anchor={chain[0]}
        />
      ),
    };
  };

  if (loadError) {
    if (NOT_FOUND.test(loadError)) {
      return (
        <>
          <PageHeader title="Trip not found" />
          <EmptyState
            title="This trip does not exist."
            description="It may have been deleted."
            action={<Link as={RouterLink} to="/flights">Back to All Flights</Link>}
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title="Trip" />
        <InlineNotification kind="error" lowContrast hideCloseButton title="Failed to load trip"
          subtitle={loadError} style={{ maxInlineSize: 'none' }} />
      </>
    );
  }
  if (!trip) {
    return (
      <>
        <PageHeader title="Trip" />
        <SkeletonText paragraph lineCount={6} />
      </>
    );
  }

  const plannedLegs = [...trip.planned_legs].sort((a, b) => a.seq - b.seq || a.id - b.id);
  // The active-trip control only means something once the trip has planned
  // legs (a trip without any is inert to the matcher); an active trip that lost
  // them all still shows it so the flag can be cleared.
  const showActiveTripControl = plannedLegs.length > 0 || trip.is_active === 1;
  const isActive = trip.is_active === 1;
  const subtitle = `${trip.flight_count} leg${trip.flight_count !== 1 ? 's' : ''}` +
    (trip.total_distance_nm != null ? ` · ${formatDistance(trip.total_distance_nm)} nm total` : '');

  const confirmCopy: Record<Confirm['kind'], { title: string; message: string; label: string; danger: boolean }> = {
    active: {
      title: confirm?.kind === 'active' && !confirm.activating ? 'Clear active trip' : 'Set active trip',
      message: confirm?.kind === 'active' && !confirm.activating
        ? `Clear "${trip.name}" as the active trip?`
        : `Make "${trip.name}" the active trip? Any other active trip is cleared automatically.`,
      label: confirm?.kind === 'active' && !confirm.activating ? 'Clear' : 'Set active',
      danger: false,
    },
    deleteTrip: {
      title: 'Delete trip', message: `Delete trip "${trip.name}"? The flights will not be deleted.`,
      label: 'Delete', danger: true,
    },
    removeFlight: {
      title: 'Remove from trip', message: 'Remove this leg from the trip? The flight itself is kept.',
      label: 'Remove', danger: true,
    },
    deleteLeg: { title: 'Delete planned leg', message: 'Delete this planned leg?', label: 'Delete', danger: true },
    unlink: {
      title: 'Unlink flight',
      message: 'Unlink this flight from its planned leg? The leg becomes unflown again.',
      label: 'Unlink', danger: false,
    },
  };
  const copy = confirmCopy[confirm?.kind ?? 'deleteTrip'];

  const legsTableProps: LegsTableProps = {
    trip: { id: trip.id, name: trip.name, is_active: trip.is_active },
    flights: trip.flights,
    plannedLegs,
    page: Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1),
    onPageChange: n => setParam('page', n === 1 ? null : String(n)),
    onMoveLeg: handleMoveLeg,
    reorderingLegId,
    onRequestSkip: legId => {
      const leg = plannedLegs.find(l => l.id === legId);
      if (leg) { setSkipErrorByLeg(prev => without(prev, legId)); setSkipTarget(leg); }
    },
    skipBusyLegId,
    skipErrorByLeg,
    onRequestDeleteLeg: legId => setConfirm({ kind: 'deleteLeg', legId }),
    onRequestUnlink: flightId => setConfirm({ kind: 'unlink', flightId }),
    unlinkBusyFlightId,
    unlinkErrorByFlight,
    onRequestRemoveFlight: flightId => setConfirm({ kind: 'removeFlight', flightId }),
    legPicker: {
      openLegId: linkingLegId,
      flights: linkableFlights,
      flightsError: linkFlightsError,
      choice: linkFlightChoice,
      busyLegId: linkBusyLegId,
      errorByLeg: linkErrorByLeg,
      onToggle: legId => {
        const opening = linkingLegId !== legId;
        setLinkingLegId(opening ? legId : null);
        setLinkFlightChoice('');
        if (opening && linkableFlights === null) void loadLinkableFlights();
      },
      onChoiceChange: setLinkFlightChoice,
      onConfirm: legId => void handleLinkFromLeg(legId),
    },
    flightPicker: {
      openFlightId: linkingFlightId,
      legs: linkableLegs,
      legsError: linkLegsError,
      choice: linkLegChoice,
      busyFlightId: linkBusyFlightId,
      errorByFlight: linkErrorByFlight,
      onToggle: flightId => {
        const opening = linkingFlightId !== flightId;
        setLinkingFlightId(opening ? flightId : null);
        setLinkLegChoice('');
        if (opening && linkableLegs === null) void loadLinkableLegs();
      },
      onChoiceChange: setLinkLegChoice,
      onConfirm: flightId => void handleLinkFromFlight(flightId),
    },
    onRefresh: () => void reload(),
    refreshing,
  };

  return (
    <>
      <PageHeader
        title={trip.name}
        subtitle={subtitle}
        breadcrumbs={[{ label: 'All Flights', href: '/flights' }, { label: trip.name }]}
        actions={
          <>
            {isActive && <StatusTag kind="active-trip">Active Trip</StatusTag>}
            {showActiveTripControl && (
              <Button kind="tertiary" size="md" disabled={activeBusy}
                onClick={() => setConfirm({ kind: 'active', activating: !isActive })}>
                {activeBusy ? 'Working…' : (isActive ? 'Clear Active Trip' : 'Set as Active Trip')}
              </Button>
            )}
          </>
        }
      />

      {actionError && (
        <InlineNotification kind="error" lowContrast title="Action failed" subtitle={actionError}
          onCloseButtonClick={() => setActionError('')} style={{ maxInlineSize: 'none' }} />
      )}

      <div style={{ maxInlineSize: '20rem', marginBlockEnd: '1.5rem' }}>
        <ContentSwitcher
          size="md"
          selectedIndex={view === 'atlas' ? 1 : 0}
          onChange={({ name }: { name?: string | number }) => setParam('view', name === 'atlas' ? 'atlas' : null)}
        >
          <Switch name="overview" text="Overview" />
          <Switch name="atlas" text="Atlas" />
        </ContentSwitcher>
      </div>

      {view === 'atlas' ? (
        journeyError ? (
          <InlineNotification kind="error" lowContrast hideCloseButton title="Failed to load atlas"
            subtitle={journeyError} style={{ maxInlineSize: 'none' }} />
        ) : journey ? (
          <TripAtlas journey={journey} mapChildren={<NavdataOverlay />} />
        ) : (
          <SkeletonText paragraph lineCount={6} />
        )
      ) : (
        <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <StatTiles tiles={[
            { label: 'Total Duration', value: formatDuration(trip.total_duration_sec) },
            { label: 'Total Distance (nm)', value: formatDistance(trip.total_distance_nm) },
            { label: 'Peak Altitude (ft)', value: formatAlt(trip.max_altitude_ft) },
            { label: 'Legs', value: trip.flight_count },
          ]} />

          {trip.notes && (
            <Tile>
              <h2 className="sabia-heading-03" style={{ marginBlockEnd: '0.5rem' }}>Notes</h2>
              <p style={{ whiteSpace: 'pre-wrap' }}>{trip.notes}</p>
            </Tile>
          )}

          <Tile>
            <h2 className="sabia-heading-03" style={{ marginBlockEnd: '0.5rem' }}>Combined Route</h2>
            {tracksError && (
              <InlineNotification kind="warning" lowContrast hideCloseButton title="Tracks unavailable"
                subtitle="Some flight tracks could not be loaded, so the map may be incomplete."
                style={{ maxInlineSize: 'none' }} />
            )}
            <TripMap flights={trip.flights} plannedLegs={trip.planned_legs} legOverlay={legOverlay}>
              <NavdataOverlay />
              <FetchDetailPrompt targets={fetchTargets} />
            </TripMap>
          </Tile>

          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))' }}>
            <Tile>
              <LnmplnImportPanel
                onFiles={handleFiles}
                importing={importing}
                error={importError}
                results={importResponse?.results ?? null}
                batch={importResponse?.batch}
              />
            </Tile>
            <Tile>
              <SimbriefImportPanel
                userId={simbriefId}
                importing={simbriefImporting}
                onImport={handleImportSimbrief}
                error={simbriefError}
                result={simbriefResult}
              />
            </Tile>
          </div>

          <section aria-label="Legs">
            <h2 className="sabia-heading-03" style={{ marginBlockEnd: '0.5rem' }}>Legs</h2>
            {reorderError && (
              <InlineNotification kind="error" lowContrast title="Reorder failed" subtitle={reorderError}
                onCloseButtonClick={() => setReorderError('')} style={{ maxInlineSize: 'none' }} />
            )}
            <LegsTable {...legsTableProps} />
          </section>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBlockStart: '2rem', alignItems: 'center' }}>
        <Button kind="ghost" as={RouterLink} to="/">Back</Button>
        <Button kind="tertiary" onClick={openEdit}>Edit</Button>
        {exportPdf.button}
        <Button kind="tertiary" disabled={exportingKml} onClick={handleExportKml}>
          {exportingKml ? 'Exporting KML…' : 'Export KML'}
        </Button>
        <Button kind="danger--tertiary" onClick={() => setConfirm({ kind: 'deleteTrip' })}>Delete Trip</Button>
      </div>
      {exportPdf.note}

      <EditTripModal
        open={editOpen}
        name={editName}
        notes={editNotes}
        onNameChange={setEditName}
        onNotesChange={setEditNotes}
        saving={saving}
        error={saveError}
        onSave={() => void handleSave()}
        onCancel={() => { setEditOpen(false); setSaveError(''); }}
      />
      <ConfirmModal
        open={confirm !== null}
        title={copy.title}
        message={copy.message}
        confirmLabel={copy.label}
        danger={copy.danger}
        onConfirm={() => void runConfirmed()}
        onCancel={() => setConfirm(null)}
      />
      <SkipLegConfirm
        leg={skipTarget}
        busy={skipBusyLegId !== null}
        error={skipTarget ? skipErrorByLeg[skipTarget.id] : undefined}
        onConfirm={() => void confirmSkip()}
        onCancel={() => setSkipTarget(null)}
      />
    </>
  );
}
