/**
 * PPTX Image Extractor
 *
 * Extracts images from PPTX files (which are ZIP archives) and uploads them to R2.
 * Maps images to their corresponding slides using the PPTX relationship files.
 *
 * PPTX Structure:
 * - ppt/media/          Contains all images (image1.png, image2.jpeg, etc.)
 * - ppt/slides/         Contains slide XML files (slide1.xml, slide2.xml, etc.)
 * - ppt/slides/_rels/   Contains relationship files mapping images to slides
 */

import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';
import { uploadFile } from '../storage/storageService.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ExtractedImage {
  /** Original filename in PPTX (e.g., "image1.png") */
  originalName: string;
  /** MIME type of the image */
  mimeType: string;
  /** Image data as Buffer */
  data: Buffer;
  /** Size in bytes */
  size: number;
}

export interface SlideImage {
  /** Slide number (1-based) */
  slideNumber: number;
  /** CDN URL for the image */
  url: string;
  /** Original filename */
  originalName: string;
  /** Width if available from PPTX */
  width?: number;
  /** Height if available from PPTX */
  height?: number;
}

export interface ImageExtractionResult {
  /** All images mapped to their slides */
  slideImages: SlideImage[];
  /** Total number of images extracted */
  totalImages: number;
  /** Images that couldn't be mapped to a specific slide */
  unmappedImages: string[];
}

// ============================================================================
// MIME TYPE MAPPING
// ============================================================================

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.emf': 'image/emf',
  '.wmf': 'image/wmf',
};

function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return IMAGE_EXTENSIONS[ext] || 'application/octet-stream';
}

function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return ext in IMAGE_EXTENSIONS;
}

// ============================================================================
// RELATIONSHIP PARSING
// ============================================================================

interface SlideRelationship {
  slideNumber: number;
  imageRefs: string[]; // e.g., ["../media/image1.png", "../media/image2.jpeg"]
}

/**
 * Parse slide relationship files to map images to slides
 */
function parseSlideRelationships(zip: AdmZip): Map<string, number[]> {
  const imageToSlides = new Map<string, number[]>();

  // Get all slide relationship files
  const entries = zip.getEntries();
  const relFiles = entries.filter(e =>
    e.entryName.startsWith('ppt/slides/_rels/slide') &&
    e.entryName.endsWith('.xml.rels')
  );

  for (const relFile of relFiles) {
    // Extract slide number from filename (e.g., "slide1.xml.rels" -> 1)
    const match = relFile.entryName.match(/slide(\d+)\.xml\.rels$/);
    if (!match) continue;

    const slideNumber = parseInt(match[1], 10);
    const content = relFile.getData().toString('utf-8');

    // Find all image references in the relationship file
    // Format: <Relationship ... Target="../media/image1.png" Type="...image"/>
    const imageRefPattern = /Target="\.\.\/media\/([^"]+)"/g;
    let imageMatch;

    while ((imageMatch = imageRefPattern.exec(content)) !== null) {
      const imageName = imageMatch[1];
      const slides = imageToSlides.get(imageName) || [];
      if (!slides.includes(slideNumber)) {
        slides.push(slideNumber);
      }
      imageToSlides.set(imageName, slides);
    }
  }

  return imageToSlides;
}

// ============================================================================
// IMAGE EXTRACTION
// ============================================================================

/**
 * Extract all images from a PPTX file
 */
