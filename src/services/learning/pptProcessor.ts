/**
 * PowerPoint Processing Service
 * Converts PPT/PPTX to PDF using CloudConvert, then uses Gemini for analysis
 *
 * Note: Gemini only supports PDF for document understanding, not PPT/PPTX directly.
 * See: https://ai.google.dev/gemini-api/docs/document-processing
 */
import CloudConvert from 'cloudconvert';
import { genAI } from '../../config/gemini.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

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

// Initialize CloudConvert client
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY || '');

/**
 * Convert PPT/PPTX to PDF using CloudConvert
 * @param pptBase64 - Base64-encoded PPT/PPTX file
 * @param mimeType - MIME type of the file
 * @param filename - Original filename
 * @returns Base64-encoded PDF
 */
async function convertPPTtoPDF(
  pptBase64: string,
  mimeType: PPTMimeType,
  filename: string
): Promise<string> {
  logger.info('Converting PPT to PDF via CloudConvert', { filename, mimeType });

  // Clean base64 - remove data URL prefix if present
  let cleanBase64 = pptBase64;
  if (pptBase64.includes(',')) {
    cleanBase64 = pptBase64.split(',')[1];
  }

  // Get the input format
  const inputFormat = mimeType === 'application/vnd.ms-powerpoint' ? 'ppt' : 'pptx';

  try {
    // Create a job with import, convert, and export tasks
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

    // Wait for the job to complete
    const completedJob = await cloudConvert.jobs.wait(job.id);

    // Get the export task
    const exportTask = completedJob.tasks?.find(
      (task) => task.operation === 'export/url' && task.status === 'finished'
    );

    if (!exportTask?.result?.files?.[0]?.url) {
      throw new Error('CloudConvert conversion failed - no output file');
    }

    // Download the PDF
    const pdfUrl = exportTask.result.files[0].url;
    const response = await fetch(pdfUrl);

    if (!response.ok) {
      throw new Error(`Failed to download converted PDF: ${response.status}`);
    }

    const pdfBuffer = await response.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

    logger.info('PPT to PDF conversion successful', {
      filename,
      pdfSize: pdfBase64.length
    });

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
 * Process a PPT/PPTX file and extract educational content using Gemini
 * First converts to PDF, then sends to Gemini for analysis
 *
 * @param pptBase64 - Base64-encoded PPT/PPTX file
 * @param mimeType - MIME type of the file
 * @param filename - Original filename (for format detection)
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

  // Determine original format from MIME type
  const originalFormat: 'ppt' | 'pptx' =
    mimeType === 'application/vnd.ms-powerpoint' ? 'ppt' : 'pptx';

  // Step 1: Convert PPT to PDF
  const pdfBase64 = await convertPPTtoPDF(pptBase64, mimeType, filename);

  // Step 2: Use Gemini Flash for PDF analysis
  // Set maxOutputTokens high (65536 is the max for Flash) to prevent truncation
  // for large presentations with many slides - the model only generates what it needs
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

IMAGE HANDLING:
- DO extract text/data from charts, graphs, tables, diagrams
- DO describe educational visuals briefly
- SKIP decorative images, clipart, photos

EXAMPLE of thorough extraction for one slide:
--- SLIDE 6: a/an (Indefinite Article) ---
Use:
• For indefinite (nonspecific) nouns
  Example: Builders created a network of pipes and tunnels.
• When making a general statement about a singular noun
  Example: A network is essential for water distribution.
• 'a' with words starting with consonants
  Example: A builder designed the layout.
• 'an' with words starting with vowels or vowel sounds
  Example: An engineer inspected the site.

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
          mimeType: 'application/pdf',  // Now sending as PDF
          data: pdfBase64,
        },
      },
    ]);

    const response = result.response;
    const responseText = response.text();
    const tokensUsed = response.usageMetadata?.totalTokenCount || 4000;

    // Extract JSON from response (handle potential markdown wrapping)
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    } else if (responseText.includes('{')) {
      // Try to extract JSON object directly
      const startIndex = responseText.indexOf('{');
      const endIndex = responseText.lastIndexOf('}');
      if (startIndex !== -1 && endIndex !== -1) {
        jsonText = responseText.slice(startIndex, endIndex + 1);
      }
    }

    const analysis = JSON.parse(jsonText);

    logger.info('PPT analysis completed', {
      filename,
      originalFormat,
      slideCount: analysis.slideCount || 1,
      textLength: analysis.extractedText?.length || 0,
      subject: analysis.detectedSubject,
      gradeLevel: analysis.detectedGradeLevel,
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
