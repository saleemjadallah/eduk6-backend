/**
 * Currency Services
 *
 * Exports all currency-related services:
 * - currencyService: Location-based currency detection and conversion
 */

export { currencyService, getClientIP } from './currencyService.js';
export type { CurrencyInfo, ConvertedPrice, GeoPluginResponse } from './currencyService.js';
