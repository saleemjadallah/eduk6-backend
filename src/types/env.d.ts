declare namespace NodeJS {
  interface ProcessEnv {
    // Cloudflare Account
    CLOUDFLARE_ACCOUNT_ID: string;
    CLOUDFLARE_R2_ACCESS_KEY_ID: string;
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: string;

    // R2 Bucket Names
    R2_BUCKET_UPLOADS: string;
    R2_BUCKET_AI_CONTENT: string;
    R2_BUCKET_STATIC: string;

    // R2 Endpoint
    R2_ENDPOINT: string;

    // CDN Base URL (single domain via Cloudflare Worker)
    CDN_BASE_URL: string;

    // Upload Limits
    MAX_UPLOAD_SIZE_MB: string;
    ALLOWED_UPLOAD_TYPES: string;

    // Presigned URL Expiry
    PRESIGNED_URL_EXPIRY_UPLOAD: string;
    PRESIGNED_URL_EXPIRY_DOWNLOAD: string;

    // Server
    PORT: string;
    NODE_ENV: 'development' | 'production' | 'test';
    FRONTEND_URL: string;

    // Firebase
    FIREBASE_PROJECT_ID: string;
    FIREBASE_SERVICE_ACCOUNT_JSON: string;

    // Gemini AI
    GEMINI_API_KEY: string;
  }
}
