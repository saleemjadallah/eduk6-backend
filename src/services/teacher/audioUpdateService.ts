// Teacher Audio Update Service - NotebookLM-style podcast class updates
// Generates podcast-style audio summaries for parents using Gemini 3 Flash + Google TTS
import { genAI } from '../../config/gemini.js';
import { config } from '../../config/index.js';
import { prisma } from '../../config/database.js';
import { AudioStatus, TokenOperation, TeacherAudioUpdate } from '@prisma/client';
import { quotaService } from './quotaService.js';
import { logger } from '../../utils/logger.js';
import { uploadFile } from '../storage/storageService.js';
import { v4 as uuidv4 } from 'uuid';
import { getTTSClient } from '../../config/tts.js';

// ============================================
// TYPES
// ============================================

export interface GenerateAudioScriptInput {
  lessonIds: string[];           // IDs of TeacherContent to summarize
  customNotes?: string;          // Teacher's custom notes to include
  weekLabel?: string;            // e.g., "Week of Dec 23"
  focusAreas?: string[];         // Topics to emphasize
  language?: string;             // Language code (en, ar, es, fr, etc.)
  duration?: 'short' | 'medium' | 'long'; // 2-3 min, 4-5 min, 6-8 min
}

export interface GeneratedScript {
  title: string;
  script: string;                // Full podcast script with host dialogue
  estimatedDuration: number;     // Estimated duration in seconds
  tokensUsed: number;
}

export interface AudioGenerationInput {
  script: string;
  voiceId?: string;              // Google TTS voice ID
  language?: string;
  speakingRate?: number;         // 0.5 - 2.0
}

export interface GeneratedAudio {
  audioUrl: string;
  duration: number;              // Actual duration in seconds
}

export interface CreateAudioUpdateInput extends GenerateAudioScriptInput {
  title?: string;                // Optional custom title
}

export interface UpdateAudioUpdateInput {
  title?: string;
  script?: string;
  customNotes?: string;
  status?: AudioStatus;
}

// Voice options for different languages
export const VOICE_OPTIONS: Record<string, { voiceId: string; name: string; gender: string }[]> = {
  en: [
    { voiceId: 'en-US-Studio-O', name: 'Professional Female (US)', gender: 'female' },
    { voiceId: 'en-US-Studio-M', name: 'Professional Male (US)', gender: 'male' },
    { voiceId: 'en-GB-Studio-C', name: 'British Female', gender: 'female' },
    { voiceId: 'en-GB-Studio-B', name: 'British Male', gender: 'male' },
  ],
  ar: [
    { voiceId: 'ar-XA-Standard-A', name: 'Arabic Female', gender: 'female' },
    { voiceId: 'ar-XA-Standard-B', name: 'Arabic Male', gender: 'male' },
  ],
  es: [
    { voiceId: 'es-ES-Studio-F', name: 'Spanish Female (Spain)', gender: 'female' },
    { voiceId: 'es-US-Studio-B', name: 'Spanish Male (US)', gender: 'male' },
  ],
  fr: [
    { voiceId: 'fr-FR-Studio-A', name: 'French Female', gender: 'female' },
    { voiceId: 'fr-FR-Studio-D', name: 'French Male', gender: 'male' },
  ],
};

// ============================================
// SERVICE
// ============================================

