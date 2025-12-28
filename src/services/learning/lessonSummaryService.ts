// Lesson Audio Summary Service - Ollie's Voice for Kids
// Generates kid-friendly audio summaries using Gemini + Google Cloud TTS
import { genAI, CHILD_SAFETY_SETTINGS } from '../../config/gemini.js';
import { config } from '../../config/index.js';
import { prisma } from '../../config/database.js';
import { LessonAudioStatus, AgeGroup } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { uploadFile } from '../storage/storageService.js';
import { v4 as uuidv4 } from 'uuid';
import textToSpeech from '@google-cloud/text-to-speech';

// ============================================
// CONSTANTS
// ============================================

// Ollie's voice - Professional Male US English
const OLLIE_VOICE_ID = 'en-US-Studio-M';
const OLLIE_LANGUAGE_CODE = 'en-US';

// Speaking rate adjustments by age
const SPEAKING_RATES: Record<AgeGroup, number> = {
  YOUNG: 0.9,  // Slightly slower for younger kids (4-7)
  OLDER: 1.0,  // Normal speed for older kids (8-12)
};

// Word limits for summaries by age (longer for comprehensive coverage)
const SUMMARY_WORD_LIMITS: Record<AgeGroup, number> = {
  YOUNG: 200,  // ~80 seconds at 150 wpm
  OLDER: 350,  // ~140 seconds at 150 wpm (about 2-2.5 minutes)
};

// ============================================
// TYPES
// ============================================

export interface GenerateSummaryAudioInput {
  lessonId: string;
  childId: string;
  ageGroup: AgeGroup;
}

export interface GeneratedSummaryAudio {
  audioUrl: string;
  duration: number;
}

// ============================================
// SERVICE
// ============================================

