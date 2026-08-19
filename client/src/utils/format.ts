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

/**
 * Like formatDate, but with an explicit locale/timezone.
 *
 * The PDF export renders in a headless browser on the server, whose timezone
 * is not the user's — without this, a Brazilian flight would be stamped in UTC.
 * The export routes forward the browser's values as query params.
 */
export function formatDateIn(
  iso: string | null | undefined,
  locale?: string,
  timeZone?: string
): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(locale || undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return formatDate(iso);
  }
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
