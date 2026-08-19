export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
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

  const res = await fetch(`${path}?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || res.statusText);
  }

  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = match?.[1] ?? fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
