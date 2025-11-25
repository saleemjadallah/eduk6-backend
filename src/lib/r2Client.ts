import { S3Client } from '@aws-sdk/client-s3';

// R2 uses S3-compatible API
export const r2Client = new S3Client({
  region: 'auto', // R2 doesn't use regions, but SDK requires this
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

// Bucket references
export const BUCKETS = {
  uploads: process.env.R2_BUCKET_UPLOADS!,
  aiContent: process.env.R2_BUCKET_AI_CONTENT!,
  static: process.env.R2_BUCKET_STATIC!,
} as const;

// CDN path prefixes for each bucket (used with single CDN domain)
export const CDN_PATHS = {
  uploads: '/uploads',
  aiContent: '/ai',
  static: '/static',
} as const;

export type BucketName = keyof typeof BUCKETS;

// Helper to get full CDN URL for a bucket and path
export function getCdnUrl(bucket: BucketName, storagePath: string = ''): string {
  const baseUrl = process.env.CDN_BASE_URL!;
  const prefix = CDN_PATHS[bucket];
  return `${baseUrl}${prefix}/${storagePath}`.replace(/\/+$/, ''); // Remove trailing slashes
}
