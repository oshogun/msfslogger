export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDistance(nm: number | null | undefined): string {
  if (nm == null) return '—';
  return nm.toFixed(1);
}

export function formatAlt(ft: number | null | undefined): string {
  if (ft == null) return '—';
  return Math.round(ft).toLocaleString();
}

export function formatSpeed(kts: number | null | undefined): string {
  if (kts == null) return '—';
  return Math.round(kts).toString();
}

export function coordStr(lat: number | null | undefined, lon: number | null | undefined): string {
  if (lat == null || lon == null) return '—';
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}
