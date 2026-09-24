import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SessionProvider } from '../shell/SessionContext';
import { AppShell } from '../shell/AppShell';

interface Options {
  /** The URL the MemoryRouter starts at. Defaults to `path` with its params left literal. */
  route?: string;
  /**
   * A react-router path pattern (e.g. '/flight/:id') to mount `ui` under, so
   * `useParams` resolves the same way it does inside the real app. Defaults
   * to '/', for a page that reads no route param.
   */
  path?: string;
  /**
   * Wrap `ui` in AppShell with fixed props (idle status, no user, empty nav
   * tree). Only for a test that needs the shell's own chrome — the header
   * status tag, the breadcrumb, the nav tree. Default false: a page rendered
   * inside the shell plus its own `<main>` makes `getByRole('main')`
   * ambiguous, so a plain page test must not get it.
   */
  shell?: boolean;
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
  const element = options.shell
    ? (
      <AppShell
        live={{ type: 'gray', label: 'Idle' }}
        username={null}
        onLogout={() => {}}
        trips={[]}
        looseFlights={[]}
      >
        {ui}
      </AppShell>
    )
    : ui;
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>
  );
}
