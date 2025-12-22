/**
 * PowerPoint Processing Service
 *
 * For PPTX files: Uses node-pptx-parser for direct text extraction (more reliable)
 * For PPT files: Falls back to CloudConvert → PDF → Gemini pipeline
 */
import CloudConvert from 'cloudconvert';
// Use dynamic import to work around TypeScript typing issues with node-pptx-parser
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PptxParser = require('node-pptx-parser').default as new (filePath: string) => {
  extractText(): Promise<Array<{ id: string; text: string[] }>>;
};
import { genAI } from '../../config/gemini.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// MIME type constants for PowerPoint files
export const PPT_MIME_TYPES = [
  'application/vnd.ms-powerpoint',                                           // .ppt (legacy)
  'application/vnd.openxmlformats-officedocument.presentationml.presentation' // .pptx (modern)
] as const;

export type PPTMimeType = typeof PPT_MIME_TYPES[number];

export interface PPTProcessingResult {
  extractedText: string;
  suggestedTitle: string;
  summary: string;
  detectedSubject: string | null;
  detectedGradeLevel: string | null;
  keyTopics: string[];
  vocabulary: Array<{ term: string; definition: string }>;
  slideCount: number;
  originalFormat: 'ppt' | 'pptx';
  tokensUsed: number;
}

// Initialize CloudConvert client (for legacy PPT files)
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY || '');

/**
 * Extract text directly from a PPTX file using node-pptx-parser
 * This is much more reliable than CloudConvert → PDF → Gemini
 */
