/** Stored trip columns only; counts, totals and children are derived on read. */
export interface TripBase {
  id: number;
  name: string;
  notes: string | null;
  is_active: number;
}

export const SEED_TRIPS: TripBase[] = [
  { id: 1, name: 'Baltic Hop', notes: 'Helsinki - Tallinn - Stockholm, A320neo.', is_active: 0 },
  { id: 2, name: 'Brasil Tour', notes: 'Domestic network, north to south. 27 planned legs.', is_active: 1 },
  { id: 3, name: 'Empty Trip', notes: null, is_active: 0 },
];
