import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

const WEB_BASE_URL = 'https://www.subito.it';
const MARKETPLACE_REFERER_URL = `${WEB_BASE_URL}/annunci-italia/vendita/usato/`;
const SEARCH_ENDPOINT_CANDIDATES = [
    {
        name: 'web-hades-search',
        url: `${WEB_BASE_URL}/hades/v1/search/items`,
    },
    {
        name: 'direct-hades-search',
        url: 'https://hades.subito.it/v1/search/items',
    },
];
const CATEGORY_ENDPOINT_CANDIDATES = [
    {
        name: 'web-hades-categories',
        url: `${WEB_BASE_URL}/hades/v1/values/categories`,
    },
    {
        name: 'direct-hades-categories',
        url: 'https://hades.subito.it/v1/values/categories',
    },
];

const SUBITO_HEADERS = {
    Accept: 'application/json',
    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    'X-Subito-Channel': 'web',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
};

let categorySlugMapCache;
let preferredSearchEndpointName;
let preferredCategoryEndpointName;

await Actor.init();

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const hasMeaningfulInput = (value) => isPlainObject(value) && Object.keys(value).length > 0;

const toPositiveInteger = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.floor(parsed);
};

const loadLocalInputFallback = async () => {
    if (process.env.APIFY_IS_AT_HOME === '1') return {};

    try {
        const parsed = JSON.parse(await readFile('INPUT.json', 'utf8'));
        if (!hasMeaningfulInput(parsed)) return {};

        log.info('Using INPUT.json fallback for local run because no Actor input was provided.');
        return parsed;
    } catch (error) {
        log.warning(`Could not load local INPUT.json fallback: ${error.message}`);
        return {};
    }
};

