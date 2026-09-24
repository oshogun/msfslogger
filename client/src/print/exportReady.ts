import { useCallback, useEffect, useRef } from 'react';

declare global {
  interface Window {
    __EXPORT_READY__?: boolean;
    /** Set on a data-load failure so the export fails fast instead of timing out. */
    __EXPORT_ERROR__?: string;
  }
}

/**
 * Coordinates the "this page is fully painted" signal that the server-side PDF
 * export waits on (see src/pdfExport.ts).
 *
 * Puppeteer cannot use networkidle here: the maps stream tiles lazily, so the
 * page never looks idle. Instead the print pages report when every map has
 * finished loading, and only then is window.__EXPORT_READY__ set.
 *
 * `dataLoaded` is required and must be false until the API response has
 * arrived. Without it the page would signal ready while still rendering
 * "Loading...", because before the fetch resolves there are zero maps to wait
 * for — and the PDF would capture an empty page.
 */
export function useExportReady(dataLoaded: boolean, expectedMaps: number): () => void {
  const readyCount = useRef(0);
  const signalled = useRef(false);

  const markReady = useCallback(() => {
    if (signalled.current) return;
    signalled.current = true;
    // Two frames so Leaflet can paint the final tile positions before capture
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.__EXPORT_READY__ = true;
      });
    });
  }, []);

  useEffect(() => {
    window.__EXPORT_READY__ = false;
  }, []);

  useEffect(() => {
    // A loaded page with no maps at all (e.g. a flight with no GPS points) is
    // ready as soon as it has rendered — otherwise it would hang until timeout.
    if (dataLoaded && expectedMaps === 0) markReady();
  }, [dataLoaded, expectedMaps, markReady]);

  return useCallback(() => {
    readyCount.current += 1;
    if (readyCount.current >= expectedMaps) markReady();
  }, [expectedMaps, markReady]);
}
