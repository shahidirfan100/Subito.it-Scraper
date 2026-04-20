# Subito.it Scraper

Collect rich Subito.it listing data from search pages, category pages, and generic marketplace URLs. This actor is built for fast, large-scale extraction with stable pagination and structured output for analysis, monitoring, and automation.

## Features

- **Flexible input modes** — Use a Subito URL or use keyword and location inputs.
- **Category-aware extraction** — Supports category URLs and resolves category filters automatically.
- **Pagination control** — Collect exactly the amount of data you need with page and result limits.
- **Clean dataset output** — Removes null values from output records before saving.
- **Rich listing fields** — Returns listing metadata, pricing, geo info, images, advertiser info, and full feature sets.

---

## Use Cases

### Marketplace Monitoring
Track active listings and observe how categories, pricing, and volume change over time.

### Competitive Research
Build datasets for category-level and keyword-level intelligence across multiple markets.

### Lead Generation
Extract filtered listing feeds for business development and sales operations.

### Pricing Analysis
Monitor historical and current pricing trends by category, location, and listing type.

### BI and Reporting
Export structured data to dashboards, spreadsheets, and data warehouses.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `startUrl` | String | No | `"https://www.subito.it/annunci-italia/vendita/usato/"` | Subito URL to start from. |
| `keyword` | String | No | `"occhiali moscot"` | Search keyword used when URL has no query term. |
| `location` | String | No | `"Roma"` | Optional location text combined with keyword. |
| `results_wanted` | Integer | No | `20` | Maximum number of records to save. |
| `max_pages` | Integer | No | `10` | Maximum number of pages to fetch. |
| `proxyConfiguration` | Object | No | Apify Proxy residential | Proxy settings for reliable production runs. |

---

## Output Data

Each dataset item can contain the following fields:

| Field | Type | Description |
|---|---|---|
| `urn` | String | Unique listing identifier. |
| `title` | String | Listing title. |
| `description` | String | Listing description text. |
| `ad_type` | String | Listing type label (for example In vendita). |
| `ad_type_key` | String | Compact type key. |
| `category` | String | Category name. |
| `category_id` | String | Category ID. |
| `category_slug` | String | Category slug. |
| `macrocategory_id` | String | Macro category ID when present. |
| `posted_at` | String | Publish timestamp. |
| `expires_at` | String | Expiration timestamp. |
| `price` | Number or String | Price parsed from listing features. |
| `shipping_cost` | Number or String | Shipping cost when available. |
| `image_count` | Integer | Number of listing images. |
| `image_urls` | Array | Listing image URLs. |
| `region` | String | Region at top-level for easier filtering. |
| `region_id` | String | Region ID at top-level. |
| `city` | String | City at top-level for easier filtering. |
| `city_id` | String | City ID at top-level. |
| `town` | String | Town at top-level. |
| `town_id` | String | Town ID at top-level. |
| `advertiser` | Object | Advertiser data (id, name, company, type). |
| `geo` | Object | Region, city, and town information. |
| `url` | String | Listing URL. |
| `mobile_url` | String | Mobile listing URL. |
| `features` | Object | Structured listing features. |

---

## Usage Examples

### Marketplace URL

```json
{
	"startUrl": "https://www.subito.it/annunci-italia/vendita/usato/",
	"results_wanted": 20,
	"max_pages": 10
}
```

### Keyword Search

```json
{
	"keyword": "occhiali moscot",
	"location": "Roma",
	"results_wanted": 50,
	"max_pages": 20
}
```

### Category URL Search

```json
{
	"startUrl": "https://www.subito.it/annunci-italia/vendita/auto/",
	"results_wanted": 30,
	"max_pages": 15
}
```

---

## Sample Output

```json
{
	"urn": "id:ad:b7cf54df-9aca-4df7-a4b9-dfc5dd8ed058:list:639348779",
	"title": "Occhiali Moscot Lemtosh Matte Black",
	"description": "Occhiale Lemtosh Matte Black with custom made tints...",
	"ad_type": "In vendita",
	"ad_type_key": "s",
	"category": "Abbigliamento e Accessori",
	"category_id": "16",
	"posted_at": "2026-04-20T08:26:36.564+0200",
	"price": 330,
	"image_count": 4,
	"geo": {
		"region": "Lazio",
		"region_id": "11",
		"city": "Roma",
		"city_id": "4",
		"town": "Roma",
		"town_id": "058091"
	},
	"url": "https://www.subito.it/abbigliamento-accessori/occhiali-moscot-lemtosh-matte-black-roma-639348779.htm"
}
```

---

## Tips For Best Results

### Use Valid Subito URLs
- Prefer category and search-result URLs directly from Subito.
- Keep URL parameters when you need exact filtering behavior.

### Start Small, Then Scale
- Start with `results_wanted: 20` for quick validation.
- Increase limits once your query pattern is confirmed.

### Use Proxies In Production
- Residential proxies help stabilize larger runs.
- Keep retries and timeouts conservative for long schedules.

---

## Proxy Configuration

```json
{
	"proxyConfiguration": {
		"useApifyProxy": true,
		"apifyProxyGroups": ["RESIDENTIAL"]
	}
}
```

---

## Integrations

- **Google Sheets** — Build quick listing trackers.
- **Airtable** — Create searchable listing databases.
- **Make** — Trigger downstream automations.
- **Zapier** — Connect listing events to business tools.
- **Webhooks** — Push fresh data to your systems.

### Export Formats

- **JSON** — Best for APIs and custom pipelines.
- **CSV** — Best for spreadsheet analysis.
- **Excel** — Best for operational reporting.
- **XML** — Best for legacy integrations.

---

## Frequently Asked Questions

### Can I use only keyword and location without URL?
Yes. Provide `keyword` and optionally `location`, and the actor will run search extraction.

### Does the actor support category URLs?
Yes. Category slugs are resolved and used to query matching listing data.

### Are empty or null fields saved?
No. Output records are cleaned so null values are removed before saving.

### Can I collect thousands of records?
Yes. Increase `results_wanted` and `max_pages` based on your use case and runtime constraints.

### Is proxy configuration required?
Not always, but recommended for production stability and higher-volume extraction.

---

## Support

For issues or feature requests, open the actor in Apify Console and use the support options there.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Schedules](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is intended for legitimate data collection and analytics workflows. You are responsible for complying with website terms and all applicable laws in your jurisdiction.