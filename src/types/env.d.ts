declare namespace NodeJS {
  interface ProcessEnv {
    // Server
    NODE_ENV: 'development' | 'production' | 'test';
    PORT: string;
    FRONTEND_URL: string;
    ALLOWED_ORIGINS: string;

    // Database
    DATABASE_URL: string;

    // Redis
    REDIS_URL: string;

    // Session & Auth
    SESSION_SECRET: string;
    JWT_SECRET?: string;

    // Cloudflare R2
    CLOUDFLARE_ACCOUNT_ID: string;
    R2_ENDPOINT: string;
    CLOUDFLARE_R2_ACCESS_KEY_ID: string;
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: string;
    R2_BUCKET_UPLOADS: string;
    R2_BUCKET_AI_CONTENT: string;
    R2_BUCKET_STATIC: string;
    CDN_BASE_URL: string;

    // Upload Limits
    MAX_UPLOAD_SIZE_MB: string;
    ALLOWED_UPLOAD_TYPES: string;
    PRESIGNED_URL_EXPIRY_UPLOAD: string;
    PRESIGNED_URL_EXPIRY_DOWNLOAD: string;

    // AI Services
    GEMINI_API_KEY: string;

    // Firebase
    FIREBASE_PROJECT_ID?: string;
    FIREBASE_SERVICE_ACCOUNT_JSON?: string;

    // Email (Resend)
    RESEND_API_KEY?: string;
    RESEND_FROM_EMAIL?: string;
    SKIP_EMAILS?: string;

    // Stripe
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;

    // Logging
    LOG_LEVEL?: string;
    DEBUG?: string;
  }
}
