/**
 * Currency Service
 *
 * Location-based automatic currency detection and conversion using GeoPlugin.
 * Detects visitor's location via IP and returns their local currency info
 * with real-time exchange rates.
 *
 * Features:
 * - IP-based geolocation and currency detection
 * - Exchange rate conversion (base currency: USD)
 * - Redis caching (1 hour TTL for exchange rates)
 * - Fallback to USD if detection fails
 */

import { redis } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// TYPES
// =============================================================================

export interface GeoPluginResponse {
  geoplugin_request: string;
  geoplugin_status: number;
  geoplugin_delay: string;
  geoplugin_credit: string;
  geoplugin_city: string;
  geoplugin_region: string;
  geoplugin_regionCode: string;
  geoplugin_regionName: string;
  geoplugin_areaCode: string;
  geoplugin_dmaCode: string;
  geoplugin_countryCode: string;
  geoplugin_countryName: string;
  geoplugin_inEU: number;
  geoplugin_euVATrate: boolean | number;
  geoplugin_continentCode: string;
  geoplugin_continentName: string;
  geoplugin_latitude: string;
  geoplugin_longitude: string;
  geoplugin_locationAccuracyRadius: string;
  geoplugin_timezone: string;
  geoplugin_currencyCode: string;
  geoplugin_currencySymbol: string;
  geoplugin_currencySymbol_UTF8: string;
  geoplugin_currencyConverter: number;
}

export interface CurrencyInfo {
  currencyCode: string;
  currencySymbol: string;
  exchangeRate: number; // Rate to convert from USD to this currency
  countryCode: string;
  countryName: string;
  city: string;
  region: string;
  timezone: string;
  isEU: boolean;
  euVATrate: number | null;
}

