import type { PlannedLeg } from '../../types';
import { formatDistance } from '../../utils/format';

/**
 * The landing outcome implied by `arrival_deviation_nm`, in words. Null when
 * there is nothing to show (every leg not yet flown, and legacy legs).
 */
export function plannedLegLandingNote(
  leg: Pick<PlannedLeg, 'status' | 'arrival_deviation_nm' | 'destination_ident'>,
  arrivalIdent?: string | null,
): string | null {
  if (leg.arrival_deviation_nm == null) return null;
  const dev = `${formatDistance(leg.arrival_deviation_nm)} nm`;
  if (leg.status === 'flown') return `flown, ${dev} from plan`;
  if (leg.status === 'diverted') {
    return `diverted, ${dev} from planned ${leg.destination_ident} · arrived ${arrivalIdent || '—'}`;
  }
  return null;
}
