import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Home } from './pages/Home';
import { AllFlights } from './pages/AllFlights';
import { FlightDetail } from './pages/FlightDetail';
import { TripDetail } from './pages/TripDetail';
import { Device } from './pages/Device';
import { Override } from './pages/Override';
import { PrintFlight } from './pages/PrintFlight';
import { PrintTrip } from './pages/PrintTrip';
import { useStatus } from './hooks/useStatus';

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
          </Routes>
        </div>
      </div>
    </>
  );
}

export function App() {
  return (
    <Routes>
      {/*
        Print routes are kept outside AppShell on purpose: they must not mount
        Header, whose useStatus hook polls /api/status forever. That polling
        would keep the page permanently busy and prevent the PDF export from
        ever seeing it settle.
      */}
      <Route path="/device" element={<Device />} />
      <Route path="/override" element={<Override />} />
      <Route path="/print/flight/:id" element={<PrintFlight />} />
      <Route path="/print/trip/:id" element={<PrintTrip />} />
      <Route path="*" element={<AppShell />} />
    </Routes>
  );
}
