## Selected API

- Endpoint: `https://hades.subito.it/v1/search/items`
- Method: `GET`
- Required headers: `X-Subito-Channel: web` and standard browser-like headers
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

- `https://hades.subito.it/v1/values/categories`
  - Used to map category slug in URL paths to category id (`c`) dynamically.

### Recommended endpoint note

- `https://hades.subito.it/v1/search/items/hp-recommended`
  - Returns listing data, but is not used for deep pagination because its response does not expose a reliably advancing pagination token.
  - Broad marketplace browsing now uses `https://hades.subito.it/v1/search/items` with `t=s`, `start`, and `lim` so runs can continue beyond 100 items.

## Candidate evaluation

### Candidate A (Selected)

- Endpoint: `https://hades.subito.it/v1/search/items`
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
- Direct HTTP calls to `hades` endpoints succeeded without browser rendering.

## Implementation decision

- Actor is fully HTTP/API based.
- No browser crawler is used.
- No HTML parsing is used for dataset extraction.
- Null values are removed from dataset records before `Dataset.pushData`.
