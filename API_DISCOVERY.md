## Selected API

- Endpoint: `https://www.subito.it/hades/v1/search/items`
- Method: `GET`
- Required headers: `X-Subito-Channel: web`, `Origin: https://www.subito.it`, `Referer: https://www.subito.it/annunci-italia/vendita/usato/`, and standard browser-like headers
- Auth: None
- Pagination: `start` + `lim` query params
- Core query params used:
  - `q` (keyword text)
  - `c` (category id)
  - `t` (ad type, typically `s`)
  - `start` (offset)
  - `lim` (page size)
  - optional passthrough params: `r`, `ci`, `to`, `z`, `sort`, `qso`, `shp`, `urg`, `ndo`, `advt`, `ps`, `pe`

### Field coverage

The endpoint returns rich structured listing records under `ads[]`, including:

- listing identifiers (`urn`)
- listing text (`subject`, `body`)
- full category info
- timestamps
- image URLs
- listing feature objects (including price and shipping)
- advertiser metadata
- geo metadata (region/city/town)
- canonical listing URLs

This provides substantially more fields than HTML card parsing.

### Supporting endpoint

- `https://www.subito.it/hades/v1/values/categories`
  - Used to map category slug in URL paths to category id (`c`) dynamically.

### 2026-05-05 live revalidation note

- `https://hades.subito.it/v1/search/items` now returns `403` with a `geo.captcha-delivery.com` interstitial URL in the JSON body for direct actor requests.
- `https://www.subito.it/hades/v1/search/items` returned `200` with listing data during the same live check.
- Both category endpoints still worked during the same validation pass:
  - `https://www.subito.it/hades/v1/values/categories`
  - `https://hades.subito.it/v1/values/categories`
- The actor should prefer the `www.subito.it/hades` path first and keep the direct `hades.subito.it` path only as a fallback candidate.

### Recommended endpoint note

- `https://hades.subito.it/v1/search/items/hp-recommended`
  - Returns listing data, but is not used for deep pagination because its response does not expose a reliably advancing pagination token.
  - Broad marketplace browsing now uses `https://www.subito.it/hades/v1/search/items` with `t=s`, `start`, and `lim` so runs can continue beyond 100 items.

## Candidate evaluation

### Candidate A (Selected)

- Endpoint: `https://www.subito.it/hades/v1/search/items`
- Previous direct endpoint: `https://hades.subito.it/v1/search/items`
- Returns JSON directly: Yes (+30)
- >15 unique fields: Yes (+25)
- No auth required: Yes (+20)
- Pagination support: Yes (+15)
- Matches and extends old output: Yes (+10)
- Score: 100

### Candidate B

- Endpoint: `https://www.subito.it/hades/v1/campaigns/query/lookup`
- Purpose: campaign lookup only
- Rejected because it does not return marketplace listing records.

### Candidate C

- Endpoint: `https://hades.subito.it/v1/adv/configs/page?property=desktop&name=listing&vertical=subito`
- Purpose: page ad configuration
- Rejected because it does not provide listing items.

## URLScan and bundle discovery notes

- URLScan public scans for Subito listing pages were used to identify `hades` network domain and request patterns.
- Client bundle analysis confirmed dedicated search methods using `/v1/search/items` plus mapped search parameters.
- Live validation on 2026-05-05 confirmed the working actor path is the `www.subito.it/hades/...` route, while the direct `hades.subito.it` search route is challenged for this traffic pattern.

## Implementation decision

- Actor is fully HTTP/API based.
- No browser crawler is used.
- No HTML parsing is used for dataset extraction.
- Null values are removed from dataset records before `Dataset.pushData`.
