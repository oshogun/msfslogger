# client-carbon

A prototype of the Sabiá client redesigned in IBM Carbon (Gray 100 theme). It runs on
mock data only: there is no backend and the real API is never called. It is a
standalone package, not a workspace member, and `client/` is untouched.

## Prerequisites

Node 24 (the repo's `.nvmrc` pins it; `package.json` enforces `>=24 <25`), e.g. `nvm use 24`.

## Run it

From a fresh clone:

    cd client-carbon
    IBM_TELEMETRY_DISABLED=true npm ci
    npm run build       # tsc --noEmit && vite build
    npm run preview     # http://127.0.0.1:5274 (serves dist/, so build first)

or, for a dev server with hot reload: `npm run dev` (http://127.0.0.1:5273).

Fake login: any username, password `sabia`.

## Screens

| Path | Screen | What to try |
|---|---|---|
| `/login` | Sign in | Any username, password `sabia`; a wrong password is rejected |
| `/` | Home | Live status, ground card and manual ground entry, totals, recent flights |
| `/flights` | All flights | Search, paging, combine flights, add to trip, KML export |
| `/prefiles` | Prefiles | Planned legs table, `.lnmpln` and SimBrief import, skip/link/delete |
| `/settings` | Settings | SimBrief user id and SayIntentions key |
| `/flight/1` | Flight detail | 600-point flight: map with the altitude chart beneath, Track and Replay tabs |
| `/flight/8` | Flight detail | Manually linked to a planned leg: the hand-close gate |
| `/flight/12` | Flight detail | No recorded points |
| `/flight/13` | Flight detail | Live, in progress; ACARS at `/flight/13/acars` |
| `/planned-leg/3/acars` | ACARS | Messages for a planned leg |
| `/trip/1` | Trip detail | Legs, combined route; `?view=atlas` for the atlas view |
| `/trip/2` | Trip detail | 27-leg table: pagination and reordering |
| `/trip/3` | Trip detail | Empty trip |
| `/device`, `/override` | Easter eggs | Poke around |
| `/dev/gallery` | Component gallery | Every shared component with mock props |

## URL switches

- `?fail=<name>[,<name>]` makes mock calls reject so you can see error states. A name is a
  group (`flights`, `trips`, `legs`, `acars`, `settings`, `navdata`, `ground`, `journey`,
  `live`) or an exact accessor name such as `getFlight`.
- `?statusSpeed=6` runs the scripted live-status loop (idle, ground, recording, paused,
  recording, idle; about 90 s at 1x) six times faster.
- `?view=atlas` and `?page=N` on `/trip/:id` (atlas view, leg-table page).

## What is mocked

All data lives in an in-memory store in `src/mock/`. Writes persist until the page is
reloaded, every call takes 250 ms, and no data goes over the network. The map tiles do
come from OpenStreetMap, so maps need internet access.

`npm run check:types-mirror` diffs `src/mock/types.ts` against `../client/src/types.ts`,
so it needs the whole repo checked out.

## Styles

`src/styles/index.scss` is the theme entry point. It also loads
`@carbon/react/scss/layout` (emits the `--cds-layout-*` tokens buttons, inputs
and tags need for height and padding) and the breadcrumb and stack component
styles. Component styles are imported one line per component instead of via the
`@carbon/react` barrel, so any page that starts using a new Carbon component must
add its `@use '@carbon/react/scss/components/<name>'` line, or the component
renders unstyled.

## Known limitations and deliberate deviations

- Print routes (`/print/*`) and PDF export are excluded; the Export PDF buttons are present
  but non-functional.
- Flight detail shows the altitude chart under the map, with Track and Replay as tabs; Edit
  is a modal rather than an inline form. (The live page stacks Track/Altitude/Replay sections.)
- The sidebar collapse preference is not persisted (Carbon owns the breakpoint).
- The SimBrief user id and SayIntentions key live on `/settings`, not on Prefiles.
- ACARS has a manual Refresh button.
- Planned-leg row actions on Prefiles and Trip detail are icon buttons rather than an overflow menu, so every action stays one Tab away.
- Home's ground-position manual entry and the rest of the write paths are mock-backed.
- The navdata panel is large on phones.
- The real API is never called.
