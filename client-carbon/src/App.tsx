import { useEffect, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell, type AppShellProps } from './shell/AppShell';
import { RequireAuth } from './shell/RequireAuth';
import { SessionProvider, useSession } from './shell/SessionContext';
import { useLiveStatus } from './shell/useLiveStatus';
import { Home } from './pages/Home';
import { AllFlights } from './pages/AllFlights';
import { Prefiles } from './pages/Prefiles';
import { FlightDetail } from './pages/FlightDetail';
import { AcarsMessages } from './pages/AcarsMessages';
import { TripDetail } from './pages/TripDetail';
import { Device } from './pages/Device';
import { Override } from './pages/Override';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { DevGallery } from './pages/DevGallery';
import { listFlights, listTrips } from './mock/api';

type NavTrips = AppShellProps['trips'];
type NavLoose = AppShellProps['looseFlights'];

const route = (dep: string | null, arr: string | null) => `${dep ?? '?'} → ${arr ?? '…'}`;

/** SideNav tree from the mock trips and flights; an empty tree if the fetch fails. */
function useNavTree(): { trips: NavTrips; loose: NavLoose } {
  const [tree, setTree] = useState<{ trips: NavTrips; loose: NavLoose }>({ trips: [], loose: [] });
  useEffect(() => {
    let cancelled = false;
    Promise.all([listTrips(), listFlights()])
      .then(([trips, flights]) => {
        if (cancelled) return;
        setTree({
          trips: trips.map(t => ({
            id: t.id,
            name: t.name,
            isActive: t.is_active === 1,
            legs: t.flights.map((f, i) => ({ id: f.id, label: `Leg ${i + 1} · ${route(f.departure_icao, f.arrival_icao)}` })),
          })),
          loose: flights
            .filter(f => f.trip_id == null)
            .map(f => ({ id: f.id, label: route(f.departure_icao, f.arrival_icao) })),
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return tree;
}

function ShellRoutes() {
  const session = useSession();
  const navigate = useNavigate();
  const live = useLiveStatus();
  const nav = useNavTree();

  async function handleLogout() {
    await session.logout();
    navigate('/login');
  }

  return (
    <AppShell
      live={live}
      username={session.user?.username ?? null}
      onLogout={handleLogout}
      trips={nav.trips}
      looseFlights={nav.loose}
    >
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/flights" element={<AllFlights />} />
        <Route path="/prefiles" element={<Prefiles />} />
        <Route path="/flight/:id" element={<FlightDetail />} />
        <Route path="/flight/:id/acars" element={<AcarsMessages />} />
        <Route path="/planned-leg/:legId/acars" element={<AcarsMessages />} />
        <Route path="/trip/:id" element={<TripDetail />} />
        <Route path="/device" element={<Device />} />
        <Route path="/override" element={<Override />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/dev/gallery" element={<DevGallery />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <ShellRoutes />
            </RequireAuth>
          }
        />
      </Routes>
    </SessionProvider>
  );
}
