import path from 'path';
export function resolveDbPath(): string {
  return process.env.FLIGHTS_DB_PATH || path.join(process.cwd(), 'flights.db');
}
export const RESOLVED_AT_IMPORT = resolveDbPath();
