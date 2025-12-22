// Cloudflare R2 Storage configuration
import { S3Client } from '@aws-sdk/client-s3';
import { config } from './index.js';

// R2 uses S3-compatible API
export const r2Client = new S3Client({
  region: 'auto', // R2 doesn't use regions, but SDK requires this
  endpoint: config.cloudflare.r2.endpoint,
  credentials: {
    accessKeyId: config.cloudflare.r2.accessKeyId,
    secretAccessKey: config.cloudflare.r2.secretAccessKey,
  },
});

// Bucket references
export const BUCKETS = {
  uploads: config.cloudflare.r2.buckets.uploads,
  aiContent: config.cloudflare.r2.buckets.aiContent,
  static: config.cloudflare.r2.buckets.static,
} as const;

// CDN path prefixes for each bucket
// When using R2.dev public URLs (one URL per bucket), set these to empty strings
// When using a unified CDN domain with routing, use path prefixes
export const CDN_PATHS = {
  uploads: '',      // R2.dev URLs point directly to bucket root
  aiContent: '',
  static: '',
} as const;

export type BucketName = keyof typeof BUCKETS;

// Helper to get full CDN URL for a bucket and path
export function getCdnUrl(bucket: BucketName, storagePath: string = ''): string {
  const baseUrl = config.cloudflare.cdnBaseUrl;
  const prefix = CDN_PATHS[bucket];
  return `${baseUrl}${prefix}/${storagePath}`.replace(/\/+$/, '');
}
