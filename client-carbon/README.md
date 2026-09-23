# client-carbon

Standalone IBM Carbon (Gray 100) prototype of the Sabiá client, mock data only, no backend.
Not a workspace member; `client/` is untouched.

    nvm use 24
    npm install
    npm run build      # tsc --noEmit && vite build
    npm run preview    # http://127.0.0.1:5274
    npm run dev        # http://127.0.0.1:5273

Fake login: any username, password `sabia`.

## Styles

`src/styles/index.scss` is the frozen contract file, amended: it also loads
`@carbon/react/scss/layout` (emits the `--cds-layout-*` tokens buttons, inputs
and tags need for height and padding) and the breadcrumb and stack component
styles. Component styles are imported one line per component instead of via the
`@carbon/react` barrel, so any page that starts using a new Carbon component must
add its `@use '@carbon/react/scss/components/<name>'` line, or the component
renders unstyled.
