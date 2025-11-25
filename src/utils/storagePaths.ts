/**
 * Generate consistent storage paths for the family/child hierarchy
 * Critical for COPPA compliance - all child data under parent-owned family
 */

export interface StoragePathParams {
  familyId: string;
  childId: string;
  lessonId?: string;
  contentType: 'lesson' | 'profile' | 'ai-image' | 'ai-video' | 'ai-audio';
  filename: string;
}

export function generateStoragePath(params: StoragePathParams): string {
  const { familyId, childId, lessonId, contentType, filename } = params;

  // Sanitize inputs to prevent path traversal
  const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9-_]/g, '');
  const safeFamilyId = sanitize(familyId);
  const safeChildId = sanitize(childId);
  const safeFilename = sanitize(filename.replace(/\.[^.]+$/, '')); // Remove extension
  const extension = filename.split('.').pop()?.toLowerCase() || '';

  switch (contentType) {
    case 'lesson':
      if (!lessonId) throw new Error('lessonId required for lesson content');
      return `families/${safeFamilyId}/${safeChildId}/lessons/${sanitize(lessonId)}/${safeFilename}.${extension}`;

    case 'profile':
      return `families/${safeFamilyId}/${safeChildId}/profile/${safeFilename}.${extension}`;

    case 'ai-image':
      return `images/${safeFamilyId}/${safeChildId}/${safeFilename}.${extension}`;

    case 'ai-video':
      return `videos/${safeFamilyId}/${safeChildId}/${safeFilename}.${extension}`;

    case 'ai-audio':
      return `audio/${safeFamilyId}/${safeChildId}/${safeFilename}.${extension}`;

    default:
      throw new Error(`Unknown content type: ${contentType}`);
  }
}

/**
 * Parse a storage path back to components (for deletion/listing)
 */
export function parseStoragePath(path: string): Partial<StoragePathParams> {
  const parts = path.split('/');

  if (parts[0] === 'families' && parts.length >= 4) {
    return {
      familyId: parts[1],
      childId: parts[2],
      contentType: parts[3] === 'lessons' ? 'lesson' : 'profile',
      lessonId: parts[3] === 'lessons' ? parts[4] : undefined,
      filename: parts[parts.length - 1],
    };
  }

  // AI content paths
  if (['images', 'videos', 'audio'].includes(parts[0])) {
    return {
      familyId: parts[1],
      childId: parts[2],
      contentType: `ai-${parts[0].slice(0, -1)}` as StoragePathParams['contentType'],
      filename: parts[parts.length - 1],
    };
  }

  return { filename: parts[parts.length - 1] };
}
