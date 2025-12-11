/**
 * PowerPoint Export Service for Teacher Content
 * Generates professional PPTX presentations using PptxGenJS
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
import PptxGenJSModule from 'pptxgenjs';
import { TeacherContent, Subject } from '@prisma/client';
import { Buffer } from 'buffer';

// The library exports a class that needs to be instantiated
// Using 'any' to handle the complex type export situation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PptxGenJS: any = PptxGenJSModule;

/**
 * Fetch an image from URL and return as base64 with dimensions
 */
async function fetchImageAsBase64(url: string): Promise<{
  base64: string;
  mimeType: string;
  width: number;
  height: number;
} | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch image: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    // Determine mime type from URL or response headers
    const contentType = response.headers.get('content-type') || '';
    let mimeType = 'image/png';
    if (contentType.includes('jpeg') || contentType.includes('jpg') || url.toLowerCase().includes('.jpg') || url.toLowerCase().includes('.jpeg')) {
      mimeType = 'image/jpeg';
    } else if (contentType.includes('png') || url.toLowerCase().includes('.png')) {
      mimeType = 'image/png';
    } else if (contentType.includes('gif') || url.toLowerCase().includes('.gif')) {
      mimeType = 'image/gif';
    } else if (contentType.includes('webp') || url.toLowerCase().includes('.webp')) {
      mimeType = 'image/webp';
    }

    // Try to get image dimensions from the buffer
    // PNG: width at bytes 16-19, height at bytes 20-23
    // JPEG: more complex, need to parse segments
    let width = 0;
    let height = 0;

    if (mimeType === 'image/png' && buffer.length > 24) {
      // PNG header: 89 50 4E 47 0D 0A 1A 0A, then IHDR chunk
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        width = buffer.readUInt32BE(16);
        height = buffer.readUInt32BE(20);
      }
    } else if (mimeType === 'image/jpeg' && buffer.length > 2) {
      // JPEG: Find SOF0 marker (0xFF 0xC0) or SOF2 (0xFF 0xC2)
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] === 0xFF) {
          const marker = buffer[offset + 1];
          // SOF0, SOF1, SOF2 markers contain dimensions
          if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
            height = buffer.readUInt16BE(offset + 5);
            width = buffer.readUInt16BE(offset + 7);
            break;
          }
          // Skip to next marker
          const segmentLength = buffer.readUInt16BE(offset + 2);
          offset += 2 + segmentLength;
        } else {
          offset++;
        }
      }
    }

    // Default dimensions if we couldn't parse them
    if (width === 0 || height === 0) {
      // Assume a typical infographic aspect ratio (tall)
      width = 800;
      height = 1200;
    }

    return { base64, mimeType, width, height };
  } catch (error) {
    console.error('Error fetching image:', error);
    return null;
  }
}

// Define table row type inline since the namespace export isn't available in ESM
interface TableCell {
  text: string;
  options?: {
    bold?: boolean;
    fill?: { color: string };
    color?: string;
    fontSize?: number;
  };
}
type TableRow = TableCell[];

// Types for lesson content structure
interface ActivityObject {
  name?: string;
  description?: string;
  materials?: string[];
  duration?: number;
  discussionQuestions?: string[];
}

interface LessonSection {
  title: string;
  content: string;
  duration?: number;
  activities?: (string | ActivityObject)[];
  teachingTips?: string[];
  visualAids?: string[];
  realWorldConnections?: string[];
}

interface VocabularyItem {
  term: string;
  definition: string;
  example?: string;
}

interface AssessmentQuestion {
  question: string;
  type: 'multiple_choice' | 'short_answer' | 'true_false';
  options?: string[];
  correctAnswer: string;
  explanation?: string;
}

interface PracticeExercise {
  question: string;
  type?: string;
  hint?: string;
  answer?: string;
}

interface LessonContent {
  title: string;
  summary?: string;
  objectives?: string[];
  sections?: LessonSection[];
  vocabulary?: VocabularyItem[];
  assessment?: {
    questions: AssessmentQuestion[];
    totalPoints?: number;
    passingScore?: number;
    scoringGuide?: string;
  };
  teacherNotes?: string;
  practiceExercises?: PracticeExercise[];
  summaryPoints?: string[];
  reviewQuestions?: string[];
  additionalResources?: string[];
  prerequisites?: string[];
  nextSteps?: string;
}

interface QuizQuestion {
  id: string;
  question: string;
  type: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  difficulty?: string;
  points?: number;
}

interface QuizContent {
  title: string;
  questions: QuizQuestion[];
  totalPoints?: number;
  estimatedTime?: number;
}

interface Flashcard {
  id: string;
  front: string;
  back: string;
  hint?: string;
  category?: string;
}

