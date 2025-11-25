import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { lookup } from 'mime-types';
import { v4 as uuidv4 } from 'uuid';
import { r2Client, BUCKETS, BucketName, getCdnUrl } from '../../config/r2.js';
import { config } from '../../config/index.js';
import { generateStoragePath, StoragePathParams } from '../../utils/storagePaths.js';

// ============================================
// CONFIGURATION
// ============================================

const MAX_FILE_SIZE = config.upload.maxSizeMB * 1024 * 1024;
const ALLOWED_TYPES = config.upload.allowedTypes;
const UPLOAD_URL_EXPIRY = config.upload.presignedUrlExpiry.upload;
const DOWNLOAD_URL_EXPIRY = config.upload.presignedUrlExpiry.download;

// ============================================
// TYPES
// ============================================

export interface UploadRequest {
  familyId: string;
  childId: string;
  contentType: StoragePathParams['contentType'];
  filename: string;
  mimeType: string;
  fileSize: number;
  lessonId?: string;
}

export interface UploadResponse {
  uploadUrl: string;
  publicUrl: string;
  storagePath: string;
  expiresAt: Date;
}

export interface StoredFile {
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  metadata: Record<string, string>;
}

// ============================================
// VALIDATION (Child Safety First!)
// ============================================

/**
 * Validate upload request for child safety and COPPA compliance
 * @throws Error if validation fails
 */
export function validateUploadRequest(request: UploadRequest): void {
  // File size check
  if (request.fileSize > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }

  // MIME type check (whitelist approach for child safety)
  if (!ALLOWED_TYPES.includes(request.mimeType)) {
    throw new Error(
      `File type not allowed. Accepted types: ${ALLOWED_TYPES.join(', ')}`
    );
  }

  // Filename sanitization
  if (!/^[a-zA-Z0-9_\-. ]+$/.test(request.filename)) {
    throw new Error('Invalid filename. Use only letters, numbers, spaces, hyphens, and underscores.');
  }

  // File extension matches MIME type
  const expectedMime = lookup(request.filename);
  if (expectedMime && expectedMime !== request.mimeType) {
    throw new Error('File extension does not match content type');
  }
}

// ============================================
// PRESIGNED URLS
// ============================================

/**
 * Generate a presigned URL for direct upload to R2
 * Client uploads directly to R2, bypassing Node.js for large files
 */
export async function getPresignedUploadUrl(
  request: UploadRequest
): Promise<UploadResponse> {
  // Validate first (throws on failure)
  validateUploadRequest(request);

  // Generate unique path
  const uniqueFilename = `${uuidv4()}-${request.filename}`;
  const storagePath = generateStoragePath({
    ...request,
    filename: uniqueFilename,
  });

  // Determine bucket
  const bucketKey: BucketName = request.contentType.startsWith('ai-')
    ? 'aiContent'
    : 'uploads';

  // Create presigned PUT URL
  const command = new PutObjectCommand({
    Bucket: BUCKETS[bucketKey],
    Key: storagePath,
    ContentType: request.mimeType,
    ContentLength: request.fileSize,
    Metadata: {
      'family-id': request.familyId,
      'child-id': request.childId,
      'original-filename': request.filename,
      'uploaded-at': new Date().toISOString(),
    },
  });

  const uploadUrl = await getSignedUrl(r2Client, command, {
    expiresIn: UPLOAD_URL_EXPIRY,
  });

  const expiresAt = new Date(Date.now() + UPLOAD_URL_EXPIRY * 1000);

  // Public URL via CDN
  const publicUrl = getCdnUrl(bucketKey, storagePath);

  return {
    uploadUrl,
    publicUrl,
    storagePath,
    expiresAt,
  };
}

/**
 * Generate a presigned URL for downloading/viewing content
 * Used for private content that shouldn't be publicly accessible
 */
export async function getPresignedDownloadUrl(
  storagePath: string,
  bucket: BucketName = 'uploads'
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKETS[bucket],
    Key: storagePath,
  });

  return getSignedUrl(r2Client, command, {
    expiresIn: DOWNLOAD_URL_EXPIRY,
  });
}

// ============================================
// CRUD OPERATIONS
// ============================================

/**
 * Upload a file directly from the backend (for server-side processing)
 */
export async function uploadFile(
  bucket: BucketName,
  storagePath: string,
  body: Buffer | Uint8Array | string,
  mimeType: string,
  metadata: Record<string, string> = {}
): Promise<StoredFile> {
  const command = new PutObjectCommand({
    Bucket: BUCKETS[bucket],
    Key: storagePath,
    Body: body,
    ContentType: mimeType,
    Metadata: metadata,
  });

  await r2Client.send(command);

  return {
    storagePath,
    publicUrl: getCdnUrl(bucket, storagePath),
    mimeType,
    size: Buffer.byteLength(body),
    uploadedAt: new Date(),
    metadata,
  };
}

/**
 * Delete a file from R2
 */
export async function deleteFile(
  bucket: BucketName,
  storagePath: string
): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKETS[bucket],
    Key: storagePath,
  });

  await r2Client.send(command);
}

/**
 * Delete all files for a child (COPPA: parent-requested deletion)
 */
export async function deleteAllChildContent(
  familyId: string,
  childId: string
): Promise<{ deleted: number }> {
  let deleted = 0;

  // Delete from uploads bucket
  const uploadPrefix = `families/${familyId}/${childId}/`;
  deleted += await deleteByPrefix('uploads', uploadPrefix);

  // Delete from AI content bucket
  for (const type of ['images', 'videos', 'audio']) {
    const aiPrefix = `${type}/${familyId}/${childId}/`;
    deleted += await deleteByPrefix('aiContent', aiPrefix);
  }

  return { deleted };
}

/**
 * Helper: Delete all objects with a given prefix
 */
async function deleteByPrefix(
  bucket: BucketName,
  prefix: string
): Promise<number> {
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKETS[bucket],
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    const response = await r2Client.send(listCommand);

    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key) {
          await deleteFile(bucket, object.Key);
          deleted++;
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return deleted;
}

/**
 * Get file metadata without downloading content
 */
export async function getFileMetadata(
  bucket: BucketName,
  storagePath: string
): Promise<StoredFile | null> {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKETS[bucket],
      Key: storagePath,
    });

    const response = await r2Client.send(command);

    return {
      storagePath,
      publicUrl: getCdnUrl(bucket, storagePath),
      mimeType: response.ContentType || 'application/octet-stream',
      size: response.ContentLength || 0,
      uploadedAt: response.LastModified || new Date(),
      metadata: response.Metadata || {},
    };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'NotFound') {
      return null;
    }
    throw error;
  }
}

/**
 * List all files for a child (for parent dashboard)
 */
export async function listChildContent(
  familyId: string,
  childId: string
): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  const prefix = `families/${familyId}/${childId}/`;

  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKETS.uploads,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    const response = await r2Client.send(command);

    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key) {
          files.push({
            storagePath: object.Key,
            publicUrl: getCdnUrl('uploads', object.Key),
            mimeType: 'application/octet-stream', // Would need HeadObject for actual type
            size: object.Size || 0,
            uploadedAt: object.LastModified || new Date(),
            metadata: {},
          });
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return files;
}