const getRuntimeInput = async () => {
    const actorInput = (await Actor.getInput()) || {};
    if (hasMeaningfulInput(actorInput)) return actorInput;
    return loadLocalInputFallback();
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

const buildRequestHeaders = (url) => {
    const headers = { ...SUBITO_HEADERS };

    if (url.startsWith(WEB_BASE_URL)) {
        headers.Accept = 'application/json, text/plain, */*';
        headers.Origin = WEB_BASE_URL;
        headers.Referer = MARKETPLACE_REFERER_URL;
        headers['Sec-Fetch-Dest'] = 'empty';
        headers['Sec-Fetch-Mode'] = 'cors';
        headers['Sec-Fetch-Site'] = 'same-site';
    }

    return headers;
};

const getOrderedCandidates = (candidates, preferredName) => {
    if (!preferredName) return candidates;

    const preferred = candidates.find((candidate) => candidate.name === preferredName);
    if (!preferred) return candidates;

    return [
        preferred,
        ...candidates.filter((candidate) => candidate.name !== preferredName),
    ];
};

const createRequestError = (message, details = {}) => Object.assign(new Error(message), details);

const getChallengeUrl = (body) => {
    const challengeUrl = typeof body?.url === 'string' ? body.url : '';
    return challengeUrl.includes('captcha-delivery.com') ? challengeUrl : '';
};

const getAdsFromResponse = (body) => {
    const candidates = [
        body?.ads,
        body?.items,
        body?.results,
        body?.data?.ads,
        body?.data?.items,
        body?.data?.results,
    ];

    return candidates.find((candidate) => Array.isArray(candidate)) || null;
};

const getResponseKeys = (body) => (isPlainObject(body) ? Object.keys(body) : []);

const validateSearchResponse = ({ statusCode, body, url }) => {
    const challengeUrl = getChallengeUrl(body);
    if (challengeUrl) {
        return createRequestError(`Blocked by anti-bot challenge for ${url}`, {
            code: 'ANTI_BOT_CHALLENGE',
            challengeUrl,
        });
    }

    if (statusCode >= 400) {
        return createRequestError(`HTTP ${statusCode} returned by ${url}`, {
            code: 'HTTP_ERROR',
            statusCode,
            responseKeys: getResponseKeys(body),
        });
    }

    if (!getAdsFromResponse(body)) {
        return createRequestError(`Search response shape changed for ${url}`, {
            code: 'UNEXPECTED_RESPONSE_SHAPE',
            responseKeys: getResponseKeys(body),
        });
    }

    return undefined;
};

const validateCategoryResponse = ({ statusCode, body, url }) => {
    const challengeUrl = getChallengeUrl(body);
    if (challengeUrl) {
        return createRequestError(`Blocked by anti-bot challenge for ${url}`, {
            code: 'ANTI_BOT_CHALLENGE',
            challengeUrl,
        });
    }

    if (statusCode >= 400) {
        return createRequestError(`HTTP ${statusCode} returned by ${url}`, {
            code: 'HTTP_ERROR',
            statusCode,
            responseKeys: getResponseKeys(body),
        });
    }

    if (!Array.isArray(body?.values)) {
        return createRequestError(`Category response shape changed for ${url}`, {
            code: 'UNEXPECTED_RESPONSE_SHAPE',
            responseKeys: getResponseKeys(body),
        });
    }

    return undefined;
};

const resolveNextStart = (body, currentStart, itemsCount) => {
    const rawCandidates = [
        body?.start,
        body?.pagination?.next_start,
        body?.pagination?.nextStart,
        body?.next_start,
        body?.nextStart,
    ];

    for (const rawCandidate of rawCandidates) {
        const parsed = Number(rawCandidate);
        if (Number.isFinite(parsed) && parsed > currentStart) return parsed;
    }

    const fallbackStart = currentStart + itemsCount;
    return fallbackStart > currentStart ? fallbackStart : undefined;
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

const fetchJson = async ({
    endpointCandidates,
    searchParams,
    proxyConfiguration,
    preferredEndpointName,
    maxRetries = 3,
    validateBody,
}) => {
    let lastError;
    const orderedCandidates = getOrderedCandidates(endpointCandidates, preferredEndpointName);

    for (const endpointCandidate of orderedCandidates) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
                const response = await gotScraping({
                    url: endpointCandidate.url,
                    searchParams,
                    headers: buildRequestHeaders(endpointCandidate.url),
                    proxyUrl,
                    responseType: 'json',
                    timeout: { request: 30000 },
                    retry: { limit: 0 },
                    throwHttpErrors: false,
                });

                const validationError = validateBody?.({
                    statusCode: response.statusCode,
                    body: response.body,
                    url: endpointCandidate.url,
                });
                if (validationError) throw validationError;

                return {
                    body: response.body,
                    endpointCandidate,
                };
            } catch (error) {
                lastError = error;

                const errorDetails = {
                    code: error.code,
                    statusCode: error.statusCode,
                    responseKeys: error.responseKeys,
                    challengeUrl: error.challengeUrl,
                };

                if (attempt < maxRetries) {
                    log.warning(`Request failed (attempt ${attempt}/${maxRetries}) for ${endpointCandidate.url}: ${error.message}`, errorDetails);
                    continue;
                }

                log.warning(`Endpoint candidate exhausted: ${endpointCandidate.url}`, errorDetails);
            }
        }
    }

    throw lastError;
};

const getCategorySlugMap = async (proxyConfiguration) => {
    if (categorySlugMapCache) return categorySlugMapCache;

    try {
        const { body, endpointCandidate } = await fetchJson({
            endpointCandidates: CATEGORY_ENDPOINT_CANDIDATES,
            searchParams: undefined,
            proxyConfiguration,
            preferredEndpointName: preferredCategoryEndpointName,
            validateBody: validateCategoryResponse,
        });
        preferredCategoryEndpointName = endpointCandidate.name;

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
    const input = await getRuntimeInput();
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
        const paramsForRequest = { ...searchParams, lim: limit, start: currentStart };

        log.info(`Fetching page ${page}`, { endpointPreference: preferredSearchEndpointName || 'auto', params: paramsForRequest });

        const { body: response, endpointCandidate } = await fetchJson({
            endpointCandidates: SEARCH_ENDPOINT_CANDIDATES,
            searchParams: paramsForRequest,
            proxyConfiguration,
            preferredEndpointName: preferredSearchEndpointName,
            validateBody: validateSearchResponse,
        });
        preferredSearchEndpointName = endpointCandidate.name;

        const ads = getAdsFromResponse(response) || [];
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

        const nextStart = resolveNextStart(response, currentStart, ads.length);
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
