import { Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { RequireAuth } from './shell/RequireAuth';
import { SessionProvider, useSession } from './shell/SessionContext';
import { useLiveStatus } from './shell/useLiveStatus';
import { useNavTree } from './shell/useNavTree';
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
