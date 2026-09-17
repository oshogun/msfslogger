# Security

## Threat model

msfslogger is a self-hosted, single-operator application, typically exposed
on a home LAN (occasionally further, e.g. to reach a remote simulator PC or
the operator away from home). It has no multi-tenant isolation and doesn't
attempt any — the `auth_user` table is hard-constrained to exactly one row.
Treat any client that can reach the server's `/api` as either the operator
(via login) or a trusted telemetry source (via ingest token); there is no
concept of a lower-privileged authenticated user.

## Transport

The server will not silently serve plaintext HTTP to anything but a loopback
bind. Configure `TLS_CERT_FILE`/`TLS_KEY_FILE` for any LAN-reachable
deployment; the explicit `ALLOW_PLAINTEXT_HTTP=1` escape hatch exists for
trusted-LAN/dev convenience and should not be used for anything reachable
beyond that. See [configuration.md](configuration.md). There is exactly one
listener — no separate HTTP→HTTPS redirect port.

## Authentication

Two independent mechanisms, never mixed on the same request (see
[api.md § Auth model](api.md#auth-model-in-one-table) for which routes accept
which):

- **Session cookie** (`msfslogger.sid`) for the web UI: `httpOnly`,
  `sameSite=lax`, `secure` tied to whether TLS is actually enabled (never
  hard-coded true/false). `express-session`'s `regenerate()` runs before a
  successful login sets `req.session.user`, defeating session fixation.
  Sessions are stored in the database (not in-memory), so they survive a
  restart, and are swept for expiry every 6 hours.
- **Ingest token** (`x-ingest-token` header) for the Windows agent and other
  non-browser clients: compared with `crypto.timingSafeEqual` against a
  SHA-256 digest (not a plain string compare), so response timing doesn't
  leak how much of the token was correct. A token only authorizes the
  explicit route allow-list in `src/auth/ingestScope.ts` — it is not a
  blanket credential for the whole API, and a valid session always takes
  precedence over token evaluation on a shared route.

**Password storage**: scrypt (`N=16384, r=8, p=1`, 32-byte key, 16-byte
salt) via Node's built-in `crypto`, chosen specifically to avoid a second
native addon dependency (bcrypt/argon2). The stored format embeds the
parameters (`scrypt$N$r$p$<salt>$<key>`) so they can change later without
invalidating existing hashes. A wrong username is checked against a dummy
hash for a constant-ish time, so failed logins don't reveal whether the
username existed.

**Login throttling**: 10 failures per 15 minutes per client IP, in-memory
(not persisted — resets on restart), enforced *before* any database read.
`X-Forwarded-For` is deliberately ignored (`trust proxy` is not set) so it
can't be used to reset the throttle key or spoof `req.protocol`; if you run
msfslogger behind a reverse proxy, be aware the throttle (and same-origin
check) will key on the proxy's IP, not the real client's, unless you
configure Express's trust-proxy setting yourself — this repository doesn't.

## CSRF

`requireSameOrigin` middleware rejects any `/api` write request whose
`Origin` header doesn't match the request's own scheme+host, as
defense-in-depth behind `SameSite=Lax` cookies. Requests with no `Origin`
header at all (scripted/curl clients, and token-only sidecar clients with no
session cookie present) are allowed through — same-origin checking is
meaningful against a browser, not against a client presenting the ingest
token directly.

## Secrets

| Secret | Source | Notes |
|---|---|---|
| `INGEST_TOKEN` | operator-set env var | Shared verbatim between server and agent (and any other ingest-scoped client). Rotate by changing it on the server first, then every client — see [operations.md](operations.md#deploy-ordering-server--agent). |
| Session signing secret | `SESSION_SECRET` env var, or a random 32-byte value generated once and stored in the `app_secret` table | Set `SESSION_SECRET` explicitly if you want it independent of the database (e.g. to invalidate all sessions by rotating it without touching the DB). |
| Operator password | never stored in plaintext | scrypt hash only, in `auth_user`. Set via `npm run set-password`'s hidden prompt or piped stdin — never as a CLI argument, to avoid it appearing in `ps` output or shell history. |
| TLS private key | file on disk (`TLS_KEY_FILE`) | Optionally passphrase-protected (`TLS_KEY_PASSPHRASE`). Not read from the database. |

None of these are logged. Example/dev values shown elsewhere in this
documentation (e.g. `devtoken1234567890` for loopback dev) are not fit for
any deployment reachable beyond localhost — always generate a real value
(`openssl rand -hex 24`) for anything else.

## Data at rest

`flights.db` is an unencrypted SQLite file containing full flight history,
the operator's password hash, and session data. There is no field-level or
file-level encryption built in — rely on filesystem/disk-level protection
(permissions, disk encryption) if that matters for your deployment, and keep
backups (`npm run backup`) under the same protection as the live file.

## Uploads

File uploads (`multer`) are size- and count-capped per route (attached
flight-plan PDFs: 20MB, PDF-only, verified by both MIME type and file magic
bytes, not extension alone; `.lnmpln` imports: 512KB each, up to 25 per
request, sniffed as XML before parsing). Oversized or excess uploads are
rejected with `400` by the app-level error handler, not left to Express's
default multipart handling.

## License

GPL-3.0 (see [`LICENSE`](../LICENSE)) — no bearing on runtime security, noted
here for completeness since it's not covered elsewhere in this documentation
set.
