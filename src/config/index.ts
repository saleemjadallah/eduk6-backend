// Environment configuration loader
import 'dotenv/config';

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // Frontend (for CORS)
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(','),

  // Database
  databaseUrl: process.env.DATABASE_URL!,

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Session & Auth
  sessionSecret: process.env.SESSION_SECRET!,
  // Separate secrets for access and refresh tokens
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET!,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET!,
  // Legacy - kept for backward compatibility, prefer specific secrets above
  jwtSecret: process.env.JWT_SECRET || process.env.SESSION_SECRET!,
  jwtAccessExpiry: '15m',
  jwtRefreshExpiry: '7d',
  // Cookie settings
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: process.env.NODE_ENV === 'production',

  // Cloudflare R2
  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    r2: {
      endpoint: process.env.R2_ENDPOINT!,
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
      buckets: {
        uploads: process.env.R2_BUCKET_UPLOADS!,
        aiContent: process.env.R2_BUCKET_AI_CONTENT!,
        static: process.env.R2_BUCKET_STATIC!,
      },
    },
    cdnBaseUrl: process.env.CDN_BASE_URL!,
  },

  // Upload limits
  upload: {
    maxSizeMB: parseInt(process.env.MAX_UPLOAD_SIZE_MB || '10'),
    allowedTypes: (process.env.ALLOWED_UPLOAD_TYPES || 'application/pdf,image/png,image/jpeg,image/webp').split(','),
    presignedUrlExpiry: {
      upload: parseInt(process.env.PRESIGNED_URL_EXPIRY_UPLOAD || '300'),
      download: parseInt(process.env.PRESIGNED_URL_EXPIRY_DOWNLOAD || '3600'),
    },
  },

  // AI Services
  gemini: {
    apiKey: process.env.GEMINI_API_KEY!,
    models: {
      // Gemini 3 Pro - Most advanced model (November 2025)
      pro: 'gemini-3-pro-preview',       // State-of-the-art reasoning with thinking
      // Gemini 2.5 models for different use cases
      flash: 'gemini-2.5-flash',         // Best price-performance, well-rounded
      flashLite: 'gemini-2.5-flash-lite', // Fastest, cost-efficient
      image: 'gemini-3-pro-image-preview', // Image generation with better text rendering
    },
  },

  // Firebase
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  },

  // Email (Resend)
  email: {
    apiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL || 'support@orbitlearn.app',
    skipEmails: process.env.SKIP_EMAILS === 'true',
  },

  // Stripe
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    webhookSecretCC: process.env.STRIPE_WEBHOOK_SECRET_CC, // For credit card consent verification
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  debug: process.env.DEBUG === 'true',
} as const;

// Validate required environment variables
export function validateEnv(): void {
  const required = [
    'DATABASE_URL',
    'SESSION_SECRET',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
