/**
 * Currency Routes
 *
 * Location-based currency detection and conversion endpoints.
 * These routes are PUBLIC (no auth required) to allow currency detection
 * for all visitors, including non-logged-in users viewing pricing pages.
 *
 * Uses GeoPlugin API for IP-based geolocation and exchange rates.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { currencyService, getClientIP } from '../services/currency/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// =============================================================================
// PUBLIC ENDPOINTS (No auth required)
// =============================================================================

/**
 * GET /api/currency/detect
 * Detect visitor's currency based on their IP address
 *
 * Returns: currency code, symbol, exchange rate, and location info
 */
router.get('/detect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Extract client IP from request
    const clientIP = getClientIP(
      req.headers as Record<string, string | string[] | undefined>,
      req.socket.remoteAddress
    );

    logger.info('Currency detection requested', {
      detectedIP: clientIP ? '***' : 'auto',
      userAgent: req.headers['user-agent']?.substring(0, 50),
    });

    // Get currency info from GeoPlugin
    const currencyInfo = await currencyService.getCurrencyInfoByIP(clientIP);

    res.json({
      success: true,
      data: currencyInfo,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/currency/convert
 * Convert a price to the visitor's local currency
 *
 * Body: { amount: number, baseCurrency?: string }
 * Returns: original and converted price with formatting
 */
router.post('/convert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, baseCurrency = 'USD' } = req.body;

    // Validate amount
    if (typeof amount !== 'number' || isNaN(amount) || amount < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount. Must be a positive number.',
      });
    }

    // Extract client IP
    const clientIP = getClientIP(
      req.headers as Record<string, string | string[] | undefined>,
      req.socket.remoteAddress
    );

    // Get currency info and convert
    const { currencyInfo, convertedPrice } = await currencyService.detectAndConvert(
      amount,
      clientIP,
      baseCurrency
    );

    res.json({
      success: true,
      data: {
        currencyInfo,
        convertedPrice,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/currency/convert-batch
 * Convert multiple prices at once
 *
 * Body: { amounts: number[], baseCurrency?: string }
 * Returns: array of converted prices
 */
router.post('/convert-batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amounts, baseCurrency = 'USD' } = req.body;

    // Validate amounts
    if (!Array.isArray(amounts) || amounts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Amounts must be a non-empty array of numbers.',
      });
    }

    if (amounts.some((a) => typeof a !== 'number' || isNaN(a) || a < 0)) {
      return res.status(400).json({
        success: false,
        error: 'All amounts must be positive numbers.',
      });
    }

    if (amounts.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 amounts per request.',
      });
    }

    // Extract client IP
    const clientIP = getClientIP(
      req.headers as Record<string, string | string[] | undefined>,
      req.socket.remoteAddress
    );

    // Get currency info
    const currencyInfo = await currencyService.getCurrencyInfoByIP(clientIP, baseCurrency);

    // Convert all prices
    const convertedPrices = await currencyService.convertPrices(amounts, currencyInfo, baseCurrency);

    res.json({
      success: true,
      data: {
        currencyInfo,
        convertedPrices,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/currency/supported
 * Get list of supported currencies (for UI dropdowns)
 */
router.get('/supported', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const currencies = currencyService.getSupportedCurrencies();

    res.json({
      success: true,
      data: {
        currencies,
        defaultCurrency: 'USD',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/currency/by-country/:countryCode
 * Get currency info for a specific country code
 * Useful for manual country selection
 */
router.get('/by-country/:countryCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { countryCode } = req.params;

    // Validate country code (ISO 3166-1 alpha-2)
    if (!countryCode || countryCode.length !== 2) {
      return res.status(400).json({
        success: false,
        error: 'Invalid country code. Must be 2-letter ISO code (e.g., US, GB, DE).',
      });
    }

    // For now, we use a static mapping for common countries
    // GeoPlugin requires an IP, so for manual selection we use a lookup table
    const currencyByCountry: Record<string, { code: string; symbol: string }> = {
      US: { code: 'USD', symbol: '$' },
      GB: { code: 'GBP', symbol: '£' },
      EU: { code: 'EUR', symbol: '€' },
      DE: { code: 'EUR', symbol: '€' },
      FR: { code: 'EUR', symbol: '€' },
      IT: { code: 'EUR', symbol: '€' },
      ES: { code: 'EUR', symbol: '€' },
      NL: { code: 'EUR', symbol: '€' },
      BE: { code: 'EUR', symbol: '€' },
      AT: { code: 'EUR', symbol: '€' },
      IE: { code: 'EUR', symbol: '€' },
      PT: { code: 'EUR', symbol: '€' },
      FI: { code: 'EUR', symbol: '€' },
      GR: { code: 'EUR', symbol: '€' },
      CA: { code: 'CAD', symbol: 'C$' },
      AU: { code: 'AUD', symbol: 'A$' },
      JP: { code: 'JPY', symbol: '¥' },
      CN: { code: 'CNY', symbol: '¥' },
      IN: { code: 'INR', symbol: '₹' },
      BR: { code: 'BRL', symbol: 'R$' },
      MX: { code: 'MXN', symbol: '$' },
      CH: { code: 'CHF', symbol: 'CHF' },
      SE: { code: 'SEK', symbol: 'kr' },
      NO: { code: 'NOK', symbol: 'kr' },
      DK: { code: 'DKK', symbol: 'kr' },
      PL: { code: 'PLN', symbol: 'zł' },
      ZA: { code: 'ZAR', symbol: 'R' },
      AE: { code: 'AED', symbol: 'د.إ' },
      SA: { code: 'SAR', symbol: '﷼' },
      SG: { code: 'SGD', symbol: 'S$' },
      HK: { code: 'HKD', symbol: 'HK$' },
      NZ: { code: 'NZD', symbol: 'NZ$' },
      KR: { code: 'KRW', symbol: '₩' },
      TR: { code: 'TRY', symbol: '₺' },
      RU: { code: 'RUB', symbol: '₽' },
      IL: { code: 'ILS', symbol: '₪' },
      TH: { code: 'THB', symbol: '฿' },
      MY: { code: 'MYR', symbol: 'RM' },
      ID: { code: 'IDR', symbol: 'Rp' },
      PH: { code: 'PHP', symbol: '₱' },
      VN: { code: 'VND', symbol: '₫' },
    };

    const upperCode = countryCode.toUpperCase();
    const currency = currencyByCountry[upperCode];

    if (!currency) {
      // Default to USD for unknown countries
      return res.json({
        success: true,
        data: {
          countryCode: upperCode,
          currencyCode: 'USD',
          currencySymbol: '$',
          note: 'Country not in lookup table, defaulting to USD',
        },
      });
    }

    res.json({
      success: true,
      data: {
        countryCode: upperCode,
        currencyCode: currency.code,
        currencySymbol: currency.symbol,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