interface FlashcardContent {
  title: string;
  cards: Flashcard[];
}

// Export options interface
export interface PPTXExportOptions {
  theme: 'professional' | 'colorful';
  slideStyle: 'focused' | 'dense';
  includeAnswers: boolean;
  includeTeacherNotes: boolean;
  includeInfographic: boolean;
  aspectRatio: '16:9' | '4:3';
}

// Subject colors for styling
const subjectColors: Record<Subject, { primary: string; secondary: string; accent: string; light: string }> = {
  MATH: { primary: '3B82F6', secondary: 'DBEAFE', accent: '1D4ED8', light: 'EFF6FF' },
  ENGLISH: { primary: '8B5CF6', secondary: 'EDE9FE', accent: '6D28D9', light: 'F5F3FF' },
  SCIENCE: { primary: '10B981', secondary: 'D1FAE5', accent: '047857', light: 'ECFDF5' },
  SOCIAL_STUDIES: { primary: 'F59E0B', secondary: 'FEF3C7', accent: 'D97706', light: 'FFFBEB' },
  ARABIC: { primary: '059669', secondary: 'D1FAE5', accent: '047857', light: 'ECFDF5' },
  ISLAMIC_STUDIES: { primary: '047857', secondary: 'ECFDF5', accent: '065F46', light: 'F0FDF9' },
  ART: { primary: 'EC4899', secondary: 'FCE7F3', accent: 'BE185D', light: 'FDF2F8' },
  MUSIC: { primary: '6366F1', secondary: 'E0E7FF', accent: '4338CA', light: 'EEF2FF' },
  OTHER: { primary: '6B7280', secondary: 'F3F4F6', accent: '4B5563', light: 'F9FAFB' },
};

// Theme configurations
interface ThemeConfig {
  background: string;
  title: string;
  text: string;
  accent: string;
  secondary: string;
}

function getThemeColors(subject: Subject, theme: 'professional' | 'colorful'): ThemeConfig {
  const subjectColor = subjectColors[subject] || subjectColors.OTHER;

  if (theme === 'professional') {
    return {
      background: 'FFFFFF',
      title: '1F2937',
      text: '374151',
      accent: subjectColor.primary,
      secondary: subjectColor.secondary,
    };
  } else {
    // Colorful theme
    return {
      background: subjectColor.light,
      title: subjectColor.accent,
      text: '1F2937',
      accent: subjectColor.primary,
      secondary: subjectColor.secondary,
    };
  }
}

/**
 * Truncate text to fit in slides
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Split text into chunks for multiple slides
 */
