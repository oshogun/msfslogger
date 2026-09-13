# Captured SimBrief API responses — provenance

Every file in this directory is a **raw, unedited response body** from
SimBrief's dispatch API, captured with `curl` on **2026-09-13** (UTC) during
task T-001 of run `2026-09-13-simbrief-import`. Nothing here was hand-written,
reformatted, or trimmed. `design.md` § 1 cites these files by field path.

The operator (this app's user) supplied their own SimBrief identifiers for the
success capture: pilot ID `1099607`, username `oshogun`.

| File | Exact request URL | HTTP | Content-Type | Bytes |
|---|---|---|---|---|
| `simbrief.userid.json` | `https://www.simbrief.com/api/xml.fetcher.php?userid=1099607&json=1` | 200 | `application/json` | 333773 |
| `simbrief.username.json` | `https://www.simbrief.com/api/xml.fetcher.php?username=oshogun&json=1` | 200 | `application/json` | 333773 |
| `simbrief.userid.xml` | `https://www.simbrief.com/api/xml.fetcher.php?userid=1099607` | 200 | `text/xml;charset=UTF-8` | 427960 |
| `simbrief.error.baduserid.txt` | `…?userid=999999999&json=1` | **400** | `application/json` | 96 |
| `simbrief.error.noplan.txt` | `…?userid=2&json=1` | **400** | `application/json` | 119 |
| `simbrief.error.badusername.txt` | `…?username=zzznosuchpilotzzz&json=1` | **400** | `application/json` | 87 |
| `simbrief.error.noparams.txt` | `…?json=1` (no user identifier) | **400** | `application/json` | 87 |

`simbrief-plan.d.ts` is the only hand-written file here: the frozen TypeScript
interfaces from `design.md` § 4 and § 5, as a reference artifact. It is **not**
wired into `tsconfig.json` and nothing imports it.

## Facts that only the raw captures prove

1. **No authentication of any kind.** No API key, no token, no cookie, no
   `Authorization` header was sent on any request above, and all of them were
   answered. Response headers carried `access-control-allow-origin: *`.
2. **The two success captures are byte-identical except for one field.** A
   structural diff of `simbrief.userid.json` against `simbrief.username.json`
   reports exactly one differing path: `$.fetch.time` (`"0.0023"` vs
   `"0.0022"`), SimBrief's own server-side timing number. `userid=` and
   `username=` are two keys onto the same record. This is why § 4 does not hash
   the raw body.
3. **Empty XML elements become `{}`, not `""` or `null`.** 164 empty-object
   leaves in the success sample, e.g. `$.general.icao_airline`,
   `$.origin.faa_code`, `$.general.sid_trans`. In the *error* bodies the same
   `static_id` field is `""` instead — the two shapes are not consistent with
   each other.
4. **A single repeated element collapses to an object, not a 1-element array.**
   The operator's plan was filed with `altn=NONE`, so `$.alternate` is `{}`.
   Two unrelated pilot IDs whose latest plan has exactly one alternate were
   probed for shape only (bodies deliberately **not** saved here — they are
   other people's flight plans): both returned `$.alternate` as a *38-key
   object*, not an array. See `design.md` § 4.3.
5. **Every scalar is a string.** `"elevation":"128"`, `"altitude_feet":"7400"`,
   `"pos_lat":"53.169444"`. There is not one JSON number in the document.

## Reproducing

    curl -sS 'https://www.simbrief.com/api/xml.fetcher.php?userid=1099607&json=1'

The success capture is a snapshot of *the most recent OFP at capture time*
(UHPP→UHSS, generated `1789306516` = 2026-09-13T13:35:16Z). The operator
generating a new OFP replaces what this URL returns; it does not invalidate the
field paths in § 1, which are structural.
