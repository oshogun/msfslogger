import fs from 'fs';
import path from 'path';

const FLIGHT_PLANS_DIR = path.join(process.cwd(), 'flight_plans');
const PDF_MAGIC = '%PDF-';

export function ensureFlightPlansDir(): void {
  fs.mkdirSync(FLIGHT_PLANS_DIR, { recursive: true });
}

export function flightPlanPath(flightId: number): string {
  return path.join(FLIGHT_PLANS_DIR, `${flightId}.pdf`);
}

export function isPdfBuffer(buf: Buffer): boolean {
  return buf.subarray(0, PDF_MAGIC.length).toString('ascii') === PDF_MAGIC;
}

export function saveFlightPlanFile(flightId: number, buffer: Buffer): void {
  fs.writeFileSync(flightPlanPath(flightId), buffer);
}

export function deleteFlightPlanFile(flightId: number): void {
  const p = flightPlanPath(flightId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function copyFlightPlanFile(fromFlightId: number, toFlightId: number): void {
  const src = flightPlanPath(fromFlightId);
  if (fs.existsSync(src)) fs.copyFileSync(src, flightPlanPath(toFlightId));
}
