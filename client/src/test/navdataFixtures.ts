import type { FeaturesResponse, NavdataStatusResponse } from '../types';

// Synthetic idents and coordinates only.

export const presentStatus: NavdataStatusResponse = {
  present: true, schemaVersion: 1, snapshotId: 'snap-zz', rev: 1, simId: '2024',
  simAppName: null, simAppVersion: null, snapshotAppliedAt: 1, lastRowsAt: null,
  counts: null, sidecar: null,
};

export const absentStatus: NavdataStatusResponse = { ...presentStatus, present: false, snapshotId: null, rev: null };

const cov = (harvestedCells: number, fraction: number) =>
  ({ harvestedCells, fraction, oldestHarvestAt: null, newestHarvestAt: null });

export function emptyFeatures(over: Partial<FeaturesResponse> = {}): FeaturesResponse {
  return {
    bbox: [0, 0, 1, 1], zoom: 9, gated: [], truncated: false, limit: 2000,
    airports: [], navaids: [], waypoints: [], airways: [], runways: [],
    coverage: {
      totalCells: 4,
      byKind: { V: cov(4, 1), N: cov(4, 1), W: cov(4, 1) },
      airportsComplete: true,
    },
    ...over,
  };
}

export { cov };
