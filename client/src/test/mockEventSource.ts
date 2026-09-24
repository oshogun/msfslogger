/**
 * jsdom has no EventSource. Tests install this with
 * `vi.stubGlobal('EventSource', MockEventSource)` and drive it directly —
 * `open()`, `emit(topic, payload)`, `fail({ permanent })` — instead of a real
 * network stream. `instances`/`latest()` let a test reach the one the
 * component under test just constructed without threading a ref through it.
 */
export class MockEventSource {
  static instances: MockEventSource[] = [];

  static reset(): void {
    MockEventSource.instances = [];
  }

  static latest(): MockEventSource {
    const es = MockEventSource.instances[MockEventSource.instances.length - 1];
    if (!es) throw new Error('MockEventSource.latest(): no instance has been constructed yet');
    return es;
  }

  readonly url: string;
  /** 0 CONNECTING | 1 OPEN | 2 CLOSED, same numbering as the real EventSource. */
  readyState: 0 | 1 | 2 = 0;
  private readonly listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(url: string | URL) {
    this.url = url.toString();
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (e: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  private dispatch(type: string, event: MessageEvent): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  close(): void {
    this.readyState = 2;
  }

  /** Test driver: the stream connects. */
  open(): void {
    this.readyState = 1;
    this.dispatch('open', new MessageEvent('open'));
  }

  /** Test driver: the server pushes one named-event message. */
  emit(topic: string, payload: unknown): void {
    this.dispatch(topic, new MessageEvent(topic, { data: JSON.stringify(payload) }));
  }

  /** Test driver: a network blip (readyState stays/returns to CONNECTING) or
   *  a refused open (permanent: readyState goes to CLOSED). */
  fail(opts?: { permanent?: boolean }): void {
    this.readyState = opts?.permanent ? 2 : 0;
    this.dispatch('error', new MessageEvent('error'));
  }
}
