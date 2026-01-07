/**
 * Currency Service
 *
 * Location-based automatic currency detection and conversion using ipwhois.app.
 * Detects visitor's location via IP and returns their local currency info
 * with real-time exchange rates.
 *
 * Features:
 * - IP-based geolocation and currency detection
 * - Exchange rate conversion (base currency: USD)
 * - Redis caching (1 hour TTL for exchange rates)
 * - Fallback to USD if detection fails
 *
 * API: ipwhois.app - Free tier: 10,000 requests/month
 */

import { redis } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// TYPES
// =============================================================================

export interface IpWhoisResponse {
  ip: string;
  success: boolean;
  message?: string;
  type: string;
  continent: string;
  continent_code: string;
  country: string;
  country_code: string;
  country_flag: string;
  country_capital: string;
  country_phone: string;
  country_neighbours: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  asn: string;
  org: string;
  isp: string;
  timezone: string;
  timezone_name: string;
  timezone_dstOffset: number;
  timezone_gmtOffset: number;
  timezone_gmt: string;
  currency: string;
  currency_code: string;
  currency_symbol: string;
  currency_rates: number;
  currency_plural: string;
  is_eu: boolean;
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

// Using ipwhois.app - free tier: 10,000 requests/month
// Includes currency code, symbol, and exchange rates
const IPWHOIS_API_URL = 'https://ipwhois.app/json/';

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

// Reliable currency symbols mapping (ipwhois.app symbols can be inconsistent)
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹',
  AUD: 'A$', CAD: 'C$', CHF: 'CHF', HKD: 'HK$', SGD: 'S$',
  AED: 'د.إ', SAR: '﷼', BRL: 'R$', MXN: '$', ZAR: 'R',
  KRW: '₩', THB: '฿', MYR: 'RM', IDR: 'Rp', PHP: '₱',
  VND: '₫', TRY: '₺', RUB: '₽', PLN: 'zł', SEK: 'kr',
  NOK: 'kr', DKK: 'kr', NZD: 'NZ$', ILS: '₪', EGP: 'E£',
  PKR: '₨', BDT: '৳', NGN: '₦', KES: 'KSh', GHS: 'GH₵',
  QAR: '﷼', KWD: 'د.ك', BHD: 'د.ب', OMR: '﷼',
};

/**
 * Get reliable currency symbol from mapping, fallback to API response
 */
function getCurrencySymbol(currencyCode: string, apiSymbol?: string): string {
  if (CURRENCY_SYMBOLS[currencyCode]) {
    return CURRENCY_SYMBOLS[currencyCode];
  }
  // Clean up API symbol (remove dots, extra text)
  if (apiSymbol) {
    const cleaned = apiSymbol.split(' ')[0].replace(/^\./, '');
    return cleaned || currencyCode;
  }
  return currencyCode;
}

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
 * Get currency info from ipwhois.app API
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

    // Build API URL - ipwhois.app accepts IP as path parameter
    let apiUrl = IPWHOIS_API_URL;
    if (ipAddress) {
      apiUrl += ipAddress;
    }

    // Call ipwhois.app API
    logger.info('Calling ipwhois.app API', { apiUrl: ipAddress ? apiUrl.replace(ipAddress, '***') : apiUrl });

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`ipwhois.app API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as IpWhoisResponse;

    // Check for valid response
    if (!data.success) {
      logger.warn('ipwhois.app returned error', { message: data.message });
      return DEFAULT_CURRENCY;
    }

    // Parse response into our format
    // ipwhois.app provides exchange rate from USD directly
    const detectedCurrencyCode = data.currency_code || 'USD';
    const currencyInfo: CurrencyInfo = {
      currencyCode: detectedCurrencyCode,
      currencySymbol: getCurrencySymbol(detectedCurrencyCode, data.currency_symbol),
      exchangeRate: data.currency_rates || 1,
      countryCode: data.country_code || 'US',
      countryName: data.country || 'United States',
      city: data.city || '',
      region: data.region || '',
      timezone: data.timezone || 'UTC',
      isEU: data.is_eu || false,
      euVATrate: null, // ipwhois.app doesn't provide VAT rates
    };

    // Cache the result
    await redis.setex(cacheKey, CACHE_TTL.CURRENCY_INFO, JSON.stringify(currencyInfo));
    logger.info('Currency info fetched and cached', {
      countryCode: currencyInfo.countryCode,
      currencyCode: currencyInfo.currencyCode,
      exchangeRate: currencyInfo.exchangeRate,
    });

    return currencyInfo;
  } catch (error) {
    logger.error('Error fetching currency info from ipwhois.app', { error, ipAddress });
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

// Currency names for supported currencies list
const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', JPY: 'Japanese Yen',
  CNY: 'Chinese Yuan', INR: 'Indian Rupee', AUD: 'Australian Dollar',
  CAD: 'Canadian Dollar', CHF: 'Swiss Franc', HKD: 'Hong Kong Dollar',
  SGD: 'Singapore Dollar', AED: 'UAE Dirham', SAR: 'Saudi Riyal',
  BRL: 'Brazilian Real', MXN: 'Mexican Peso', ZAR: 'South African Rand',
  KRW: 'South Korean Won', THB: 'Thai Baht', MYR: 'Malaysian Ringgit',
  IDR: 'Indonesian Rupiah', PHP: 'Philippine Peso', VND: 'Vietnamese Dong',
  TRY: 'Turkish Lira', RUB: 'Russian Ruble', PLN: 'Polish Zloty',
  SEK: 'Swedish Krona', NOK: 'Norwegian Krone', DKK: 'Danish Krone',
  NZD: 'New Zealand Dollar', ILS: 'Israeli Shekel', EGP: 'Egyptian Pound',
  PKR: 'Pakistani Rupee', BDT: 'Bangladeshi Taka', NGN: 'Nigerian Naira',
  KES: 'Kenyan Shilling', GHS: 'Ghanaian Cedi', QAR: 'Qatari Riyal',
  KWD: 'Kuwaiti Dinar', BHD: 'Bahraini Dinar', OMR: 'Omani Rial',
};

/**
 * Get supported currencies list (for UI dropdowns)
 */
function getSupportedCurrencies(): { code: string; symbol: string; name: string }[] {
  return Object.entries(CURRENCY_SYMBOLS).map(([code, symbol]) => ({
    code,
    symbol,
    name: CURRENCY_NAMES[code] || code,
  }));
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