export interface ConvertedPrice {
  originalAmount: number;
  originalCurrency: string;
  convertedAmount: number;
  convertedCurrency: string;
  currencySymbol: string;
  formattedPrice: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const GEOPLUGIN_API_URL = 'http://www.geoplugin.net/json.gp';
const GEOPLUGIN_SSL_URL = 'https://ssl.geoplugin.net/json.gp';

// Cache settings
const CACHE_PREFIX = 'currency:';
const CACHE_TTL = {
  CURRENCY_INFO: 3600, // 1 hour for currency/location data
  EXCHANGE_RATE: 3600, // 1 hour for exchange rates
};

// Default fallback currency (USD)
const DEFAULT_CURRENCY: CurrencyInfo = {
  currencyCode: 'USD',
  currencySymbol: '$',
  exchangeRate: 1,
  countryCode: 'US',
  countryName: 'United States',
  city: '',
  region: '',
  timezone: 'America/New_York',
  isEU: false,
  euVATrate: null,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract client IP from request headers
 * Handles proxies, load balancers, and direct connections
 */
export function getClientIP(
  headers: Record<string, string | string[] | undefined>,
  socketRemoteAddress?: string
): string {
  // Check X-Forwarded-For header (common for proxies/load balancers)
  const forwardedFor = headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(',');
    const clientIP = ips[0].trim();
    if (clientIP && clientIP !== '::1' && clientIP !== '127.0.0.1') {
      return clientIP;
    }
  }

  // Check X-Real-IP header (nginx)
  const realIP = headers['x-real-ip'];
  if (realIP) {
    const ip = Array.isArray(realIP) ? realIP[0] : realIP;
    if (ip && ip !== '::1' && ip !== '127.0.0.1') {
      return ip;
    }
  }

  // Check CF-Connecting-IP (Cloudflare)
  const cfIP = headers['cf-connecting-ip'];
  if (cfIP) {
    const ip = Array.isArray(cfIP) ? cfIP[0] : cfIP;
    if (ip) return ip;
  }

  // Fall back to socket remote address
  if (socketRemoteAddress && socketRemoteAddress !== '::1' && socketRemoteAddress !== '127.0.0.1') {
    // Handle IPv6-mapped IPv4 addresses
    if (socketRemoteAddress.startsWith('::ffff:')) {
      return socketRemoteAddress.substring(7);
    }
    return socketRemoteAddress;
  }

  // Default to empty (will use GeoPlugin's auto-detection)
  return '';
}

/**
 * Format price with currency symbol
 */
function formatPrice(amount: number, currencySymbol: string, currencyCode: string): string {
  // Round to 2 decimal places
  const rounded = Math.round(amount * 100) / 100;

  // Format based on currency conventions
  const symbolBefore = ['$', '£', '€', '¥', '₹', 'R$', 'kr', 'zł'].includes(currencySymbol);

  if (symbolBefore) {
    return `${currencySymbol}${rounded.toFixed(2)}`;
  } else {
    return `${rounded.toFixed(2)} ${currencyCode}`;
  }
}

// =============================================================================
// SERVICE FUNCTIONS
// =============================================================================

/**
 * Get currency info from GeoPlugin API
 * Uses caching to reduce API calls
 */
async function getCurrencyInfoByIP(
  ipAddress?: string,
  baseCurrency: string = 'USD'
): Promise<CurrencyInfo> {
  try {
    // Build cache key
    const cacheKey = `${CACHE_PREFIX}info:${ipAddress || 'auto'}:${baseCurrency}`;

    // Check cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug('Currency info cache hit', { ipAddress, baseCurrency });
      return JSON.parse(cached) as CurrencyInfo;
    }

    // Build API URL
    let apiUrl = GEOPLUGIN_SSL_URL;
    const params = new URLSearchParams();

    if (ipAddress) {
      params.append('ip', ipAddress);
    }

    if (baseCurrency !== 'USD') {
      params.append('base_currency', baseCurrency);
    }

    const queryString = params.toString();
    if (queryString) {
      apiUrl += `?${queryString}`;
    }

    // Call GeoPlugin API
    logger.info('Calling GeoPlugin API', { apiUrl: apiUrl.replace(/ip=[\d.]+/, 'ip=***') });

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`GeoPlugin API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as GeoPluginResponse;

    // Check for valid response
    if (data.geoplugin_status !== 200 && data.geoplugin_status !== 206) {
      logger.warn('GeoPlugin returned non-success status', { status: data.geoplugin_status });
      return DEFAULT_CURRENCY;
    }

    // Parse response into our format
    const currencyInfo: CurrencyInfo = {
      currencyCode: data.geoplugin_currencyCode || 'USD',
      currencySymbol: data.geoplugin_currencySymbol_UTF8 || data.geoplugin_currencySymbol || '$',
      exchangeRate: data.geoplugin_currencyConverter || 1,
      countryCode: data.geoplugin_countryCode || 'US',
      countryName: data.geoplugin_countryName || 'United States',
      city: data.geoplugin_city || '',
      region: data.geoplugin_regionName || data.geoplugin_region || '',
      timezone: data.geoplugin_timezone || 'UTC',
      isEU: data.geoplugin_inEU === 1,
      euVATrate: typeof data.geoplugin_euVATrate === 'number' ? data.geoplugin_euVATrate : null,
    };

    // Cache the result
    await redis.setex(cacheKey, CACHE_TTL.CURRENCY_INFO, JSON.stringify(currencyInfo));
    logger.info('Currency info fetched and cached', {
      countryCode: currencyInfo.countryCode,
      currencyCode: currencyInfo.currencyCode,
    });

    return currencyInfo;
  } catch (error) {
    logger.error('Error fetching currency info from GeoPlugin', { error, ipAddress });
    return DEFAULT_CURRENCY;
  }
}

/**
 * Convert a price from base currency to target currency
 */
async function convertPrice(
  amount: number,
  targetCurrencyInfo: CurrencyInfo,
  baseCurrency: string = 'USD'
): Promise<ConvertedPrice> {
  const convertedAmount = amount * targetCurrencyInfo.exchangeRate;

  return {
    originalAmount: amount,
    originalCurrency: baseCurrency,
    convertedAmount: Math.round(convertedAmount * 100) / 100,
    convertedCurrency: targetCurrencyInfo.currencyCode,
    currencySymbol: targetCurrencyInfo.currencySymbol,
    formattedPrice: formatPrice(
      convertedAmount,
      targetCurrencyInfo.currencySymbol,
      targetCurrencyInfo.currencyCode
    ),
  };
}

/**
 * Convert multiple prices at once
 */
async function convertPrices(
  amounts: number[],
  targetCurrencyInfo: CurrencyInfo,
  baseCurrency: string = 'USD'
): Promise<ConvertedPrice[]> {
  return amounts.map((amount) => ({
    originalAmount: amount,
    originalCurrency: baseCurrency,
    convertedAmount: Math.round(amount * targetCurrencyInfo.exchangeRate * 100) / 100,
    convertedCurrency: targetCurrencyInfo.currencyCode,
    currencySymbol: targetCurrencyInfo.currencySymbol,
    formattedPrice: formatPrice(
      amount * targetCurrencyInfo.exchangeRate,
      targetCurrencyInfo.currencySymbol,
      targetCurrencyInfo.currencyCode
    ),
  }));
}

/**
 * Get currency info and convert a price in one call
 * Convenience function for common use case
 */
async function detectAndConvert(
  amount: number,
  ipAddress?: string,
  baseCurrency: string = 'USD'
): Promise<{ currencyInfo: CurrencyInfo; convertedPrice: ConvertedPrice }> {
  const currencyInfo = await getCurrencyInfoByIP(ipAddress, baseCurrency);
  const convertedPrice = await convertPrice(amount, currencyInfo, baseCurrency);

  return { currencyInfo, convertedPrice };
}

/**
 * Clear currency cache for an IP (useful for testing)
 */
async function clearCache(ipAddress?: string): Promise<void> {
  const pattern = `${CACHE_PREFIX}*${ipAddress || ''}*`;
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
    logger.info('Currency cache cleared', { keysCleared: keys.length });
  }
}

/**
 * Get supported currencies list (for UI dropdowns)
 */
function getSupportedCurrencies(): { code: string; symbol: string; name: string }[] {
  return [
    { code: 'USD', symbol: '$', name: 'US Dollar' },
    { code: 'EUR', symbol: '€', name: 'Euro' },
    { code: 'GBP', symbol: '£', name: 'British Pound' },
    { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
    { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
    { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
    { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
    { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
    { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
    { code: 'MXN', symbol: '$', name: 'Mexican Peso' },
    { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
    { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
    { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone' },
    { code: 'DKK', symbol: 'kr', name: 'Danish Krone' },
    { code: 'PLN', symbol: 'zł', name: 'Polish Zloty' },
    { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
    { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
    { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal' },
    { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
    { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
    { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
    { code: 'KRW', symbol: '₩', name: 'South Korean Won' },
    { code: 'TRY', symbol: '₺', name: 'Turkish Lira' },
    { code: 'RUB', symbol: '₽', name: 'Russian Ruble' },
    { code: 'ILS', symbol: '₪', name: 'Israeli Shekel' },
    { code: 'THB', symbol: '฿', name: 'Thai Baht' },
    { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
    { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah' },
    { code: 'PHP', symbol: '₱', name: 'Philippine Peso' },
    { code: 'VND', symbol: '₫', name: 'Vietnamese Dong' },
  ];
}

// =============================================================================
// EXPORTS
// =============================================================================

export const currencyService = {
  getCurrencyInfoByIP,
  convertPrice,
  convertPrices,
  detectAndConvert,
  clearCache,
  getSupportedCurrencies,
  getClientIP,
  DEFAULT_CURRENCY,
};

export default currencyService;
