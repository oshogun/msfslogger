import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PrintFlight } from './PrintFlight';
import { PrintTrip } from './PrintTrip';
// Bundled rather than loaded from a CDN: the PDF export renders this page
// headlessly, and a CDN outage would silently produce unstyled, broken maps.
import 'leaflet/dist/leaflet.css';
import './print.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/print/flight/:id" element={<PrintFlight />} />
      <Route path="/print/trip/:id" element={<PrintTrip />} />
    </Routes>
  </BrowserRouter>,
);
