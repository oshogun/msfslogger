export interface MockAirport {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevationFt: number;
  country: string;
  flag: string;
}

const BR = { country: 'Brazil', flag: '🇧🇷' };

export const AIRPORTS: Record<string, MockAirport> = {
  SBGR: { icao: 'SBGR', name: 'São Paulo/Guarulhos', lat: -23.4356, lon: -46.4731, elevationFt: 2461, ...BR },
  SBSP: { icao: 'SBSP', name: 'São Paulo/Congonhas', lat: -23.6261, lon: -46.6564, elevationFt: 2631, ...BR },
  SBKP: { icao: 'SBKP', name: 'Campinas/Viracopos', lat: -23.0074, lon: -47.1345, elevationFt: 2170, ...BR },
  SBBR: { icao: 'SBBR', name: 'Brasília', lat: -15.8711, lon: -47.9186, elevationFt: 3497, ...BR },
  SBSV: { icao: 'SBSV', name: 'Salvador', lat: -12.9086, lon: -38.3225, elevationFt: 64, ...BR },
  SBRF: { icao: 'SBRF', name: 'Recife/Guararapes', lat: -8.1265, lon: -34.9232, elevationFt: 33, ...BR },
  SBFZ: { icao: 'SBFZ', name: 'Fortaleza', lat: -3.7763, lon: -38.5326, elevationFt: 82, ...BR },
  SBJP: { icao: 'SBJP', name: 'João Pessoa', lat: -7.1458, lon: -34.9486, elevationFt: 217, ...BR },
  SBCF: { icao: 'SBCF', name: 'Belo Horizonte/Confins', lat: -19.6244, lon: -43.9719, elevationFt: 2721, ...BR },
  SBGL: { icao: 'SBGL', name: 'Rio de Janeiro/Galeão', lat: -22.81, lon: -43.2506, elevationFt: 28, ...BR },
  SBRJ: { icao: 'SBRJ', name: 'Rio de Janeiro/Santos Dumont', lat: -22.9105, lon: -43.1631, elevationFt: 11, ...BR },
  SBCT: { icao: 'SBCT', name: 'Curitiba/Afonso Pena', lat: -25.5285, lon: -49.1758, elevationFt: 2988, ...BR },
  SBPA: { icao: 'SBPA', name: 'Porto Alegre/Salgado Filho', lat: -29.9944, lon: -51.1714, elevationFt: 11, ...BR },
  EFHK: { icao: 'EFHK', name: 'Helsinki-Vantaa', lat: 60.3172, lon: 24.9633, elevationFt: 179, country: 'Finland', flag: '🇫🇮' },
  EETN: { icao: 'EETN', name: 'Tallinn Lennart Meri', lat: 59.4133, lon: 24.8328, elevationFt: 131, country: 'Estonia', flag: '🇪🇪' },
  ESSA: { icao: 'ESSA', name: 'Stockholm Arlanda', lat: 59.6519, lon: 17.9186, elevationFt: 137, country: 'Sweden', flag: '🇸🇪' },
};

const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point a fraction f (0..1) along the great circle from a to b. */
export function interpolate(aLat: number, aLon: number, bLat: number, bLon: number, f: number): [number, number] {
  const d = haversineNm(aLat, aLon, bLat, bLon) / R_NM;
  if (d < 1e-9) return [aLat, aLon];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(rad(aLat)) * Math.cos(rad(aLon)) + B * Math.cos(rad(bLat)) * Math.cos(rad(bLon));
  const y = A * Math.cos(rad(aLat)) * Math.sin(rad(aLon)) + B * Math.cos(rad(bLat)) * Math.sin(rad(bLon));
  const z = A * Math.sin(rad(aLat)) + B * Math.sin(rad(bLat));
  return [deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))];
}

export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLon = rad(bLon - aLon);
  const y = Math.sin(dLon) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
