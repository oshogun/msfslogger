import { vi } from 'vitest';

type Json = unknown;

/** `[status, body]` — body is JSON-stringified; omit it for a bodyless response (e.g. a 204). */
export type ResponseTuple = [status: number, body?: Json];

/**
 * A route's answer: a fixed tuple, a real Response (rare — only needed when a
 * header matters), or a function producing either. The function form is what
 * a test uses to control *when* a request resolves — return a promise the
 * test itself resolves later, to observe a loading state before the "data"
 * arrives.
 */
type RouteHandler =
  | ResponseTuple
  | Response
  | ((init: RequestInit | undefined) => ResponseTuple | Response | Promise<ResponseTuple | Response>);

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Per-URL, optionally split by method: `{ GET: [...], POST: [...] }`. A bare handler answers every method. */
type RouteEntry = RouteHandler | Partial<Record<HttpMethod, RouteHandler>>;

export type RouteMap = Record<string, RouteEntry>;

function isMethodMap(entry: RouteEntry): entry is Partial<Record<HttpMethod, RouteHandler>> {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    !(entry instanceof Response) &&
    !Array.isArray(entry)
  );
}

function toResponse(result: ResponseTuple | Response): Response {
  if (result instanceof Response) return result;
  const [status, body] = result;
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  });
}

/**
 * Stubs `globalThis.fetch` for the current test with routes declared as
 * `{ '/api/x': [200, {...}] }`, matched on the URL exactly as the app passes
 * it to `fetch` (apiFetch/download in ../utils/api never build a URL with a
 * different origin or query string than what a spec writes here). A URL/method
 * combination with no matching route throws — a component reaching for an
 * endpoint the test never declared fails loudly in that test, not with a
 * silent hang or a real network call.
 *
 * `client/src/test/setup.ts` already stubs `fetch` to reject before every
 * test; this replaces that stub for the rest of the current test only
 * (`restoreMocks`/`unstubAllGlobals` in that same file put the reject-stub
 * back afterwards).
 */
export function mockFetchRoutes(routes: RouteMap): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase() as HttpMethod;
      const entry = routes[url];
      if (entry === undefined) {
        throw new Error(`unexpected fetch ${method} ${url}`);
      }
      const handler = isMethodMap(entry) ? entry[method] : entry;
      if (handler === undefined) {
        throw new Error(`unexpected fetch ${method} ${url}`);
      }
      const result = typeof handler === 'function' ? await handler(init) : handler;
      return toResponse(result);
    })
  );
}

/**
 * A promise a test can resolve on its own schedule, paired with a route
 * handler for `mockFetchRoutes` that returns it. Used to hold a request open
 * long enough to assert a loading state, then let it settle:
 *
 *   const flight = deferred<ResponseTuple>();
 *   mockFetchRoutes({ '/api/flights/1': flight.handler });
 *   render(...);
 *   expect(screen.getByText('Loading...')).toBeInTheDocument();
 *   flight.resolve([200, fixtureFlight]);
 */
export function deferred<T extends ResponseTuple | Response>(): {
  handler: () => Promise<T>;
  resolve: (value: T) => void;
} {
  let resolveFn!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });
  return { handler: () => promise, resolve: resolveFn };
}
