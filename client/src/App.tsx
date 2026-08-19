import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { Home } from './pages/Home';
import { FlightDetail } from './pages/FlightDetail';
import { TripDetail } from './pages/TripDetail';
import { PrintFlight } from './pages/PrintFlight';
import { PrintTrip } from './pages/PrintTrip';
import { useStatus } from './hooks/useStatus';

function AppShell() {
  const { status, serverError } = useStatus();

  return (
    <>
      <Header status={status} serverError={serverError} />
      <Routes>
        <Route path="/" element={<Home status={status} />} />
        <Route path="/flight/:id" element={<FlightDetail />} />
        <Route path="/trip/:id" element={<TripDetail />} />
      </Routes>
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
      <Route path="/print/flight/:id" element={<PrintFlight />} />
      <Route path="/print/trip/:id" element={<PrintTrip />} />
      <Route path="*" element={<AppShell />} />
    </Routes>
  );
}
