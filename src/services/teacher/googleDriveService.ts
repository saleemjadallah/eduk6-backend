/**
 * Google Drive Service for Teacher Content
 * Handles OAuth and file upload to Google Drive
 */

import { google, drive_v3 } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { Readable } from 'stream';

// OAuth2 configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/teacher/google-drive/callback';

// Scopes needed for Drive access
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file', // Only files created by the app
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * Create a new OAuth2 client
 */
function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate the authorization URL for Google OAuth
 */
export function getAuthorizationUrl(state?: string): string {
  const oauth2Client = createOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to always get refresh token
    state: state,
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<Credentials> {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Save Google Drive tokens for a teacher
 */
export async function saveTeacherDriveTokens(
  teacherId: string,
  tokens: Credentials
): Promise<void> {
  await prisma.teacher.update({
    where: { id: teacherId },
    data: {
      googleDriveTokens: tokens as object,
    },
  });
}

/**
 * Get stored Google Drive tokens for a teacher
 */
export async function getTeacherDriveTokens(teacherId: string): Promise<Credentials | null> {
  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    select: { googleDriveTokens: true },
  });

  if (!teacher?.googleDriveTokens) {
    return null;
  }

  return teacher.googleDriveTokens as Credentials;
}

/**
 * Check if a teacher has connected Google Drive
 */
export async function isGoogleDriveConnected(teacherId: string): Promise<boolean> {
  const tokens = await getTeacherDriveTokens(teacherId);
  return !!tokens?.access_token;
}

/**
 * Disconnect Google Drive for a teacher
 */
export async function disconnectGoogleDrive(teacherId: string): Promise<void> {
  await prisma.teacher.update({
    where: { id: teacherId },
    data: {
      googleDriveTokens: Prisma.JsonNull,
    },
  });
}

/**
 * Get an authenticated Drive client for a teacher
 */
async function getDriveClient(teacherId: string): Promise<drive_v3.Drive | null> {
  const tokens = await getTeacherDriveTokens(teacherId);

  if (!tokens) {
    return null;
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Set up token refresh callback
  oauth2Client.on('tokens', async (newTokens) => {
    // Merge with existing tokens (preserve refresh token if not returned)
    const mergedTokens = {
      ...tokens,
      ...newTokens,
    };
    await saveTeacherDriveTokens(teacherId, mergedTokens);
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Create the Orbit Learn folder in Drive if it doesn't exist
 */
async function getOrCreateOrbitFolder(drive: drive_v3.Drive): Promise<string> {
  const folderName = 'Orbit Learn';

  // Search for existing folder
  const response = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id!;
  }

  // Create folder if it doesn't exist
  const folderMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };

  const folder = await drive.files.create({
    requestBody: folderMetadata,
    fields: 'id',
  });

  return folder.data.id!;
}

/**
 * Upload a file to Google Drive
 */
export async function uploadToDrive(
  teacherId: string,
  file: {
    name: string;
    mimeType: string;
    data: Buffer | string;
  },
  options: {
    folderId?: string;
    description?: string;
  } = {}
): Promise<{
  success: boolean;
  fileId?: string;
  webViewLink?: string;
  error?: string;
}> {
  const drive = await getDriveClient(teacherId);

  if (!drive) {
    return {
      success: false,
      error: 'Google Drive not connected. Please connect your Google Drive account.',
    };
  }

  try {
    // Get or create the Orbit Learn folder
    const folderId = options.folderId || await getOrCreateOrbitFolder(drive);

    // Convert data to stream
    const stream = new Readable();
    stream.push(typeof file.data === 'string' ? Buffer.from(file.data) : file.data);
    stream.push(null);

    // Upload file
    const response = await drive.files.create({
      requestBody: {
        name: file.name,
        mimeType: file.mimeType,
        parents: [folderId],
        description: options.description,
      },
      media: {
        mimeType: file.mimeType,
        body: stream,
      },
      fields: 'id, webViewLink',
    });

    return {
      success: true,
      fileId: response.data.id || undefined,
      webViewLink: response.data.webViewLink || undefined,
    };
  } catch (error: unknown) {
    console.error('Google Drive upload error:', error);

    // Check if it's an auth error
    if (error instanceof Error && error.message.includes('invalid_grant')) {
      // Token expired or revoked
      await disconnectGoogleDrive(teacherId);
      return {
        success: false,
        error: 'Google Drive authorization expired. Please reconnect your account.',
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload to Google Drive',
    };
  }
}

/**
 * List files in the Orbit Learn folder
 */
export async function listDriveFiles(
  teacherId: string,
  pageSize: number = 20,
  pageToken?: string
): Promise<{
  success: boolean;
  files?: Array<{
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
    createdTime: string;
  }>;
  nextPageToken?: string;
  error?: string;
}> {
  const drive = await getDriveClient(teacherId);

  if (!drive) {
    return {
      success: false,
      error: 'Google Drive not connected',
    };
  }

  try {
    const folderId = await getOrCreateOrbitFolder(drive);

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      pageSize,
      pageToken,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, createdTime)',
      orderBy: 'createdTime desc',
    });

    return {
      success: true,
      files: (response.data.files || []).map((file) => ({
        id: file.id!,
        name: file.name!,
        mimeType: file.mimeType!,
        webViewLink: file.webViewLink!,
        createdTime: file.createdTime!,
      })),
      nextPageToken: response.data.nextPageToken || undefined,
    };
  } catch (error: unknown) {
    console.error('Google Drive list error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list Drive files',
    };
  }
}

/**
 * Delete a file from Google Drive
 */
export async function deleteFromDrive(
  teacherId: string,
  fileId: string
): Promise<{ success: boolean; error?: string }> {
  const drive = await getDriveClient(teacherId);

  if (!drive) {
    return {
      success: false,
      error: 'Google Drive not connected',
    };
  }

  try {
    await drive.files.delete({ fileId });
    return { success: true };
  } catch (error: unknown) {
    console.error('Google Drive delete error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete file',
    };
  }
}

export default {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  saveTeacherDriveTokens,
  getTeacherDriveTokens,
  isGoogleDriveConnected,
  disconnectGoogleDrive,
  uploadToDrive,
  listDriveFiles,
  deleteFromDrive,
};