export const audioUpdateService = {
  /**
   * Generate a podcast-style script from lesson content
   * Uses Gemini 3 Flash for fast, high-quality script generation
   */
  async generateScript(
    teacherId: string,
    input: GenerateAudioScriptInput
  ): Promise<GeneratedScript> {
    // Check quota
    const estimatedTokens = 7500; // ~75 credits for audio update
    await quotaService.enforceQuota(teacherId, TokenOperation.AUDIO_UPDATE, estimatedTokens);

    logger.info('Generating audio update script', {
      teacherId,
      lessonCount: input.lessonIds.length,
      language: input.language || 'en'
    });

    // Fetch the lesson content
    const lessons = await prisma.teacherContent.findMany({
      where: {
        id: { in: input.lessonIds },
        teacherId,
      },
      select: {
        id: true,
        title: true,
        subject: true,
        gradeLevel: true,
        lessonContent: true,
        description: true,
      },
    });

    if (lessons.length === 0) {
      throw new Error('No lessons found with the provided IDs');
    }

    // Build lesson summaries for the prompt
    const lessonSummaries = lessons.map(lesson => {
      const content = lesson.lessonContent as { title?: string; summary?: string; sections?: { title: string }[] } | null;
      return `
LESSON: ${lesson.title}
Subject: ${lesson.subject || 'General'}
Grade Level: ${lesson.gradeLevel || 'N/A'}
${content?.summary ? `Summary: ${content.summary}` : ''}
${lesson.description ? `Description: ${lesson.description}` : ''}
${content?.sections ? `Key Sections: ${content.sections.map(s => s.title).join(', ')}` : ''}
      `.trim();
    }).join('\n\n---\n\n');

    const duration = input.duration || 'medium';
    const durationMinutes = duration === 'short' ? '2-3' : duration === 'medium' ? '4-5' : '6-8';

    const prompt = buildPodcastScriptPrompt({
      lessonSummaries,
      customNotes: input.customNotes,
      weekLabel: input.weekLabel || 'this week',
      focusAreas: input.focusAreas,
      language: input.language || 'en',
      durationMinutes,
    });

    // Use Gemini 3 Flash for script generation
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      generationConfig: {
        temperature: 0.8, // Creative but coherent
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const tokensUsed = result.response.usageMetadata?.totalTokenCount || estimatedTokens;

    try {
      const parsed = JSON.parse(extractJSON(responseText)) as {
        title: string;
        script: string;
        estimatedDurationSeconds: number;
      };

      // Record usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.AUDIO_UPDATE,
        tokensUsed,
        modelUsed: config.gemini.models.flash,
        resourceType: 'audio_script',
      });

      return {
        title: parsed.title,
        script: parsed.script,
        estimatedDuration: parsed.estimatedDurationSeconds,
        tokensUsed,
      };
    } catch (error) {
      logger.error('Failed to parse generated script', {
        error: error instanceof Error ? error.message : 'Unknown error',
        responseText: responseText.substring(0, 500),
      });
      throw new Error('Failed to generate audio script');
    }
  },

  /**
   * Convert script text to audio using Google Cloud Text-to-Speech
   */
  async generateAudio(
    teacherId: string,
    audioUpdateId: string,
    input: AudioGenerationInput
  ): Promise<GeneratedAudio> {
    logger.info('Generating audio from script', {
      teacherId,
      audioUpdateId,
      scriptLength: input.script.length
    });

    // Update status to GENERATING
    await prisma.teacherAudioUpdate.update({
      where: { id: audioUpdateId, teacherId },
      data: { status: 'GENERATING' },
    });

    try {
      // Initialize TTS client
      const ttsClient = getTTSClient();

      const language = input.language || 'en';
      const voiceId = input.voiceId || VOICE_OPTIONS[language]?.[0]?.voiceId || 'en-US-Studio-O';

      // Extract language code from voice ID (e.g., "en-US-Studio-O" -> "en-US")
      const languageCode = voiceId.split('-').slice(0, 2).join('-');

      // Synthesize speech
      const [response] = await ttsClient.synthesizeSpeech({
        input: { text: input.script },
        voice: {
          languageCode,
          name: voiceId,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: input.speakingRate || 1.0,
          pitch: 0,
          effectsProfileId: ['headphone-class-device'],
        },
      });

      if (!response.audioContent) {
        throw new Error('No audio content generated');
      }

      // Calculate approximate duration (150 words per minute for TTS)
      const wordCount = input.script.split(/\s+/).length;
      const durationSeconds = Math.round((wordCount / 150) * 60);

      // Upload to storage
      const filename = `audio-update-${uuidv4()}.mp3`;
      const storagePath = `teacher/${teacherId}/audio-updates/${filename}`;

      const audioBuffer = Buffer.from(response.audioContent as Uint8Array);
      const uploadResult = await uploadFile(
        'aiContent',
        storagePath,
        audioBuffer,
        'audio/mpeg',
        {
          teacherId,
          audioUpdateId,
          wordCount: wordCount.toString(),
          durationSeconds: durationSeconds.toString(),
        }
      );

      // Update the audio update record
      await prisma.teacherAudioUpdate.update({
        where: { id: audioUpdateId, teacherId },
        data: {
          audioUrl: uploadResult.publicUrl,
          duration: durationSeconds,
          status: 'READY',
          voiceId,
        },
      });

      logger.info('Audio generation completed', {
        teacherId,
        audioUpdateId,
        durationSeconds,
        audioUrl: uploadResult.publicUrl,
      });

      return {
        audioUrl: uploadResult.publicUrl,
        duration: durationSeconds,
      };
    } catch (error) {
      // Update status to indicate failure (back to DRAFT so they can retry)
      await prisma.teacherAudioUpdate.update({
        where: { id: audioUpdateId, teacherId },
        data: { status: 'DRAFT' },
      });

      logger.error('Audio generation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        teacherId,
        audioUpdateId,
      });
      throw error;
    }
  },

  /**
   * Create a new audio update (generates script immediately)
   */
  async createAudioUpdate(
    teacherId: string,
    input: CreateAudioUpdateInput
  ): Promise<TeacherAudioUpdate> {
    // Generate the script first
    const scriptResult = await this.generateScript(teacherId, input);

    // Create the database record
    const audioUpdate = await prisma.teacherAudioUpdate.create({
      data: {
        teacherId,
        title: input.title || scriptResult.title,
        script: scriptResult.script,
        customNotes: input.customNotes,
        language: input.language || 'en',
        lessonIds: input.lessonIds,
        status: 'DRAFT',
        tokensUsed: scriptResult.tokensUsed,
        modelUsed: config.gemini.models.flash,
      },
    });

    logger.info('Audio update created', {
      teacherId,
      audioUpdateId: audioUpdate.id,
      lessonCount: input.lessonIds.length,
    });

    return audioUpdate;
  },

  /**
   * Get audio update by ID
   */
  async getAudioUpdate(
    audioUpdateId: string,
    teacherId: string
  ): Promise<TeacherAudioUpdate | null> {
    return prisma.teacherAudioUpdate.findFirst({
      where: { id: audioUpdateId, teacherId },
    });
  },

  /**
   * List audio updates for a teacher
   */
  async listAudioUpdates(
    teacherId: string,
    options: {
      status?: AudioStatus;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ audioUpdates: TeacherAudioUpdate[]; total: number }> {
    const { status, limit = 20, offset = 0 } = options;

    const where = {
      teacherId,
      ...(status && { status }),
    };

    const [audioUpdates, total] = await Promise.all([
      prisma.teacherAudioUpdate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.teacherAudioUpdate.count({ where }),
    ]);

    return { audioUpdates, total };
  },

  /**
   * Update an audio update (title, script, or status)
   */
  async updateAudioUpdate(
    audioUpdateId: string,
    teacherId: string,
    input: UpdateAudioUpdateInput
  ): Promise<TeacherAudioUpdate> {
    const existing = await prisma.teacherAudioUpdate.findFirst({
      where: { id: audioUpdateId, teacherId },
    });

    if (!existing) {
      throw new Error('Audio update not found');
    }

    // If updating script, reset audio URL and duration
    const updateData: Record<string, unknown> = { ...input };
    if (input.script && input.script !== existing.script) {
      updateData.audioUrl = null;
      updateData.duration = null;
      if (existing.status !== 'DRAFT') {
        updateData.status = 'DRAFT';
      }
    }

    // If setting to PUBLISHED, record publishedAt
    if (input.status === 'PUBLISHED' && existing.status !== 'PUBLISHED') {
      updateData.publishedAt = new Date();
    }

    return prisma.teacherAudioUpdate.update({
      where: { id: audioUpdateId },
      data: updateData,
    });
  },

  /**
   * Delete an audio update
   */
  async deleteAudioUpdate(
    audioUpdateId: string,
    teacherId: string
  ): Promise<void> {
    const existing = await prisma.teacherAudioUpdate.findFirst({
      where: { id: audioUpdateId, teacherId },
    });

    if (!existing) {
      throw new Error('Audio update not found');
    }

    await prisma.teacherAudioUpdate.delete({
      where: { id: audioUpdateId },
    });

    logger.info('Audio update deleted', { teacherId, audioUpdateId });
  },

  /**
   * Regenerate script for an existing audio update
   */
  async regenerateScript(
    audioUpdateId: string,
    teacherId: string,
    input?: Partial<GenerateAudioScriptInput>
  ): Promise<TeacherAudioUpdate> {
    const existing = await prisma.teacherAudioUpdate.findFirst({
      where: { id: audioUpdateId, teacherId },
    });

    if (!existing) {
      throw new Error('Audio update not found');
    }

    // Regenerate the script
    const scriptResult = await this.generateScript(teacherId, {
      lessonIds: existing.lessonIds,
      customNotes: input?.customNotes || existing.customNotes || undefined,
      language: input?.language || existing.language,
      duration: input?.duration,
      focusAreas: input?.focusAreas,
    });

    // Update the record with new script
    return prisma.teacherAudioUpdate.update({
      where: { id: audioUpdateId },
      data: {
        script: scriptResult.script,
        tokensUsed: existing.tokensUsed + scriptResult.tokensUsed,
        audioUrl: null,
        duration: null,
        status: 'DRAFT',
      },
    });
  },

  /**
   * Get available voice options for a language
   */
  getVoiceOptions(language: string = 'en'): { voiceId: string; name: string; gender: string }[] {
    return VOICE_OPTIONS[language] || VOICE_OPTIONS.en;
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractJSON(text: string): string {
  // Try to parse as-is first
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Continue to extraction logic
  }

  // Try to extract JSON from markdown code blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    const extracted = jsonBlockMatch[1].trim();
    try {
      JSON.parse(extracted);
      return extracted;
    } catch {
      // Continue
    }
  }

  // Try to find JSON object
  const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    return jsonObjectMatch[0];
  }

  return text;
}

