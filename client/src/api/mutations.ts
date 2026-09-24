/**
 * The write-side notification channel every accessor in client/src/api/**
 * calls into after a successful write, so anything showing derived state
 * (the SideNav trip tree, in particular) can refetch without polling.
 *
 * Deliberately no React here: a plain accessor function needs to call
 * notifyMutation() without importing a hook. Subscribers debounce for
 * themselves — this module just fans a signal out.
 */

const subscribers = new Set<() => void>();

/** Called by every write accessor once the server has answered 2xx. */
export function notifyMutation(): void {
  subscribers.forEach(cb => cb());
}

/** Returns an unsubscribe function. */
export function subscribeMutations(onMutation: () => void): () => void {
  subscribers.add(onMutation);
  return () => { subscribers.delete(onMutation); };
}
