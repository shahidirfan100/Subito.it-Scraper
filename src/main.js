import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

const HADES_BASE_URL = 'https://hades.subito.it';
const SEARCH_ITEMS_ENDPOINT = `${HADES_BASE_URL}/v1/search/items`;
const CATEGORY_VALUES_ENDPOINT = `${HADES_BASE_URL}/v1/values/categories`;

const SUBITO_HEADERS = {
    Accept: 'application/json',
    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    'X-Subito-Channel': 'web',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
};

let categorySlugMapCache;

await Actor.init();

const toPositiveInteger = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.floor(parsed);
};

const compactValue = (value) => {
    if (value === null || value === undefined) return undefined;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || undefined;
    }

    if (Array.isArray(value)) {
        const cleaned = value
            .map((entry) => compactValue(entry))
            .filter((entry) => entry !== undefined);
        return cleaned;
    }

    if (typeof value === 'object') {
        const output = {};
        for (const [key, entry] of Object.entries(value)) {
            const cleaned = compactValue(entry);
            if (cleaned !== undefined) output[key] = cleaned;
        }
        return Object.keys(output).length ? output : undefined;
    }

    return value;
};

const parseFeatureNumeric = (featureValue) => {
    if (!featureValue?.key) return undefined;
    const normalized = String(featureValue.key).replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const buildFeatureMap = (features = []) => {
    const map = {};

    for (const feature of features) {
        if (!feature?.uri || !Array.isArray(feature.values)) continue;

        map[feature.uri] = feature.values
            .map((valueItem) => {
                const item = {
                    key: valueItem?.key,
                    value: valueItem?.value,
                    label: feature.label,
                };

                const numeric = parseFeatureNumeric(valueItem);
                if (numeric !== undefined) item.numeric = numeric;

                return compactValue(item);
            })
            .filter(Boolean);
    }

    return map;
};

const parseStartUrl = (startUrl, categorySlugMap) => {
    const parsed = {
        queryKeyword: '',
        categoryId: '',
        adType: 's',
        start: 0,
        passthroughParams: {},
    };

    if (!startUrl) return parsed;

    let parsedUrl;
    try {
        parsedUrl = new URL(startUrl);
    } catch {
        log.warning(`Ignoring invalid URL in input: ${startUrl}`);
        return parsed;
    }

    if (!parsedUrl.hostname.endsWith('subito.it')) {
        log.warning(`URL host is not subito.it, URL-derived filters will be ignored: ${startUrl}`);
        return parsed;
    }

    const { searchParams } = parsedUrl;
    parsed.queryKeyword = (searchParams.get('q') || '').trim();
    parsed.adType = (searchParams.get('t') || 's').trim() || 's';

    const startParam = Number.parseInt(searchParams.get('start') || '0', 10);
    parsed.start = Number.isFinite(startParam) && startParam >= 0 ? startParam : 0;

    const explicitCategory = (searchParams.get('c') || '').trim();
    if (explicitCategory) parsed.categoryId = explicitCategory;

    const passthroughKeys = ['r', 'ci', 'to', 'z', 'sort', 'qso', 'shp', 'urg', 'ndo', 'advt', 'ps', 'pe'];
    for (const key of passthroughKeys) {
        const value = searchParams.get(key);
        if (value !== null && value !== '') parsed.passthroughParams[key] = value;
    }

    if (!parsed.categoryId) {
        const pathSegments = parsedUrl.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment.toLowerCase()));
        const venditaIndex = pathSegments.indexOf('vendita');
        const categorySlug = venditaIndex >= 0 ? pathSegments[venditaIndex + 1] : '';

        if (categorySlug && categorySlug !== 'usato') {
            parsed.categoryId = categorySlugMap.get(categorySlug) || '';
        }
    }

    return parsed;
};

const mergeKeywordAndLocation = (keyword, location) => {
    const keywordText = (keyword || '').trim();
    const locationText = (location || '').trim();

    if (keywordText && locationText) return `${keywordText} ${locationText}`;
    if (keywordText) return keywordText;
    if (locationText) return locationText;
    return '';
};

const buildAdRecord = (ad) => {
    const featureMap = buildFeatureMap(ad?.features);
    const priceInfo = featureMap['/price']?.[0];
    const shippingCostInfo = featureMap['/item_shipping_cost_tuttosubito']?.[0];
    const region = ad?.geo?.region?.value;
    const city = ad?.geo?.city?.value;
    const town = ad?.geo?.town?.value;
    const regionId = ad?.geo?.region?.key;
    const cityId = ad?.geo?.city?.key;
    const townId = ad?.geo?.town?.key;

    return compactValue({
        urn: ad?.urn,
        title: ad?.subject,
        description: ad?.body,
        ad_type: ad?.type?.value,
        ad_type_key: ad?.type?.key,
        category: ad?.category?.value,
        category_id: ad?.category?.key,
        category_slug: ad?.category?.friendly_name,
        macrocategory_id: ad?.category?.macrocategory_id,
        posted_at: ad?.dates?.display_iso8601 || ad?.dates?.display,
        expires_at: ad?.dates?.expiration_iso8601 || ad?.dates?.expiration,
        price: priceInfo?.numeric ?? priceInfo?.value,
        shipping_cost: shippingCostInfo?.numeric ?? shippingCostInfo?.value,
        image_count: Array.isArray(ad?.images) ? ad.images.length : 0,
        image_urls: (ad?.images || []).map((image) => image?.cdn_base_url || image?.base_url),
        region,
        region_id: regionId,
        city,
        city_id: cityId,
        town,
        town_id: townId,
        advertiser: {
            id: ad?.advertiser?.user_id,
            name: ad?.advertiser?.name,
            phone: ad?.advertiser?.phone,
            company: ad?.advertiser?.company,
            type: ad?.advertiser?.type,
        },
        geo: {
            region,
            region_id: regionId,
            city,
            city_id: cityId,
            town,
            town_id: townId,
        },
        url: ad?.urls?.default,
        mobile_url: ad?.urls?.mobile,
        features: featureMap,
    });
};