export const lessonSummaryService = {
  /**
   * Generate a kid-friendly script for Ollie to read
   * Uses Gemini Flash for fast, high-quality script generation
   */
  async generateOllieScript(
    lesson: {
      title: string;
      summary: string | null;
      keyConcepts: string[];
      extractedText: string | null;
      formattedContent: string | null;
      vocabulary: any;
    },
    ageGroup: AgeGroup
  ): Promise<string> {
    const wordLimit = SUMMARY_WORD_LIMITS[ageGroup];
    const ageDescription = ageGroup === 'YOUNG' ? '4-7 year olds' : '8-12 year olds';

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      safetySettings: CHILD_SAFETY_SETTINGS,
    });

    // Build comprehensive content from all available sources
    let fullContent = '';

    // Debug: Log what content we have
    logger.info('Lesson content available for script', {
      title: lesson.title,
      hasExtractedText: !!lesson.extractedText,
      extractedTextLength: lesson.extractedText?.length || 0,
      hasFormattedContent: !!lesson.formattedContent,
      formattedContentLength: lesson.formattedContent?.length || 0,
      hasSummary: !!lesson.summary,
      summaryLength: lesson.summary?.length || 0,
      keyConceptsCount: lesson.keyConcepts?.length || 0,
    });

    // Use extracted text (the raw lesson content) as primary source
    if (lesson.extractedText) {
      // Strip HTML if present and limit to reasonable length
      const cleanText = lesson.extractedText
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 8000); // Limit to ~8000 chars for API
      fullContent = cleanText;
    } else if (lesson.formattedContent) {
      // Fallback to formatted content, strip HTML
      const cleanText = lesson.formattedContent
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 8000);
      fullContent = cleanText;
    }

    // Add key concepts
    if (lesson.keyConcepts && lesson.keyConcepts.length > 0) {
      fullContent += '\n\nKey Concepts: ' + lesson.keyConcepts.join(', ');
    }

    // Add vocabulary if available
    if (lesson.vocabulary && Array.isArray(lesson.vocabulary)) {
      const vocabTerms = lesson.vocabulary.slice(0, 5).map((v: any) => v.term || v).join(', ');
      if (vocabTerms) {
        fullContent += '\n\nImportant vocabulary: ' + vocabTerms;
      }
    }

    // Fallback to summary if no content available
    if (!fullContent.trim() && lesson.summary) {
      fullContent = lesson.summary;
    }

    // Debug: Log final content length
    logger.info('Final content for script generation', {
      title: lesson.title,
      finalContentLength: fullContent.length,
      contentPreview: fullContent.substring(0, 200),
    });

    const prompt = `You are Ollie, a friendly and enthusiastic learning buddy for kids!
You're about to read a comprehensive summary of a lesson to help a child understand and remember what they learned.

Lesson Title: ${lesson.title}

Full Lesson Content:
${fullContent}

${lesson.summary ? `\nLesson Summary: ${lesson.summary}` : ''}

Create an engaging audio script (${wordLimit} words) for ${ageDescription} that covers the MAIN POINTS of this lesson.

Guidelines:
- Start with a cheerful greeting like "Hey there, learner!" or "Hi friend!"
- Be encouraging and positive throughout
- Use simple, age-appropriate language
- Cover the 3-5 most important concepts or facts from the lesson
- Explain things clearly as if teaching a child
- Include any important vocabulary words and briefly explain them
- End with encouragement like "Great job learning today!" or "You're doing amazing!"
${ageGroup === 'YOUNG' ? '- Use shorter sentences and simpler words for young learners' : '- You can use grade-appropriate vocabulary for older kids'}
- Do NOT include any stage directions, brackets, or emojis
- Write ONLY what Ollie will say out loud
- Make it feel like a friendly teacher summarizing what you learned

Script:`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2000, // Increased for longer scripts
      },
    });

    const script = result.response.text().trim();

    logger.info('Generated Ollie script', {
      lessonId: lesson.title,
      wordCount: script.split(/\s+/).length,
      ageGroup,
      scriptPreview: script.substring(0, 300), // Log the actual script
    });

    return script;
  },

  /**
   * Convert script to audio using Google Cloud TTS with Ollie's voice
   */
  async generateAudio(
    script: string,
    ageGroup: AgeGroup
  ): Promise<{ audioBuffer: Buffer; duration: number }> {
    const ttsClient = new textToSpeech.TextToSpeechClient();
    const speakingRate = SPEAKING_RATES[ageGroup];

    const [response] = await ttsClient.synthesizeSpeech({
      input: { text: script },
      voice: {
        languageCode: OLLIE_LANGUAGE_CODE,
        name: OLLIE_VOICE_ID,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate,
        pitch: ageGroup === 'YOUNG' ? 1 : 0, // Slightly higher pitch for younger kids
        effectsProfileId: ['headphone-class-device'],
      },
    });

    if (!response.audioContent) {
      throw new Error('No audio content generated from TTS');
    }

    // Calculate duration (150 words per minute at 1.0 speed)
    const wordCount = script.split(/\s+/).length;
    const durationSeconds = Math.round((wordCount / 150) * 60 / speakingRate);

    return {
      audioBuffer: Buffer.from(response.audioContent as Uint8Array),
      duration: durationSeconds,
    };
  },

  /**
   * Generate and save audio summary for a lesson
   * Main entry point for generating Ollie's voice summary
   */
  async generateLessonSummary(
    input: GenerateSummaryAudioInput
  ): Promise<GeneratedSummaryAudio> {
    const { lessonId, childId, ageGroup } = input;

    logger.info('Starting audio summary generation', { lessonId, childId, ageGroup });

    // Get the lesson with full content
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        childId: true,
        title: true,
        summary: true,
        keyConcepts: true,
        extractedText: true,
        formattedContent: true,
        vocabulary: true,
        audioSummaryStatus: true,
        child: {
          select: { parentId: true }
        }
      },
    });

    if (!lesson) {
      throw new Error('Lesson not found');
    }

    if (lesson.childId !== childId) {
      throw new Error('Access denied');
    }

    // Check if already generating
    if (lesson.audioSummaryStatus === 'GENERATING') {
      throw new Error('Audio summary is already being generated');
    }

    // Update status to GENERATING
    await prisma.lesson.update({
      where: { id: lessonId },
      data: { audioSummaryStatus: 'GENERATING' },
    });

    try {
      // Generate the script from full lesson content
      const script = await this.generateOllieScript(
        {
          title: lesson.title,
          summary: lesson.summary,
          keyConcepts: lesson.keyConcepts,
          extractedText: lesson.extractedText,
          formattedContent: lesson.formattedContent,
          vocabulary: lesson.vocabulary,
        },
        ageGroup
      );

      // Generate audio from script
      const { audioBuffer, duration } = await this.generateAudio(script, ageGroup);

      // Upload to R2
      const filename = `lesson-summary-${uuidv4()}.mp3`;
      const storagePath = `audio/${lesson.child.parentId}/${childId}/summaries/${filename}`;

      const uploadResult = await uploadFile(
        'aiContent',
        storagePath,
        audioBuffer,
        'audio/mpeg',
        {
          lessonId,
          childId,
          duration: duration.toString(),
          voiceId: OLLIE_VOICE_ID,
        }
      );

      // Update lesson with audio info
      await prisma.lesson.update({
        where: { id: lessonId },
        data: {
          audioSummaryUrl: uploadResult.publicUrl,
          audioSummaryDuration: duration,
          audioSummaryStatus: 'READY',
        },
      });

      logger.info('Audio summary generation completed', {
        lessonId,
        audioUrl: uploadResult.publicUrl,
        duration,
      });

      return {
        audioUrl: uploadResult.publicUrl,
        duration,
      };
    } catch (error) {
      // Update status to FAILED
      await prisma.lesson.update({
        where: { id: lessonId },
        data: { audioSummaryStatus: 'FAILED' },
      });

      logger.error('Audio summary generation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        lessonId,
      });

      throw error;
    }
  },

  /**
   * Get audio summary status for a lesson
   */
  async getAudioSummaryStatus(lessonId: string, childId: string) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        childId: true,
        audioSummaryUrl: true,
        audioSummaryDuration: true,
        audioSummaryStatus: true,
      },
    });

    if (!lesson) {
      throw new Error('Lesson not found');
    }

    if (lesson.childId !== childId) {
      throw new Error('Access denied');
    }

    return {
      status: lesson.audioSummaryStatus,
      audioUrl: lesson.audioSummaryUrl,
      duration: lesson.audioSummaryDuration,
    };
  },

  /**
   * Retry generating audio summary for a lesson that failed
   */
  async retryAudioSummary(
    lessonId: string,
    childId: string,
    ageGroup: AgeGroup
  ): Promise<GeneratedSummaryAudio> {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        childId: true,
        audioSummaryStatus: true,
      },
    });

    if (!lesson) {
      throw new Error('Lesson not found');
    }

    if (lesson.childId !== childId) {
      throw new Error('Access denied');
    }

    if (lesson.audioSummaryStatus !== 'FAILED' && lesson.audioSummaryStatus !== 'NONE') {
      throw new Error('Can only retry failed or new summaries');
    }

    return this.generateLessonSummary({ lessonId, childId, ageGroup });
  },
};