interface PodcastPromptParams {
  lessonSummaries: string;
  customNotes?: string;
  weekLabel: string;
  focusAreas?: string[];
  language: string;
  durationMinutes: string;
}

function buildPodcastScriptPrompt(params: PodcastPromptParams): string {
  const { lessonSummaries, customNotes, weekLabel, focusAreas, language, durationMinutes } = params;

  const languageInstruction = language !== 'en'
    ? `\n\nIMPORTANT: Generate the script in ${getLanguageName(language)}. The entire script should be in ${getLanguageName(language)}.`
    : '';

  return `You are a friendly, engaging educational podcast host creating a class update for parents.
Your goal is to help parents understand what their children are learning and how they can support at home.

LESSON CONTENT FROM THIS WEEK:
${lessonSummaries}

${customNotes ? `TEACHER'S ADDITIONAL NOTES:\n${customNotes}\n` : ''}
${focusAreas?.length ? `FOCUS AREAS TO EMPHASIZE:\n${focusAreas.join('\n')}\n` : ''}

Create a ${durationMinutes} minute podcast-style script for parents about ${weekLabel}'s learning activities.

SCRIPT REQUIREMENTS:
1. Start with a warm, welcoming greeting to parents
2. Briefly introduce what subjects/topics were covered
3. For each major topic:
   - Explain what the students learned in parent-friendly language
   - Share one or two key concepts they should know about
   - Suggest a simple way to reinforce learning at home
4. Mention any upcoming topics or things to look forward to
5. End with encouragement and a friendly sign-off

TONE & STYLE:
- Friendly and conversational, like talking to a neighbor
- Educational but not condescending
- Enthusiastic about the learning happening
- Supportive and encouraging to parents
- Use "we" when referring to classroom activities
- Address parents directly as "you" and students as "your child/children"

FORMAT:
- Write as a single speaker narration (no need for multiple hosts)
- Include natural pauses indicated by "..."
- Use conversational transitions
- Keep sentences clear and easy to follow when read aloud
${languageInstruction}

Return JSON with this structure:
{
  "title": "Engaging title for this week's update (e.g., 'Week of December 23: Exploring Fractions & The Solar System')",
  "script": "The full podcast script text, ready to be read aloud. Include natural conversational elements, pauses (marked with ...), and clear transitions between topics.",
  "estimatedDurationSeconds": 240
}

The script should be approximately ${getDurationWords(durationMinutes)} words to achieve the ${durationMinutes} minute duration.`;
}

function getLanguageName(code: string): string {
  const languages: Record<string, string> = {
    en: 'English',
    ar: 'Arabic',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    zh: 'Chinese',
    hi: 'Hindi',
    ur: 'Urdu',
    pt: 'Portuguese',
    it: 'Italian',
  };
  return languages[code] || 'English';
}

function getDurationWords(minutes: string): string {
  // Approximately 150 words per minute for natural speech
  const durationMap: Record<string, string> = {
    '2-3': '300-450',
    '4-5': '600-750',
    '6-8': '900-1200',
  };
  return durationMap[minutes] || '600-750';
}

export default audioUpdateService;
