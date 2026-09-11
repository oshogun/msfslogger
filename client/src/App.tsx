import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { RequireAuth } from './components/RequireAuth';
import { Home } from './pages/Home';
import { AllFlights } from './pages/AllFlights';
import { FlightDetail } from './pages/FlightDetail';
import { TripDetail } from './pages/TripDetail';
import { Device } from './pages/Device';
import { Override } from './pages/Override';
import { Login } from './pages/Login';
import { PrintFlight } from './pages/PrintFlight';
import { PrintTrip } from './pages/PrintTrip';
import { useStatus } from './hooks/useStatus';
import { SessionProvider } from './hooks/useSession';

function AppShell() {
  const { status, serverError } = useStatus();

  return (
    <>
      <Header status={status} serverError={serverError} />
      <div className="app-body">
        <Sidebar />
        <div className="app-main">
          <Routes>
            <Route path="/" element={<Home status={status} />} />
            <Route path="/flights" element={<AllFlights />} />
            <Route path="/flight/:id" element={<FlightDetail />} />
            <Route path="/trip/:id" element={<TripDetail />} />
            <Route path="/device" element={<Device />} />
            <Route path="/override" element={<Override />} />
          </Routes>
        </div>
      </div>
    </>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Routes>
        {/*
          /login and the print routes are kept outside AppShell and outside
          RequireAuth on purpose: Login must not mount Header, whose useStatus
          hook polls /api/status forever — that would 401-loop on a page
          shown specifically to an anonymous visitor. The print routes stay
          public HTML so a mid-render 401 during a PDF export surfaces as
          window.__EXPORT_ERROR__, never a redirect that would render the
          login page into the PDF.
        */}
        <Route path="/login" element={<Login />} />
        <Route path="/print/flight/:id" element={<PrintFlight />} />
        <Route path="/print/trip/:id" element={<PrintTrip />} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        />
      </Routes>
    </SessionProvider>
  );
}
