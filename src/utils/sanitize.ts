/**
 * Sanitization utilities for database-safe content
 *
 * PostgreSQL text fields don't allow null bytes (0x00),
 * which can appear in PDF extraction or other binary-to-text conversions.
 */

/**
 * Remove null bytes and other problematic characters from a string
 * for safe storage in PostgreSQL text fields.
 * Returns undefined if input is null/undefined to match TypeScript conventions.
 */
export function sanitizeForPostgres(input: string | null | undefined): string | undefined {
  if (input === null || input === undefined) {
    return undefined;
  }

  // Remove null bytes (0x00) which PostgreSQL doesn't allow in text fields
  // Also remove other control characters except newlines, tabs, and carriage returns
  return input
    .replace(/\x00/g, '') // Remove null bytes
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, ''); // Remove other control chars (keep \t, \n, \r)
}

/**
 * Sanitize a string, returning empty string as fallback (never undefined)
 */
export function sanitizeForPostgresStrict(input: string | null | undefined): string {
  return sanitizeForPostgres(input) ?? '';
}

/**
 * Recursively sanitize all string values in an object
 */
export function sanitizeObjectForPostgres<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeForPostgres(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObjectForPostgres(item)) as T;
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObjectForPostgres(value);
    }
    return sanitized as T;
  }

  return obj;
}

export default { sanitizeForPostgres, sanitizeForPostgresStrict, sanitizeObjectForPostgres };