async function extractTextFromPPTX(pptBase64: string, filename: string): Promise<{ text: string; slideCount: number }> {
  // Clean base64 - remove data URL prefix if present
  let cleanBase64 = pptBase64;
  if (pptBase64.includes(',')) {
    cleanBase64 = pptBase64.split(',')[1];
  }

  // Write to temp file (node-pptx-parser requires a file path)
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `pptx-${Date.now()}-${Math.random().toString(36).slice(2)}.pptx`);

  try {
    // Write base64 to temp file
    const buffer = Buffer.from(cleanBase64, 'base64');
    fs.writeFileSync(tempFile, buffer);

    logger.info('Extracting text from PPTX using node-pptx-parser', { filename, tempFile });

    // Parse the PPTX file
    const parser = new PptxParser(tempFile);
    const slides = await parser.extractText();

    // Sort slides by their ID (rId2, rId3, etc. -> extract number)
    const sortedSlides = [...slides].sort((a, b) => {
      const numA = parseInt(a.id.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.id.replace(/\D/g, '')) || 0;
      return numA - numB;
    });

    // Build formatted text with slide markers
    let slideNumber = 1;
    const textParts: string[] = [];

    for (const slide of sortedSlides) {
      const slideText = slide.text.join('\n').trim();
      if (slideText) {
        // Try to extract a title from the first line
        const lines = slideText.split('\n');
        const title = lines[0]?.trim() || `Slide ${slideNumber}`;

        textParts.push(`--- SLIDE ${slideNumber}: ${title} ---`);
        textParts.push(slideText);
        textParts.push(''); // Empty line between slides
      }
      slideNumber++;
    }

    const extractedText = textParts.join('\n');

    logger.info('PPTX text extraction completed', {
      filename,
      slideCount: slides.length,
      textLength: extractedText.length,
    });

    return {
      text: extractedText,
      slideCount: slides.length,
    };
  } finally {
    // Clean up temp file
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Convert PPT/PPTX to PDF using CloudConvert (fallback for legacy PPT files)
 */
async function convertPPTtoPDF(
  pptBase64: string,
  mimeType: PPTMimeType,
  filename: string
): Promise<string> {
  logger.info('Converting PPT to PDF via CloudConvert', { filename, mimeType });

  let cleanBase64 = pptBase64;
  if (pptBase64.includes(',')) {
    cleanBase64 = pptBase64.split(',')[1];
  }

  const inputFormat = mimeType === 'application/vnd.ms-powerpoint' ? 'ppt' : 'pptx';

  try {
    const job = await cloudConvert.jobs.create({
      tasks: {
        'import-ppt': {
          operation: 'import/base64',
          file: cleanBase64,
          filename: filename || `presentation.${inputFormat}`,
        },
        'convert-to-pdf': {
          operation: 'convert',
          input: ['import-ppt'],
          output_format: 'pdf',
        },
        'export-pdf': {
          operation: 'export/url',
          input: ['convert-to-pdf'],
          inline: false,
          archive_multiple_files: false,
        },
      },
    });

    const completedJob = await cloudConvert.jobs.wait(job.id);
    const exportTask = completedJob.tasks?.find(
      (task) => task.operation === 'export/url' && task.status === 'finished'
    );

    if (!exportTask?.result?.files?.[0]?.url) {
      throw new Error('CloudConvert conversion failed - no output file');
    }

    const pdfUrl = exportTask.result.files[0].url;
    const response = await fetch(pdfUrl);

    if (!response.ok) {
      throw new Error(`Failed to download converted PDF: ${response.status}`);
    }

    const pdfBuffer = await response.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

    logger.info('PPT to PDF conversion successful', { filename, pdfSize: pdfBase64.length });
    return pdfBase64;
  } catch (error) {
    logger.error('CloudConvert PPT to PDF conversion failed', {
      filename,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error('Failed to convert PowerPoint to PDF. Please try again or use a PDF file.');
  }
}

/**
 * Analyze extracted text with Gemini to get metadata (vocabulary, topics, etc.)
 */
async function analyzeExtractedText(
  extractedText: string,
  slideCount: number
): Promise<{
  suggestedTitle: string;
  summary: string;
  detectedSubject: string | null;
  detectedGradeLevel: string | null;
  keyTopics: string[];
  vocabulary: Array<{ term: string; definition: string }>;
  tokensUsed: number;
}> {
  const model = genAI.getGenerativeModel({
    model: config.gemini.models.flash,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  });

  const prompt = `You are an expert educator analyzing educational content extracted from a PowerPoint presentation.

EXTRACTED CONTENT FROM ${slideCount} SLIDES:
${extractedText}

Analyze this content and provide:

1. **suggestedTitle**: A clear, descriptive title for this lesson
2. **summary**: A 2-3 sentence overview of what this lesson teaches
3. **detectedSubject**: One of: MATH, SCIENCE, ENGLISH, SOCIAL_STUDIES, ART, MUSIC, or OTHER
4. **detectedGradeLevel**: The appropriate grade level (K, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, or a range like "5-6")
5. **keyTopics**: 3-8 main topics/concepts covered in this lesson
6. **vocabulary**: Important terms with their definitions (extract 5-15 terms that are taught in this lesson)

Return JSON:
{
  "suggestedTitle": "Understanding Articles: a, an, the",
  "summary": "This lesson teaches students about definite and indefinite articles...",
  "detectedSubject": "ENGLISH",
  "detectedGradeLevel": "6",
  "keyTopics": ["indefinite articles", "definite articles", "a vs an", "article usage rules"],
  "vocabulary": [
    {"term": "article", "definition": "A word used before a noun to indicate whether the noun refers to something specific or general"},
    {"term": "indefinite article", "definition": "The articles 'a' and 'an' used for non-specific nouns"}
  ]
}`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const responseText = response.text();
    const tokensUsed = response.usageMetadata?.totalTokenCount || 1000;

    // Extract JSON from response
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    } else if (responseText.includes('{')) {
      const startIndex = responseText.indexOf('{');
      const endIndex = responseText.lastIndexOf('}');
      if (startIndex !== -1 && endIndex !== -1) {
        jsonText = responseText.slice(startIndex, endIndex + 1);
      }
    }

    const analysis = JSON.parse(jsonText);

    return {
      suggestedTitle: analysis.suggestedTitle || 'Untitled Presentation',
      summary: analysis.summary || '',
      detectedSubject: analysis.detectedSubject || null,
      detectedGradeLevel: analysis.detectedGradeLevel || null,
      keyTopics: analysis.keyTopics || [],
      vocabulary: analysis.vocabulary || [],
      tokensUsed,
    };
  } catch (error) {
    logger.error('Failed to analyze extracted text', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    // Return defaults if analysis fails - we still have the extracted text
    return {
      suggestedTitle: 'Untitled Presentation',
      summary: '',
      detectedSubject: null,
      detectedGradeLevel: null,
      keyTopics: [],
      vocabulary: [],
      tokensUsed: 0,
    };
  }
}

/**
 * Process a PPT/PPTX file and extract educational content
 *
 * For PPTX: Uses direct parsing with node-pptx-parser (most reliable)
 * For PPT: Falls back to CloudConvert → PDF → Gemini pipeline
 */
export async function analyzePPT(
  pptBase64: string,
  mimeType: PPTMimeType,
  filename: string
): Promise<PPTProcessingResult> {
  logger.info('Starting PPT analysis', {
    mimeType,
    filename,
    base64Length: pptBase64.length,
  });

  const originalFormat: 'ppt' | 'pptx' =
    mimeType === 'application/vnd.ms-powerpoint' ? 'ppt' : 'pptx';

  // For PPTX files, use direct parsing (much more reliable)
  if (originalFormat === 'pptx') {
    try {
      // Step 1: Extract text directly from PPTX
      const { text: extractedText, slideCount } = await extractTextFromPPTX(pptBase64, filename);

      // Step 2: Analyze extracted text with Gemini for metadata
      const analysis = await analyzeExtractedText(extractedText, slideCount);

      logger.info('PPTX analysis completed (direct parsing)', {
        filename,
        slideCount,
        textLength: extractedText.length,
        subject: analysis.detectedSubject,
        tokensUsed: analysis.tokensUsed,
      });

      return {
        extractedText,
        suggestedTitle: analysis.suggestedTitle,
        summary: analysis.summary,
        detectedSubject: analysis.detectedSubject,
        detectedGradeLevel: analysis.detectedGradeLevel,
        keyTopics: analysis.keyTopics,
        vocabulary: analysis.vocabulary,
        slideCount,
        originalFormat,
        tokensUsed: analysis.tokensUsed,
      };
    } catch (error) {
      logger.warn('Direct PPTX parsing failed, falling back to CloudConvert', {
        filename,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Fall through to CloudConvert method
    }
  }

  // For PPT files or if PPTX parsing fails, use CloudConvert → PDF → Gemini
  const pdfBase64 = await convertPPTtoPDF(pptBase64, mimeType, filename);

  const model = genAI.getGenerativeModel({
    model: config.gemini.models.flash,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
    },
  });

  const prompt = `You are an expert educator extracting COMPLETE content from a PowerPoint presentation for a learning platform.

CRITICAL INSTRUCTION: You must extract EVERY piece of text from EVERY slide. Be EXHAUSTIVE and THOROUGH. Do NOT summarize or abbreviate - we need the FULL content.

Go through the presentation slide by slide and extract:

1. **EXTRACTED TEXT** - This is the most important part. For EACH slide:
   - Start with "--- SLIDE X: [Title] ---"
   - Include ALL text: titles, subtitles, bullet points, sub-bullets
   - Include ALL examples, definitions, rules, formulas
   - Include ALL activity instructions, questions, practice problems
   - Include text from tables, charts, diagrams
   - Preserve the structure (use bullet points, numbered lists as they appear)
   - Do NOT skip any text content, no matter how small

2. **METADATA**:
   - suggestedTitle: A clear title for this lesson
   - summary: 2-3 sentence overview
   - detectedSubject: MATH, SCIENCE, ENGLISH, SOCIAL_STUDIES, ART, MUSIC, or OTHER
   - detectedGradeLevel: K through 12 or a range like "5-6"
   - keyTopics: 3-8 main topics covered
   - vocabulary: Important terms with definitions (extract from the content)
   - slideCount: Total number of slides

Return JSON:
{
  "extractedText": "--- SLIDE 1: [Title] ---\\n[Complete slide 1 content]\\n\\n--- SLIDE 2: [Title] ---\\n[Complete slide 2 content]\\n\\n... continue for ALL slides",
  "suggestedTitle": "Title for the lesson",
  "summary": "Brief summary...",
  "detectedSubject": "ENGLISH",
  "detectedGradeLevel": "6",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "vocabulary": [
    {"term": "word1", "definition": "definition1"},
    {"term": "word2", "definition": "definition2"}
  ],
  "slideCount": 18
}

Remember: Extract EVERYTHING. The extracted text should be comprehensive enough that someone could recreate the lesson from it.`;

  try {
    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64,
        },
      },
    ]);

    const response = result.response;
    const responseText = response.text();
    const tokensUsed = response.usageMetadata?.totalTokenCount || 4000;

    let jsonText = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    } else if (responseText.includes('{')) {
      const startIndex = responseText.indexOf('{');
      const endIndex = responseText.lastIndexOf('}');
      if (startIndex !== -1 && endIndex !== -1) {
        jsonText = responseText.slice(startIndex, endIndex + 1);
      }
    }

    const analysis = JSON.parse(jsonText);

    logger.info('PPT analysis completed (CloudConvert path)', {
      filename,
      originalFormat,
      slideCount: analysis.slideCount || 1,
      textLength: analysis.extractedText?.length || 0,
      subject: analysis.detectedSubject,
      tokensUsed,
    });

    return {
      extractedText: analysis.extractedText || '',
      suggestedTitle: analysis.suggestedTitle || 'Untitled Presentation',
      summary: analysis.summary || '',
      detectedSubject: analysis.detectedSubject || null,
      detectedGradeLevel: analysis.detectedGradeLevel || null,
      keyTopics: analysis.keyTopics || [],
      vocabulary: analysis.vocabulary || [],
      slideCount: analysis.slideCount || 1,
      originalFormat,
      tokensUsed,
    };
  } catch (error) {
    logger.error('PPT analysis failed', {
      filename,
      mimeType,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error('Failed to analyze PowerPoint. The file may be corrupted or in an unsupported format.');
  }
}

/**
 * Check if a MIME type is a PowerPoint format
 */
export function isPPTMimeType(mimeType: string): mimeType is PPTMimeType {
  return PPT_MIME_TYPES.includes(mimeType as PPTMimeType);
}

/**
 * Get file extension from PPT MIME type
 */
export function getExtensionFromMimeType(mimeType: PPTMimeType): string {
  return mimeType === 'application/vnd.ms-powerpoint' ? 'ppt' : 'pptx';
}
