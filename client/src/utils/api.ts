export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Everything the download plumbing needs. Private to this module. */
type DownloadInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

/**
 * fetch → Blob → synthetic <a download>. The only place in the client that
 * calls URL.createObjectURL. Reads the filename from Content-Disposition,
 * falls back to `fallbackName`. Throws Error(body.error ?? statusText) on a
 * non-2xx so the caller can render a message instead of navigating to JSON.
 */
async function download(url: string, fallbackName: string, init: DownloadInit = {}): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || res.statusText);
  }

  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = match?.[1] ?? fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Downloads a generated PDF.
 *
 * Uses fetch + Blob rather than a plain <a download> so the caller can show a
 * progress state (generation takes seconds) and so an error response renders as
 * a message instead of navigating the user to raw JSON.
 *
 * The browser's locale and timezone are forwarded because the PDF is rendered
 * headlessly on the server, whose timezone is not the user's.
 */
export async function downloadPdf(
  path: string,
  fallbackName: string,
  opts: { includePlans?: boolean } = {}
): Promise<void> {
  const params = new URLSearchParams();
  try {
    params.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone);
    params.set('locale', navigator.language);
  } catch { /* fall back to server defaults */ }
  if (opts.includePlans === false) params.set('plans', '0');

  await download(`${path}?${params}`, fallbackName);
}

/** GET a .kml endpoint (§2.1, §2.2). No query parameters are sent. */
export async function downloadKml(path: string, fallbackName: string): Promise<void> {
  await download(path, fallbackName);
}

/** POST /api/flights/export.kml with {ids} (§2.3). */
export async function downloadFlightSetKml(ids: number[]): Promise<void> {
  await download('/api/flights/export.kml', `flights-${ids.length}.kml`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}