const fetchJson = async ({ url, searchParams, proxyConfiguration, maxRetries = 3 }) => {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
            const response = await gotScraping({
                url,
                searchParams,
                headers: SUBITO_HEADERS,
                proxyUrl,
                responseType: 'json',
                timeout: { request: 30000 },
                retry: { limit: 0 },
            });

            return response.body;
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                log.warning(`Request failed (attempt ${attempt}/${maxRetries}) for ${url}: ${error.message}`);
            }
        }
    }

    throw lastError;
};

const getCategorySlugMap = async (proxyConfiguration) => {
    if (categorySlugMapCache) return categorySlugMapCache;

    try {
        const body = await fetchJson({
            url: CATEGORY_VALUES_ENDPOINT,
            searchParams: undefined,
            proxyConfiguration,
        });

        const map = new Map();
        for (const category of body?.values || []) {
            if (!category?.friendly_name || !category?.key) continue;
            map.set(category.friendly_name.toLowerCase(), String(category.key));
        }

        categorySlugMapCache = map;
        return map;
    } catch (error) {
        log.warning(`Could not fetch category map. URL category parsing will be limited: ${error.message}`);
        categorySlugMapCache = new Map();
        return categorySlugMapCache;
    }
};

const main = async () => {
    const input = (await Actor.getInput()) || {};
    const {
        startUrl,
        url,
        keyword,
        location,
        results_wanted: resultsWantedInput = 20,
        max_pages: maxPagesInput = 10,
        proxyConfiguration: proxyConfig,
    } = input;

    const resultsWanted = toPositiveInteger(resultsWantedInput, 20);
    const maxPages = toPositiveInteger(maxPagesInput, 10);
    const proxyConfiguration = proxyConfig ? await Actor.createProxyConfiguration(proxyConfig) : undefined;

    const urlInput = (typeof startUrl === 'string' && startUrl.trim())
        || (typeof url === 'string' && url.trim())
        || '';

    const categorySlugMap = await getCategorySlugMap(proxyConfiguration);
    const parsedUrlInput = parseStartUrl(urlInput, categorySlugMap);

    const finalQuery = mergeKeywordAndLocation(
        (typeof keyword === 'string' && keyword.trim()) || parsedUrlInput.queryKeyword,
        typeof location === 'string' ? location : '',
    );

    const searchParams = {
        t: parsedUrlInput.adType || 's',
        ...parsedUrlInput.passthroughParams,
    };

    if (finalQuery) searchParams.q = finalQuery;
    if (parsedUrlInput.categoryId) searchParams.c = parsedUrlInput.categoryId;

    let currentStart = parsedUrlInput.start;
    let totalSaved = 0;

    log.info('Starting Subito extraction', {
        useRecommendedEndpoint: false,
        query: searchParams.q || '(none)',
        category: searchParams.c || '(none)',
        requested: resultsWanted,
        maxPages,
    });

    for (let page = 1; page <= maxPages && totalSaved < resultsWanted; page++) {
        const remaining = resultsWanted - totalSaved;
        const limit = Math.min(remaining, 100);

        const endpoint = SEARCH_ITEMS_ENDPOINT;
        const paramsForRequest = { ...searchParams, lim: limit, start: currentStart };

        log.info(`Fetching page ${page}`, { endpoint, params: paramsForRequest });

        const response = await fetchJson({
            url: endpoint,
            searchParams: paramsForRequest,
            proxyConfiguration,
        });

        const ads = Array.isArray(response?.ads) ? response.ads : [];
        if (!ads.length) {
            log.info('No more ads returned by API, stopping pagination.');
            break;
        }

        const records = [];
        for (const ad of ads) {
            if (totalSaved + records.length >= resultsWanted) break;
            const record = buildAdRecord(ad);
            if (record) records.push(record);
        }

        if (records.length) {
            await Dataset.pushData(records);
            totalSaved += records.length;
            log.info(`Saved ${records.length} records`, { totalSaved, resultsWanted });
        }

        const nextStart = Number(response?.start);
        if (!Number.isFinite(nextStart) || nextStart <= currentStart) {
            log.info('Pagination token did not advance, stopping to avoid duplicate pages.');
            break;
        }

        currentStart = nextStart;
        if (ads.length < limit) break;
    }

    log.info(`Subito extraction finished. Total saved: ${totalSaved}`);
};

try {
    await main();
} catch (error) {
    log.exception(error, 'Actor failed');
    process.exitCode = 1;
} finally {
    await Actor.exit();
}
