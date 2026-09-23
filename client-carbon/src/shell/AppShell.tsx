import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  Content,
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderName,
  SideNav,
  SideNavDivider,
  SideNavItems,
  SideNavLink,
  SideNavMenu,
  SideNavMenuItem,
  SkipToContent,
  Tag,
} from '@carbon/react';
import { Logout, UserAvatar } from '@carbon/icons-react';

/** Carbon's `lg` breakpoint (66rem at 16px); at and above it the nav is docked. */
const DOCKED_NAV_QUERY = '(min-width: 66rem)';

function useDockedNav(): boolean {
  const [docked, setDocked] = useState(() => window.matchMedia(DOCKED_NAV_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DOCKED_NAV_QUERY);
    const onChange = () => setDocked(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return docked;
}

/** The live-status indicator is a Carbon Tag. */
export type LiveTagType = 'green' | 'blue' | 'magenta' | 'gray' | 'red';
export interface LiveStatusView {
  /** Tag colour. */
  type: LiveTagType;
  /** Tag text, e.g. "Recording · A320neo". */
  label: string;
}

export interface AppShellProps {
  children: ReactNode;
  live: LiveStatusView;
  username: string | null;
  onLogout: () => void;
  /** Trips for the SideNav tree; mock-fed in the prototype. */
  trips: { id: number; name: string; isActive: boolean; legs: { id: number; label: string }[] }[];
  /** Flights in no trip. */
  looseFlights: { id: number; label: string }[];
}

export function AppShell({
  children, live, username, onLogout, trips, looseFlights,
}: AppShellProps) {
  const docked = useDockedNav();
  // Held here rather than in Carbon's HeaderContainer render prop: an inline
  // render function there is a new component type on every render, which would
  // remount the whole shell and the routed page on each status poll.
  const [isSideNavExpanded, setSideNavExpanded] = useState(false);
  const onClickSideNavExpand = () => setSideNavExpanded(v => !v);
  const { pathname } = useLocation();
  const tripMatch = /^\/trip\/(\d+)/.exec(pathname);
  const flightMatch = /^\/flight\/(\d+)/.exec(pathname);
  const currentTripId = tripMatch
    ? Number(tripMatch[1])
    : flightMatch
      ? trips.find(t => t.legs.some(l => l.id === Number(flightMatch[1])))?.id ?? null
      : null;

  return (
    <>
      <Header aria-label="Sabiá Flight Database">
        <SkipToContent />
        <HeaderMenuButton
          aria-label={isSideNavExpanded ? 'Close navigation' : 'Open navigation'}
          onClick={onClickSideNavExpand}
          isActive={isSideNavExpanded}
          aria-expanded={isSideNavExpanded}
        />
        <HeaderName as={Link} to="/" prefix="" style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
          <img src="/sabianotext.svg" alt="" style={{ height: '1.75rem', marginInlineEnd: '0.75rem' }} />
          <span className="shell-name-text">Sabiá Flight Database</span>
        </HeaderName>
        <HeaderGlobalBar>
          <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', height: '100%', marginInlineEnd: '0.5rem' }}>
            <Tag type={live.type} size="sm" style={{ margin: 0 }}>{live.label}</Tag>
          </div>
          {username && (
            <>
              <span
                className="shell-username"
                style={{ alignSelf: 'center', fontSize: '0.875rem', marginInlineEnd: '0.5rem' }}
              >
                {username}
              </span>
              <HeaderGlobalAction aria-label={username} tooltipAlignment="end">
                <UserAvatar size={20} />
              </HeaderGlobalAction>
              <HeaderGlobalAction aria-label="Log out" tooltipAlignment="end" onClick={onLogout}>
                <Logout size={20} />
              </HeaderGlobalAction>
            </>
          )}
        </HeaderGlobalBar>
      </Header>

      <SideNav
        aria-label="Side navigation"
        expanded={docked || isSideNavExpanded}
        onSideNavBlur={isSideNavExpanded ? onClickSideNavExpand : undefined}
        isPersistent
        isChildOfHeader
      >
        <SideNavItems>
          <SideNavLink as={NavLink} to="/" end>Home</SideNavLink>
          <SideNavLink as={NavLink} to="/flights">All flights</SideNavLink>
          <SideNavLink as={NavLink} to="/prefiles">Prefiles</SideNavLink>
          <SideNavLink as={NavLink} to="/settings">Settings</SideNavLink>
          <SideNavDivider />
          {trips.map(trip => (
            <SideNavMenu key={trip.id} title={trip.name} defaultExpanded={trip.id === currentTripId}>
              <SideNavMenuItem as={NavLink} to={`/trip/${trip.id}`}>
                Trip overview{trip.isActive ? ' · Active' : ''}
              </SideNavMenuItem>
              {trip.legs.map(leg => (
                <SideNavMenuItem key={leg.id} as={NavLink} to={`/flight/${leg.id}`}>
                  {leg.label}
                </SideNavMenuItem>
              ))}
            </SideNavMenu>
          ))}
          <SideNavDivider />
          {looseFlights.map(f => (
            <SideNavLink key={f.id} as={NavLink} to={`/flight/${f.id}`}>
              {f.label}
            </SideNavLink>
          ))}
        </SideNavItems>
      </SideNav>

      <Content>{children}</Content>
    </>
  );
}
