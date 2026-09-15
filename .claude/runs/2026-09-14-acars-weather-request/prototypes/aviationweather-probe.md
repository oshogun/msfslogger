# Prototype: aviationweather.gov Data API, live probe

Run 2026-09-14, from this machine, no credentials sent. Backs design.md §1.

## No auth required, 200 with data

```
$ curl -s -w "HTTP:%{http_code} TIME:%{time_total} SIZE:%{size_download}\n" \
    -o /tmp/metar_test.json "https://aviationweather.gov/api/data/metar?ids=KJFK&format=json"
HTTP:200 TIME:1.704643 SIZE:470

$ cat /tmp/metar_test.json
[{"icaoId":"KJFK","receiptTime":"2026-09-14T23:00:09.383Z","obsTime":1789426260,"reportTime":"2026-09-14T23:00:00.000Z","temp":22.8,"dewp":7.2,"wdir":20,"wspd":13,"visib":"10+","altim":1020.7,"slp":1019.8,"qcField":8,"metarType":"METAR","rawOb":"METAR KJFK 142251Z 02013KT 10SM FEW060 22/08 A3014 RMK SLP198 T02280072 $","lat":40.6392,"lon":-73.7639,"elev":3,"name":"New York/JF Kennedy Intl, NY, US","cover":"FEW","clouds":[{"cover":"FEW","base":6000}],"fltCat":"VFR"}]
```

## TAF, real station with a TAF on file

```
$ curl -s -w "\nHTTP:%{http_code}\n" "https://aviationweather.gov/api/data/taf?ids=KJFK&format=json"
[{"icaoId":"KJFK", ..., "rawTAF":"TAF KJFK 142334Z 1500/1606 01011KT P6SM SKC FM150700 03008KT P6SM SKC FM151500 08009KT P6SM FEW250 ...", ...}]
HTTP:200
```

## Unknown/made-up ICAO — METAR: 204, empty body

```
$ curl -s -m 20 -w "\nHTTP:%{http_code}\n" "https://aviationweather.gov/api/data/metar?ids=ZZZZ&format=json"

HTTP:204

$ curl -s -m 20 -w "\nHTTP:%{http_code}\n" "https://aviationweather.gov/api/data/metar?ids=XXXX&format=json"

HTTP:204

$ curl -s -m 20 -w "\nHTTP:%{http_code}\n" "https://aviationweather.gov/api/data/metar?ids=AB&format=json"

HTTP:204
```

## Real station, METAR present, no TAF on file — TAF: 200 with `[]`

```
$ curl -s -w "\nHTTP:%{http_code}\n" "https://aviationweather.gov/api/data/metar?ids=KRHV&format=json"
[{"icaoId":"KRHV", ..., "rawOb":"METAR KRHV 142247Z 33013KT 10SM FEW075 29/06 A2985", ...}]
HTTP:200

$ curl -s -w "\nHTTP:%{http_code}\n" "https://aviationweather.gov/api/data/taf?ids=KRHV&format=json"
[]
HTTP:200

$ curl -s -w "\nHTTP:%{http_code}\n" "https://aviationweather.gov/api/data/taf?ids=ZZZZ&format=json"
[]
HTTP:200
```

## No `ids` param at all — 400, error body (never reached by this run's code path)

```
$ curl -s "https://aviationweather.gov/api/data/metar?format=json"
{"status":"error","error":"Must specify station IDs or bounding box, zoom, and density"}
HTTP:400
```

## Headers on a normal 200 — no auth challenge, cache-control matches "METAR ~1/min-ish freshness"

```
$ curl -sI "https://aviationweather.gov/api/data/metar?ids=KJFK&format=json"
HTTP/2 200
date: Mon, 14 Sep 2026 23:45:38 GMT
content-type: application/json; charset=utf-8
content-length: 470
cache-control: max-age=60
etag: W/"1d6-7NiG00wOfdJgvFYYGl9Qo8mYs5Y"
x-frame-options: SAMEORIGIN
content-security-policy: frame-ancestors 'self' *.weather.gov
strict-transport-security: max-age=63072000; includeSubDomains
x-cache: CONFIG_NOCACHE
accept-ranges: bytes
```

No `www-authenticate`, no `set-cookie`. Lowercase `ids` value also works
(`kjfk` == `KJFK`), so the normalisation this run applies (trim + uppercase) is
purely for display/dedup consistency, not a requirement of the upstream.

## Usage/rate-limit text, from https://aviationweather.gov/data/api/ (fetched 2026-09-14)

Exact substrings pulled from the page's HTML:

> Please keep requests limited in scope and frequency. Maximum results per
> query apply as well as rate limiting against frequent requests.

> Wait between consecutive requests — maximum 100 requests per minute.
> Exceeding request limits will result in access being blocked.

> All requests are rate limited to 100 requests per minute.

> Consider product update frequency. For example most METARs update once per
> hour and TCF is issued every other hour.

> 429 Too Many Requests — Too many requests have been sent. You might see
> this error code when rate limits are applied. See Restrictions above.

No mention of an API key or any authentication requirement anywhere on the
page, consistent with every probe above sending none and being answered.
