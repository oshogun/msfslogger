import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SessionProvider } from '../hooks/useSession';

interface Options {
  /** The URL the MemoryRouter starts at. Defaults to `path` with its params left literal. */
  route?: string;
  /**
   * A react-router path pattern (e.g. '/flight/:id') to mount `ui` under, so
   * `useParams` resolves the same way it does inside the real app. Defaults
   * to '/', for a page that reads no route param.
   */
  path?: string;
}

/**
 * Renders a page the same way the app does: inside a MemoryRouter (so
 * `useParams`/`useNavigate` work) and a SessionProvider (every page's
 * `apiFetch` calls and `<Header>`'s logout control expect one in context).
 * Mounting `ui` under a real `<Route>` — rather than rendering it bare — is
 * what makes `useParams()` resolve inside a page under test exactly as it
 * does under `App.tsx`'s real `<Routes>`.
 */
export function renderWithProviders(ui: ReactElement, options: Options = {}): RenderResult {
  const path = options.path ?? '/';
  const route = options.route ?? path;
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>
  );
}
