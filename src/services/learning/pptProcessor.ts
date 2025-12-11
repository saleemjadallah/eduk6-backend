/**
 * PowerPoint Processing Service
 * Uses Gemini's native document processing to extract text from PPT/PPTX files
 */
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

/**
 * Process a PPT/PPTX file and extract educational content using Gemini
 * @param pptBase64 - Base64-encoded PPT/PPTX file
 * @param mimeType - MIME type of the file
 * @param filename - Original filename (for format detection)
 */
export async function analyzePPT(
  pptBase64: string,
  mimeType: PPTMimeType,
  filename: string
): Promise<PPTProcessingResult> {
  logger.info('Starting PPT analysis with Gemini', {
    mimeType,
    filename,
    base64Length: pptBase64.length,
  });

  // Clean base64 - remove data URL prefix if present
  let cleanBase64 = pptBase64;
  if (pptBase64.includes(',')) {
    cleanBase64 = pptBase64.split(',')[1];
  }

  // Determine original format from MIME type
  const originalFormat: 'ppt' | 'pptx' =
    mimeType === 'application/vnd.ms-powerpoint' ? 'ppt' : 'pptx';

  // Use Gemini Flash for PPT analysis
  const model = genAI.getGenerativeModel({
    model: config.gemini.models.flash,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8000,
      responseMimeType: 'application/json',
    },
  });

  const prompt = `You are an expert educator analyzing a PowerPoint presentation to extract educational content.

Analyze this PowerPoint file and extract:
1. ALL text content from every slide in the presentation
2. A suggested title for teaching this content
3. A brief summary (2-3 sentences)
4. The subject area (MATH, SCIENCE, ENGLISH, SOCIAL_STUDIES, ART, MUSIC, or OTHER)
5. The appropriate grade level (K, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, or a range like "3-5")
6. Key topics covered (3-8 topics)
7. Important vocabulary terms with definitions (5-15 terms)
8. The number of slides in the presentation

Return JSON with this exact structure:
{
  "extractedText": "Full text content from all slides, organized by slide...",
  "suggestedTitle": "Title for the lesson",
  "summary": "Brief summary of what this presentation covers...",
  "detectedSubject": "SCIENCE",
  "detectedGradeLevel": "5",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "vocabulary": [
    {"term": "word1", "definition": "definition1"},
    {"term": "word2", "definition": "definition2"}
  ],
  "slideCount": 10
}

If the PowerPoint is unreadable or contains no educational content, still return the JSON structure with empty/null values where appropriate.`;

  try {
    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64,
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