function splitTextIntoChunks(text: string, maxChunkLength: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkLength && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Generate PowerPoint for lesson content
 */
export async function generateLessonPPTX(
  content: TeacherContent,
  options: PPTXExportOptions
): Promise<{ data: Buffer; filename: string }> {
  const pptx = new PptxGenJS();
  const subject = (content.subject || 'OTHER') as Subject;
  const themeColors = getThemeColors(subject, options.theme);
  const lessonData = content.lessonContent as unknown as LessonContent;

  // Configure presentation
  pptx.layout = options.aspectRatio === '4:3' ? 'LAYOUT_4x3' : 'LAYOUT_WIDE';
  pptx.title = lessonData?.title || content.title;
  pptx.author = 'Orbit Learn';
  pptx.company = 'Orbit Learn';

  // Define slide masters
  pptx.defineSlideMaster({
    title: 'TITLE_SLIDE',
    background: { color: themeColors.accent },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 2.5, w: 9, h: 1.5, fontFace: 'Arial', fontSize: 44, color: 'FFFFFF', bold: true, align: 'center' } } },
      { placeholder: { options: { name: 'subtitle', type: 'body', x: 0.5, y: 4.2, w: 9, h: 1, fontFace: 'Arial', fontSize: 24, color: 'FFFFFF', align: 'center' } } },
    ],
  });

  pptx.defineSlideMaster({
    title: 'SECTION_HEADER',
    background: { color: themeColors.secondary },
    objects: [
      { rect: { x: 0, y: 0, w: '100%', h: 0.1, fill: { color: themeColors.accent } } },
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 2, w: 9, h: 1.5, fontFace: 'Arial', fontSize: 36, color: themeColors.title, bold: true, align: 'center' } } },
    ],
  });

  pptx.defineSlideMaster({
    title: 'CONTENT_SLIDE',
    background: { color: themeColors.background },
    objects: [
      { rect: { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: themeColors.accent } } },
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.15, w: 9, h: 0.5, fontFace: 'Arial', fontSize: 24, color: 'FFFFFF', bold: true } } },
    ],
  });

  const maxBulletsPerSlide = options.slideStyle === 'dense' ? 8 : 5;
  const maxContentLength = options.slideStyle === 'dense' ? 600 : 400;

  // ========== TITLE SLIDE ==========
  const titleSlide = pptx.addSlide({ masterName: 'TITLE_SLIDE' });
  titleSlide.addText(lessonData?.title || content.title, {
    x: 0.5,
    y: 2.2,
    w: 9,
    h: 1.5,
    fontSize: 44,
    fontFace: 'Arial',
    color: 'FFFFFF',
    bold: true,
    align: 'center',
  });
  titleSlide.addText(
    `${(content.subject || 'OTHER').replace('_', ' ')} | Grade ${content.gradeLevel}`,
    {
      x: 0.5,
      y: 4,
      w: 9,
      h: 0.5,
      fontSize: 20,
      fontFace: 'Arial',
      color: 'FFFFFF',
      align: 'center',
    }
  );
  // Add logo/branding
  titleSlide.addText('Orbit Learn', {
    x: 0.5,
    y: 5,
    w: 9,
    h: 0.4,
    fontSize: 14,
    fontFace: 'Arial',
    color: 'FFFFFF',
    align: 'center',
    italic: true,
  });

  // ========== LEARNING OBJECTIVES SLIDE ==========
  if (lessonData?.objectives && lessonData.objectives.length > 0) {
    const objSlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
    objSlide.addText('Learning Objectives', {
      x: 0.5,
      y: 0.15,
      w: 9,
      h: 0.5,
      fontSize: 24,
      fontFace: 'Arial',
      color: 'FFFFFF',
      bold: true,
    });

    const objectiveRows = lessonData.objectives.map((obj) => ({
      text: obj,
      options: { bullet: { type: 'bullet' as const, color: themeColors.accent }, fontSize: 18, color: themeColors.text },
    }));

    objSlide.addText(objectiveRows, {
      x: 0.5,
      y: 1.2,
      w: 9,
      h: 4,
      fontFace: 'Arial',
      valign: 'top',
    });
  }

  // ========== LESSON SECTIONS ==========
  if (lessonData?.sections && lessonData.sections.length > 0) {
    for (const section of lessonData.sections) {
      // Section header slide (focused style) or skip (dense style)
      if (options.slideStyle === 'focused') {
        const sectionHeaderSlide = pptx.addSlide({ masterName: 'SECTION_HEADER' });
        sectionHeaderSlide.addText(section.title, {
          x: 0.5,
          y: 2.2,
          w: 9,
          h: 1,
          fontSize: 36,
          fontFace: 'Arial',
          color: themeColors.title,
          bold: true,
          align: 'center',
        });
        if (section.duration) {
          sectionHeaderSlide.addText(`Duration: ${section.duration} minutes`, {
            x: 0.5,
            y: 3.5,
            w: 9,
            h: 0.5,
            fontSize: 16,
            fontFace: 'Arial',
            color: themeColors.text,
            align: 'center',
          });
        }
      }

      // Content slides
      const contentChunks = splitTextIntoChunks(section.content, maxContentLength);

      for (let i = 0; i < contentChunks.length; i++) {
        const contentSlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
        const slideTitle =
          contentChunks.length > 1 ? `${section.title} (${i + 1}/${contentChunks.length})` : section.title;

        contentSlide.addText(slideTitle, {
          x: 0.5,
          y: 0.15,
          w: 9,
          h: 0.5,
          fontSize: 24,
          fontFace: 'Arial',
          color: 'FFFFFF',
          bold: true,
        });

        contentSlide.addText(contentChunks[i], {
          x: 0.5,
          y: 1.2,
          w: 9,
          h: 4,
          fontSize: 16,
          fontFace: 'Arial',
          color: themeColors.text,
          valign: 'top',
        });
      }

      // Activities slide (focused style only or if there are many activities)
      if (section.activities && section.activities.length > 0 && options.slideStyle === 'focused') {
        const activitySlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
        activitySlide.addText(`${section.title} - Activities`, {
          x: 0.5,
          y: 0.15,
          w: 9,
          h: 0.5,
          fontSize: 24,
          fontFace: 'Arial',
          color: 'FFFFFF',
          bold: true,
        });

        const activityRows = section.activities.map((act) => {
          if (typeof act === 'string') {
            return {
              text: act,
              options: { bullet: { type: 'bullet' as const, color: themeColors.accent }, fontSize: 16, color: themeColors.text },
            };
          }
          const actObj = act as ActivityObject;
          return {
            text: actObj.name || actObj.description || 'Activity',
            options: { bullet: { type: 'bullet' as const, color: themeColors.accent }, fontSize: 16, color: themeColors.text },
          };
        });

        activitySlide.addText(activityRows, {
          x: 0.5,
          y: 1.2,
          w: 9,
          h: 4,
          fontFace: 'Arial',
          valign: 'top',
        });
      }
    }
  }

  // ========== VOCABULARY SLIDES ==========
  if (lessonData?.vocabulary && lessonData.vocabulary.length > 0) {
    const vocabPerSlide = options.slideStyle === 'dense' ? 6 : 4;
    const vocabChunks: VocabularyItem[][] = [];

    for (let i = 0; i < lessonData.vocabulary.length; i += vocabPerSlide) {
      vocabChunks.push(lessonData.vocabulary.slice(i, i + vocabPerSlide));
    }

    for (let chunkIdx = 0; chunkIdx < vocabChunks.length; chunkIdx++) {
      const vocabSlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
      const slideTitle =
        vocabChunks.length > 1 ? `Vocabulary (${chunkIdx + 1}/${vocabChunks.length})` : 'Vocabulary';

      vocabSlide.addText(slideTitle, {
        x: 0.5,
        y: 0.15,
        w: 9,
        h: 0.5,
        fontSize: 24,
        fontFace: 'Arial',
        color: 'FFFFFF',
        bold: true,
      });

      // Create table for vocabulary
      const tableData: TableRow[] = [
        [
          { text: 'Term', options: { bold: true, fill: { color: themeColors.accent }, color: 'FFFFFF', fontSize: 14 } },
          { text: 'Definition', options: { bold: true, fill: { color: themeColors.accent }, color: 'FFFFFF', fontSize: 14 } },
        ],
      ];

      for (const vocab of vocabChunks[chunkIdx]) {
        tableData.push([
          { text: vocab.term, options: { bold: true, fontSize: 12, color: themeColors.title } },
          { text: vocab.definition, options: { fontSize: 12, color: themeColors.text } },
        ]);
      }

      vocabSlide.addTable(tableData, {
        x: 0.5,
        y: 1.2,
        w: 9,
        colW: [2.5, 6.5],
        border: { pt: 1, color: 'E5E7EB' },
        fontFace: 'Arial',
      });
    }
  }

  // ========== ASSESSMENT QUESTIONS ==========
  if (lessonData?.assessment?.questions && lessonData.assessment.questions.length > 0) {
    const questionsPerSlide = options.slideStyle === 'dense' ? 3 : 2;
    const questionChunks: AssessmentQuestion[][] = [];

    for (let i = 0; i < lessonData.assessment.questions.length; i += questionsPerSlide) {
      questionChunks.push(lessonData.assessment.questions.slice(i, i + questionsPerSlide));
    }

    for (let chunkIdx = 0; chunkIdx < questionChunks.length; chunkIdx++) {
      const questionSlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
      const slideTitle =
        questionChunks.length > 1
          ? `Assessment Questions (${chunkIdx + 1}/${questionChunks.length})`
          : 'Assessment Questions';

      questionSlide.addText(slideTitle, {
        x: 0.5,
        y: 0.15,
        w: 9,
        h: 0.5,
        fontSize: 24,
        fontFace: 'Arial',
        color: 'FFFFFF',
        bold: true,
      });

      let yPos = 1.2;
      const startIdx = chunkIdx * questionsPerSlide;

      for (let i = 0; i < questionChunks[chunkIdx].length; i++) {
        const q = questionChunks[chunkIdx][i];
        const qNum = startIdx + i + 1;

        // Question text
        questionSlide.addText(`${qNum}. ${q.question}`, {
          x: 0.5,
          y: yPos,
          w: 9,
          h: 0.5,
          fontSize: 14,
          fontFace: 'Arial',
          color: themeColors.title,
          bold: true,
        });
        yPos += 0.5;

        // Options for multiple choice
        if (q.options && q.options.length > 0) {
          const optionRows = q.options.map((opt, j) => {
            const isCorrect = options.includeAnswers && opt === q.correctAnswer;
            return {
              text: `${String.fromCharCode(65 + j)}. ${opt}`,
              options: {
                fontSize: 12,
                color: isCorrect ? '10B981' : themeColors.text,
                bold: isCorrect,
              },
            };
          });

          questionSlide.addText(optionRows, {
            x: 0.8,
            y: yPos,
            w: 8.7,
            h: 0.15 * q.options.length + 0.3,
            fontFace: 'Arial',
            valign: 'top',
          });
          yPos += 0.15 * q.options.length + 0.4;
        } else if (options.includeAnswers) {
          // Show answer for non-multiple choice
          questionSlide.addText(`Answer: ${q.correctAnswer}`, {
            x: 0.8,
            y: yPos,
            w: 8.7,
            h: 0.3,
            fontSize: 12,
            fontFace: 'Arial',
            color: '10B981',
            bold: true,
          });
          yPos += 0.4;
        }

        yPos += 0.2;
      }
    }
  }

  // ========== PRACTICE EXERCISES ==========
  if (lessonData?.practiceExercises && lessonData.practiceExercises.length > 0 && options.slideStyle === 'focused') {
    const exercisesPerSlide = 3;
    const exerciseChunks: PracticeExercise[][] = [];

    for (let i = 0; i < lessonData.practiceExercises.length; i += exercisesPerSlide) {
      exerciseChunks.push(lessonData.practiceExercises.slice(i, i + exercisesPerSlide));
    }

    for (let chunkIdx = 0; chunkIdx < exerciseChunks.length; chunkIdx++) {
      const exerciseSlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
      const slideTitle =
        exerciseChunks.length > 1 ? `Practice (${chunkIdx + 1}/${exerciseChunks.length})` : 'Practice Exercises';

      exerciseSlide.addText(slideTitle, {
        x: 0.5,
        y: 0.15,
        w: 9,
        h: 0.5,
        fontSize: 24,
        fontFace: 'Arial',
        color: 'FFFFFF',
        bold: true,
      });

      let yPos = 1.2;
      const startIdx = chunkIdx * exercisesPerSlide;

      for (let i = 0; i < exerciseChunks[chunkIdx].length; i++) {
        const ex = exerciseChunks[chunkIdx][i];
        const exNum = startIdx + i + 1;

        exerciseSlide.addText(`${exNum}. ${ex.question}`, {
          x: 0.5,
          y: yPos,
          w: 9,
          h: 0.5,
          fontSize: 14,
          fontFace: 'Arial',
          color: themeColors.title,
          bold: true,
        });
        yPos += 0.5;

        if (ex.hint) {
          exerciseSlide.addText(`Hint: ${ex.hint}`, {
            x: 0.8,
            y: yPos,
            w: 8.7,
            h: 0.3,
            fontSize: 11,
            fontFace: 'Arial',
            color: '6B7280',
            italic: true,
          });
          yPos += 0.35;
        }

        if (options.includeAnswers && ex.answer) {
          exerciseSlide.addText(`Answer: ${ex.answer}`, {
            x: 0.8,
            y: yPos,
            w: 8.7,
            h: 0.3,
            fontSize: 12,
            fontFace: 'Arial',
            color: '10B981',
            bold: true,
          });
          yPos += 0.4;
        }

        yPos += 0.3;
      }
    }
  }

  // ========== QUIZ CONTENT (if attached) ==========
  const quizContent = content.quizContent as unknown as QuizContent | null;
  if (quizContent?.questions && quizContent.questions.length > 0) {
    // Quiz section header
    const quizHeaderSlide = pptx.addSlide({ masterName: 'SECTION_HEADER' });
    quizHeaderSlide.addText('Quiz', {
      x: 0.5,
      y: 2.2,
      w: 9,
      h: 1,
      fontSize: 36,
      fontFace: 'Arial',
      color: themeColors.title,
      bold: true,
      align: 'center',
    });
    quizHeaderSlide.addText(`${quizContent.questions.length} Questions`, {
      x: 0.5,
      y: 3.5,
      w: 9,
      h: 0.5,
      fontSize: 16,
      fontFace: 'Arial',
      color: themeColors.text,
      align: 'center',
    });

    // Quiz questions
    const questionsPerSlide = options.slideStyle === 'dense' ? 2 : 1;

    for (let i = 0; i < quizContent.questions.length; i += questionsPerSlide) {
      const quizSlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
      quizSlide.addText(`Quiz Question${questionsPerSlide > 1 ? 's' : ''} ${i + 1}${questionsPerSlide > 1 && i + 2 <= quizContent.questions.length ? `-${Math.min(i + questionsPerSlide, quizContent.questions.length)}` : ''}`, {
        x: 0.5,
        y: 0.15,
        w: 9,
        h: 0.5,
        fontSize: 24,
        fontFace: 'Arial',
        color: 'FFFFFF',
        bold: true,
      });

      let yPos = 1.2;

      for (let j = 0; j < questionsPerSlide && i + j < quizContent.questions.length; j++) {
        const q = quizContent.questions[i + j];

        quizSlide.addText(`${i + j + 1}. ${q.question}`, {
          x: 0.5,
          y: yPos,
          w: 9,
          h: 0.6,
          fontSize: 14,
          fontFace: 'Arial',
          color: themeColors.title,
          bold: true,
        });
        yPos += 0.6;

        if (q.options && q.options.length > 0) {
          const optionRows = q.options.map((opt, k) => {
            const isCorrect = options.includeAnswers && opt === q.correctAnswer;
            return {
              text: `${String.fromCharCode(65 + k)}. ${opt}`,
              options: {
                fontSize: 12,
                color: isCorrect ? '10B981' : themeColors.text,
                bold: isCorrect,
              },
            };
          });

          quizSlide.addText(optionRows, {
            x: 0.8,
            y: yPos,
            w: 8.7,
            h: 0.15 * q.options.length + 0.2,
            fontFace: 'Arial',
          });
          yPos += 0.15 * q.options.length + 0.4;
        }

        yPos += 0.3;
      }
    }
  }

  // ========== FLASHCARD CONTENT (if attached) ==========
  const flashcardContent = content.flashcardContent as unknown as FlashcardContent | null;
  if (flashcardContent?.cards && flashcardContent.cards.length > 0) {
    // Flashcard section header
    const flashHeaderSlide = pptx.addSlide({ masterName: 'SECTION_HEADER' });
    flashHeaderSlide.addText('Flashcards', {
      x: 0.5,
      y: 2.2,
      w: 9,
      h: 1,
      fontSize: 36,
      fontFace: 'Arial',
      color: themeColors.title,
      bold: true,
      align: 'center',
    });
    flashHeaderSlide.addText(`${flashcardContent.cards.length} Cards`, {
      x: 0.5,
      y: 3.5,
      w: 9,
      h: 0.5,
      fontSize: 16,
      fontFace: 'Arial',
      color: themeColors.text,
      align: 'center',
    });

    // Flashcards - dense puts multiple per slide, focused does 1 per slide
    const cardsPerSlide = options.slideStyle === 'dense' ? 4 : 1;

    for (let i = 0; i < flashcardContent.cards.length; i += cardsPerSlide) {
      const flashSlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
      flashSlide.addText(
        cardsPerSlide > 1
          ? `Flashcards ${i + 1}-${Math.min(i + cardsPerSlide, flashcardContent.cards.length)}`
          : `Flashcard ${i + 1}`,
        {
          x: 0.5,
          y: 0.15,
          w: 9,
          h: 0.5,
          fontSize: 24,
          fontFace: 'Arial',
          color: 'FFFFFF',
          bold: true,
        }
      );

      if (cardsPerSlide === 1) {
        // Single card per slide - larger display
        const card = flashcardContent.cards[i];
        flashSlide.addText(card.front, {
          x: 0.5,
          y: 1.5,
          w: 9,
          h: 1.5,
          fontSize: 24,
          fontFace: 'Arial',
          color: themeColors.accent,
          bold: true,
          align: 'center',
          valign: 'middle',
        });

        flashSlide.addShape(pptx.ShapeType.line, {
          x: 1,
          y: 3.2,
          w: 8,
          h: 0,
          line: { color: 'E5E7EB', width: 2, dashType: 'dash' },
        });

        flashSlide.addText(card.back, {
          x: 0.5,
          y: 3.5,
          w: 9,
          h: 1.5,
          fontSize: 18,
          fontFace: 'Arial',
          color: themeColors.text,
          align: 'center',
          valign: 'middle',
        });
      } else {
        // Multiple cards per slide - table format
        const tableData: TableRow[] = [
          [
            { text: 'Front', options: { bold: true, fill: { color: themeColors.accent }, color: 'FFFFFF', fontSize: 12 } },
            { text: 'Back', options: { bold: true, fill: { color: themeColors.accent }, color: 'FFFFFF', fontSize: 12 } },
          ],
        ];

        for (let j = 0; j < cardsPerSlide && i + j < flashcardContent.cards.length; j++) {
          const card = flashcardContent.cards[i + j];
          tableData.push([
            { text: card.front, options: { bold: true, fontSize: 11, color: themeColors.title } },
            { text: card.back, options: { fontSize: 11, color: themeColors.text } },
          ]);
        }

        flashSlide.addTable(tableData, {
          x: 0.5,
          y: 1.2,
          w: 9,
          colW: [4.5, 4.5],
          border: { pt: 1, color: 'E5E7EB' },
          fontFace: 'Arial',
        });
      }
    }
  }

  // ========== INFOGRAPHIC SLIDE(S) ==========
  if (options.includeInfographic && content.infographicUrl) {
    // Fetch the image and get its dimensions
    const imageData = await fetchImageAsBase64(content.infographicUrl);

    if (imageData) {
      const { base64, mimeType, width, height } = imageData;
      const aspectRatio = width / height;

      // Slide dimensions (in inches)
      // 16:9 = 10" x 5.625", 4:3 = 10" x 7.5"
      const slideWidth = 10;
      const slideHeight = options.aspectRatio === '16:9' ? 5.625 : 7.5;

      // Available content area (with margins)
      const contentMargin = 0.3;
      const availableWidth = slideWidth - contentMargin * 2;

      // For infographics, we want to maximize the image display
      // If the image is tall (typical for infographics), we may need multiple slides
      const isVeryTall = aspectRatio < 0.5; // Height is more than 2x width
      const isTall = aspectRatio < 0.8; // Height is more than 1.25x width

      if (isVeryTall) {
        // Very tall infographic: Split into multiple full-bleed slides
        // Calculate how many slides we need based on image aspect ratio
        const maxHeightPerSlide = slideHeight - 0.8; // Leave some margin
        const imageWidthOnSlide = availableWidth * 0.9; // 90% of available width
        const imageHeightOnSlide = imageWidthOnSlide / aspectRatio;
        const numSlides = Math.ceil(imageHeightOnSlide / maxHeightPerSlide);

        // Add a header slide for the infographic section
        const headerSlide = pptx.addSlide({ masterName: 'SECTION_HEADER' });
        headerSlide.addText('Visual Summary', {
          x: 0.5,
          y: 2.2,
          w: 9,
          h: 1,
          fontSize: 36,
          fontFace: 'Arial',
          color: themeColors.title,
          bold: true,
          align: 'center',
        });
        headerSlide.addText(`Infographic (${numSlides} slides)`, {
          x: 0.5,
          y: 3.5,
          w: 9,
          h: 0.5,
          fontSize: 16,
          fontFace: 'Arial',
          color: themeColors.text,
          align: 'center',
        });

        // Create slides with cropped portions of the image
        for (let i = 0; i < numSlides; i++) {
          const infoSlide = pptx.addSlide();
          // Clean background for full-bleed feel
          infoSlide.background = { color: themeColors.background };

          // Calculate crop region (as percentage)
          const cropTop = (i / numSlides) * 100;
          const cropHeight = (1 / numSlides) * 100;

          // Add the cropped image portion
          // Note: PptxGenJS doesn't support direct cropping, so we use sizing with cover
          // For a workaround, we'll show the full image but positioned to show the relevant section
          // Actually, let's use a different approach - show the full image scaled to fit one slide nicely

          // For very tall images, we'll show the full image scaled to fit within slide bounds
          // This is actually better than cropping for infographics since they're meant to be seen whole
          if (i === 0) {
            // Only one slide with the full image, scaled to fit
            const scaledWidth = Math.min(availableWidth, slideHeight * aspectRatio);
            const scaledHeight = scaledWidth / aspectRatio;
            const xPos = (slideWidth - scaledWidth) / 2;
            const yPos = (slideHeight - scaledHeight) / 2;

            infoSlide.addImage({
              data: `data:${mimeType};base64,${base64}`,
              x: xPos,
              y: yPos,
              w: scaledWidth,
              h: scaledHeight,
            });

            // Add page indicator
            infoSlide.addText('Visual Summary - Infographic', {
              x: 0.3,
              y: slideHeight - 0.4,
              w: slideWidth - 0.6,
              h: 0.3,
              fontSize: 10,
              fontFace: 'Arial',
              color: '9CA3AF',
              align: 'center',
            });
          }
          // Break after first slide since we're showing the full image
          break;
        }
      } else if (isTall) {
        // Moderately tall: Single full-bleed slide with maximized image
        const infoSlide = pptx.addSlide();
        infoSlide.background = { color: themeColors.background };

        // Calculate dimensions to maximize image on slide
        const scaledHeight = slideHeight - 0.6; // Leave small margins
        const scaledWidth = scaledHeight * aspectRatio;
        const xPos = (slideWidth - scaledWidth) / 2;
        const yPos = 0.3;

        infoSlide.addImage({
          data: `data:${mimeType};base64,${base64}`,
          x: xPos,
          y: yPos,
          w: scaledWidth,
          h: scaledHeight,
        });

        // Subtle branding at bottom
        infoSlide.addText('Visual Summary - Infographic', {
          x: 0.3,
          y: slideHeight - 0.35,
          w: slideWidth - 0.6,
          h: 0.25,
          fontSize: 9,
          fontFace: 'Arial',
          color: '9CA3AF',
          align: 'center',
        });
      } else {
        // Wide or square image: Use standard content slide
        const infoSlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
        infoSlide.addText('Visual Summary', {
          x: 0.5,
          y: 0.15,
          w: 9,
          h: 0.5,
          fontSize: 24,
          fontFace: 'Arial',
          color: 'FFFFFF',
          bold: true,
        });

        // Calculate dimensions maintaining aspect ratio
        const maxWidth = 9;
        const maxHeight = slideHeight - 1.5; // Account for header
        let imgWidth = maxWidth;
        let imgHeight = imgWidth / aspectRatio;

        if (imgHeight > maxHeight) {
          imgHeight = maxHeight;
          imgWidth = imgHeight * aspectRatio;
        }

        const xPos = (slideWidth - imgWidth) / 2;
        const yPos = 0.9 + (maxHeight - imgHeight) / 2;

        infoSlide.addImage({
          data: `data:${mimeType};base64,${base64}`,
          x: xPos,
          y: yPos,
          w: imgWidth,
          h: imgHeight,
        });
      }
    } else {
      // Failed to fetch image - show fallback slide with link
      const infoSlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
      infoSlide.addText('Visual Summary', {
        x: 0.5,
        y: 0.15,
        w: 9,
        h: 0.5,
        fontSize: 24,
        fontFace: 'Arial',
        color: 'FFFFFF',
        bold: true,
      });

      // Styled fallback message
      infoSlide.addShape(pptx.ShapeType.rect, {
        x: 1,
        y: 1.5,
        w: 8,
        h: 3,
        fill: { color: themeColors.secondary },
        line: { color: themeColors.accent, width: 2, dashType: 'dash' },
      });

      infoSlide.addText('Infographic Available Online', {
        x: 1,
        y: 2,
        w: 8,
        h: 0.5,
        fontSize: 18,
        fontFace: 'Arial',
        color: themeColors.title,
        bold: true,
        align: 'center',
      });

      infoSlide.addText('The infographic for this lesson can be viewed at:', {
        x: 1,
        y: 2.6,
        w: 8,
        h: 0.4,
        fontSize: 12,
        fontFace: 'Arial',
        color: themeColors.text,
        align: 'center',
      });

      // Truncate URL if too long
      const displayUrl = content.infographicUrl.length > 60
        ? content.infographicUrl.substring(0, 57) + '...'
        : content.infographicUrl;

      infoSlide.addText(displayUrl, {
        x: 1,
        y: 3.1,
        w: 8,
        h: 0.4,
        fontSize: 10,
        fontFace: 'Arial',
        color: themeColors.accent,
        align: 'center',
      });
    }
  }

  // ========== SUMMARY SLIDE ==========
  if (lessonData?.summaryPoints && lessonData.summaryPoints.length > 0) {
    const summarySlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
    summarySlide.addText('Key Takeaways', {
      x: 0.5,
      y: 0.15,
      w: 9,
      h: 0.5,
      fontSize: 24,
      fontFace: 'Arial',
      color: 'FFFFFF',
      bold: true,
    });

    const summaryRows = lessonData.summaryPoints.map((point) => ({
      text: point,
      options: { bullet: { type: 'bullet' as const, color: themeColors.accent }, fontSize: 16, color: themeColors.text },
    }));

    summarySlide.addText(summaryRows, {
      x: 0.5,
      y: 1.2,
      w: 9,
      h: 4,
      fontFace: 'Arial',
      valign: 'top',
    });
  }

  // ========== TEACHER NOTES SLIDE ==========
  if (options.includeTeacherNotes && lessonData?.teacherNotes) {
    const notesSlide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
    notesSlide.addText('Teacher Notes', {
      x: 0.5,
      y: 0.15,
      w: 9,
      h: 0.5,
      fontSize: 24,
      fontFace: 'Arial',
      color: 'FFFFFF',
      bold: true,
    });

    // Yellow background box for teacher notes
    notesSlide.addShape(pptx.ShapeType.rect, {
      x: 0.3,
      y: 1,
      w: 9.4,
      h: 4.2,
      fill: { color: 'FEF3C7' },
      line: { color: 'F59E0B', width: 2 },
    });

    notesSlide.addText(truncateText(lessonData.teacherNotes, 800), {
      x: 0.5,
      y: 1.2,
      w: 9,
      h: 4,
      fontSize: 14,
      fontFace: 'Arial',
      color: '92400E',
      valign: 'top',
    });
  }

  // ========== CLOSING SLIDE ==========
  const closingSlide = pptx.addSlide({ masterName: 'TITLE_SLIDE' });
  closingSlide.addText('Thank You!', {
    x: 0.5,
    y: 2,
    w: 9,
    h: 1,
    fontSize: 44,
    fontFace: 'Arial',
    color: 'FFFFFF',
    bold: true,
    align: 'center',
  });
  closingSlide.addText('Created with Orbit Learn', {
    x: 0.5,
    y: 3.5,
    w: 9,
    h: 0.5,
    fontSize: 18,
    fontFace: 'Arial',
    color: 'FFFFFF',
    align: 'center',
  });
  closingSlide.addText(new Date().toLocaleDateString(), {
    x: 0.5,
    y: 4.2,
    w: 9,
    h: 0.4,
    fontSize: 14,
    fontFace: 'Arial',
    color: 'FFFFFF',
    align: 'center',
  });

  // Generate file
  const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;

  // Clean title for filename
  const cleanTitle = content.title
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 50);

  return {
    data: pptxBuffer,
    filename: `${cleanTitle} - Orbit Learn.pptx`,
  };
}

export default {
  generateLessonPPTX,
};
