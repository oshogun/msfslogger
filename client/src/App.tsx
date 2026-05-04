import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { Home } from './pages/Home';
import { FlightDetail } from './pages/FlightDetail';
import { TripDetail } from './pages/TripDetail';
import { useStatus } from './hooks/useStatus';

export function App() {
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