function extractImagesFromPPTX(pptxBuffer: Buffer): ExtractedImage[] {
  const zip = new AdmZip(pptxBuffer);
  const images: ExtractedImage[] = [];

  // Get all entries in the media folder
  const entries = zip.getEntries();
  const mediaFiles = entries.filter(e =>
    e.entryName.startsWith('ppt/media/') && isImageFile(e.entryName)
  );

  for (const entry of mediaFiles) {
    const filename = entry.entryName.split('/').pop() || '';
    const data = entry.getData();

    images.push({
      originalName: filename,
      mimeType: getMimeType(filename),
      data,
      size: data.length,
    });
  }

  return images;
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract images from a PPTX file and upload them to R2
 *
 * @param pptxBase64 - Base64 encoded PPTX file (with or without data URL prefix)
 * @param lessonId - Lesson ID for organizing storage
 * @param familyId - Family ID for storage path
 * @param childId - Child ID for storage path
 * @returns Extraction result with CDN URLs for all images
 */
export async function extractAndUploadPPTXImages(
  pptxBase64: string,
  lessonId: string,
  familyId: string,
  childId: string
): Promise<ImageExtractionResult> {
  logger.info('Starting PPTX image extraction', { lessonId, familyId, childId });

  // Clean base64 - remove data URL prefix if present
  let cleanBase64 = pptxBase64;
  if (pptxBase64.includes(',')) {
    cleanBase64 = pptxBase64.split(',')[1];
  }

  // Convert to Buffer
  const pptxBuffer = Buffer.from(cleanBase64, 'base64');

  // Create zip instance for relationship parsing
  const zip = new AdmZip(pptxBuffer);

  // Parse relationships to map images to slides
  const imageToSlides = parseSlideRelationships(zip);

  // Extract all images
  const images = extractImagesFromPPTX(pptxBuffer);

  if (images.length === 0) {
    logger.info('No images found in PPTX', { lessonId });
    return {
      slideImages: [],
      totalImages: 0,
      unmappedImages: [],
    };
  }

  logger.info('Found images in PPTX', {
    lessonId,
    imageCount: images.length,
    imageNames: images.map(i => i.originalName),
  });

  // Upload images to R2 and build result
  const slideImages: SlideImage[] = [];
  const unmappedImages: string[] = [];
  const uploadId = uuidv4().slice(0, 8); // Short unique ID for this upload batch

  for (const image of images) {
    try {
      // Generate storage path
      const storagePath = `families/${familyId}/${childId}/lessons/${lessonId}/images/${uploadId}-${image.originalName}`;

      // Upload to R2
      const stored = await uploadFile(
        'uploads',
        storagePath,
        image.data,
        image.mimeType,
        {
          'lesson-id': lessonId,
          'original-name': image.originalName,
          'source': 'pptx-extraction',
        }
      );

      // Get slides this image belongs to
      const slides = imageToSlides.get(image.originalName);

      if (slides && slides.length > 0) {
        // Add entry for each slide this image appears on
        for (const slideNumber of slides) {
          slideImages.push({
            slideNumber,
            url: stored.publicUrl,
            originalName: image.originalName,
          });
        }
      } else {
        // Image not mapped to any slide (might be a background or template image)
        unmappedImages.push(image.originalName);
        // Still add it with slide 0 so it's available
        slideImages.push({
          slideNumber: 0,
          url: stored.publicUrl,
          originalName: image.originalName,
        });
      }

      logger.debug('Uploaded PPTX image', {
        originalName: image.originalName,
        storagePath,
        slides,
      });
    } catch (error) {
      logger.error('Failed to upload PPTX image', {
        originalName: image.originalName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Sort by slide number
  slideImages.sort((a, b) => a.slideNumber - b.slideNumber);

  logger.info('PPTX image extraction completed', {
    lessonId,
    totalImages: images.length,
    mappedImages: slideImages.filter(i => i.slideNumber > 0).length,
    unmappedImages: unmappedImages.length,
  });

  return {
    slideImages,
    totalImages: images.length,
    unmappedImages,
  };
}

/**
 * Generate HTML img tags for images belonging to a specific slide
 */
export function generateSlideImageHtml(
  slideImages: SlideImage[],
  slideNumber: number
): string {
  const images = slideImages.filter(img => img.slideNumber === slideNumber);

  if (images.length === 0) {
    return '';
  }

  return images
    .map(img => {
      const alt = `Slide ${slideNumber} - ${img.originalName}`;
      return `<div class="slide-image">
  <img src="${img.url}" alt="${alt}" loading="lazy" class="lesson-image" />
</div>`;
    })
    .join('\n');
}

/**
 * Insert images into formatted HTML content at appropriate slide positions
 */
export function insertImagesIntoContent(
  formattedHtml: string,
  slideImages: SlideImage[]
): string {
  if (slideImages.length === 0) {
    return formattedHtml;
  }

  let result = formattedHtml;

  // Find all slide headers and insert images after them
  // Slide headers look like: <div class="slide-header">...<h2 class="slide-title">...</h2></div>
  const slideHeaderPattern = /<div class="slide-header">\s*<span class="slide-number">Slide (\d+)<\/span>/g;

  // Collect all matches first to avoid issues with modifying string while iterating
  const matches: { fullMatch: string; slideNum: number; index: number }[] = [];
  let match;

  while ((match = slideHeaderPattern.exec(formattedHtml)) !== null) {
    matches.push({
      fullMatch: match[0],
      slideNum: parseInt(match[1], 10),
      index: match.index,
    });
  }

  // Process in reverse order to maintain correct indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const { slideNum, index } = matches[i];
    const imageHtml = generateSlideImageHtml(slideImages, slideNum);

    if (imageHtml) {
      // Find the end of the slide-header div
      const headerEndIndex = result.indexOf('</div>', index);
      if (headerEndIndex !== -1) {
        const insertIndex = headerEndIndex + 6; // After </div>
        result = result.slice(0, insertIndex) + '\n' + imageHtml + result.slice(insertIndex);
      }
    }
  }

  return result;
}
