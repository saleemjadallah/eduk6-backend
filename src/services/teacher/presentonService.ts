/**
 * Presenton API Service for Teacher Content
 * Generates professional PPTX presentations using Presenton AI API
 * https://docs.presenton.ai/
 */

import { TeacherContent, Subject } from '@prisma/client';

// Presenton API configuration
const PRESENTON_API_URL = 'https://api.presenton.ai/api/v1/ppt/presentation/generate';
const PRESENTON_API_KEY = process.env.PRESENTON_API_KEY;

// Export options interface
export interface PresentonExportOptions {
  theme: 'professional-blue' | 'professional-dark' | 'edge-yellow' | 'light-rose' | 'mint-blue';
  slideStyle: 'focused' | 'dense';
  includeAnswers: boolean;
  includeTeacherNotes: boolean;
  includeInfographic: boolean;
  language: string;
}

// Presenton API request interface
interface PresentonRequest {
  content: string;
  instructions?: string;
  tone: 'default' | 'casual' | 'professional' | 'funny' | 'educational' | 'sales_pitch';
  verbosity: 'concise' | 'standard' | 'text-heavy';
  web_search: boolean;
  image_type: 'stock' | 'ai-generated';
  theme?: string;
  n_slides: number;
  language: string;
  template: string;
  include_table_of_contents: boolean;
  include_title_slide: boolean;
  export_as: 'pptx' | 'pdf';
}

// Presenton API response interface
interface PresentonResponse {
  presentation_id: string;
  path: string;
  edit_path: string;
  credits_consumed: number;
}

// Types for lesson content structure
interface LessonSection {
  title: string;
  content: string;
  duration?: number;
  activities?: (string | { name?: string; description?: string })[];
  teachingTips?: string[];
}

interface VocabularyItem {
  term: string;
  definition: string;
  example?: string;
}

interface AssessmentQuestion {
  question: string;
  type: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
}

interface LessonContent {
  title: string;
  summary?: string;
  objectives?: string[];
  sections?: LessonSection[];
  vocabulary?: VocabularyItem[];
  assessment?: {
    questions: AssessmentQuestion[];
  };
  teacherNotes?: string;
  summaryPoints?: string[];
  prerequisites?: string[];
  nextSteps?: string;
}

/**
 * Format lesson content into a structured prompt for Presenton
 */
function formatLessonContent(
  content: TeacherContent,
  options: PresentonExportOptions
): string {
  const lessonData = content.lessonContent as unknown as LessonContent;
  const subject = (content.subject || 'OTHER').replace('_', ' ');

  let prompt = `Create a professional educational presentation for the following lesson:\n\n`;

  // Title and metadata
  prompt += `# ${lessonData?.title || content.title}\n`;
  prompt += `Subject: ${subject}\n`;
  prompt += `Grade Level: ${content.gradeLevel}\n\n`;

  // Summary
  if (lessonData?.summary) {
    prompt += `## Overview\n${lessonData.summary}\n\n`;
  }

  // Learning Objectives
  if (lessonData?.objectives && lessonData.objectives.length > 0) {
    prompt += `## Learning Objectives\n`;
    lessonData.objectives.forEach((obj, i) => {
      prompt += `${i + 1}. ${obj}\n`;
    });
    prompt += '\n';
  }

  // Prerequisites
  if (lessonData?.prerequisites && lessonData.prerequisites.length > 0) {
    prompt += `## Prerequisites\n`;
    lessonData.prerequisites.forEach(prereq => {
      prompt += `- ${prereq}\n`;
    });
    prompt += '\n';
  }

  // Main Sections
  if (lessonData?.sections && lessonData.sections.length > 0) {
    prompt += `## Lesson Content\n\n`;
    lessonData.sections.forEach((section, index) => {
      prompt += `### ${index + 1}. ${section.title}\n`;
      if (section.duration) {
        prompt += `Duration: ${section.duration} minutes\n`;
      }
      prompt += `${section.content}\n\n`;

      // Activities
      if (section.activities && section.activities.length > 0) {
        prompt += `**Activities:**\n`;
        section.activities.forEach(act => {
          if (typeof act === 'string') {
            prompt += `- ${act}\n`;
          } else {
            prompt += `- ${act.name || act.description || 'Activity'}\n`;
          }
        });
        prompt += '\n';
      }

      // Teaching Tips (only if includeTeacherNotes)
      if (options.includeTeacherNotes && section.teachingTips && section.teachingTips.length > 0) {
        prompt += `**Teaching Tips:**\n`;
        section.teachingTips.forEach(tip => {
          prompt += `- ${tip}\n`;
        });
        prompt += '\n';
      }
    });
  }

  // Vocabulary
  if (lessonData?.vocabulary && lessonData.vocabulary.length > 0) {
    prompt += `## Key Vocabulary\n`;
    lessonData.vocabulary.forEach(vocab => {
      prompt += `- **${vocab.term}**: ${vocab.definition}`;
      if (vocab.example) {
        prompt += ` (Example: ${vocab.example})`;
      }
      prompt += '\n';
    });
    prompt += '\n';
  }

  // Assessment Questions
  if (lessonData?.assessment?.questions && lessonData.assessment.questions.length > 0) {
    prompt += `## Assessment Questions\n`;
    lessonData.assessment.questions.forEach((q, i) => {
      prompt += `${i + 1}. ${q.question}\n`;
      if (q.options && q.options.length > 0) {
        q.options.forEach((opt, j) => {
          const letter = String.fromCharCode(65 + j);
          prompt += `   ${letter}. ${opt}\n`;
        });
      }
      if (options.includeAnswers) {
        prompt += `   **Answer: ${q.correctAnswer}**\n`;
        if (q.explanation) {
          prompt += `   Explanation: ${q.explanation}\n`;
        }
      }
      prompt += '\n';
    });
  }

  // Summary Points
  if (lessonData?.summaryPoints && lessonData.summaryPoints.length > 0) {
    prompt += `## Key Takeaways\n`;
    lessonData.summaryPoints.forEach(point => {
      prompt += `- ${point}\n`;
    });
    prompt += '\n';
  }

  // Teacher Notes (only if includeTeacherNotes)
  if (options.includeTeacherNotes && lessonData?.teacherNotes) {
    prompt += `## Teacher Notes\n${lessonData.teacherNotes}\n\n`;
  }

  // Next Steps
  if (lessonData?.nextSteps) {
    prompt += `## Next Steps\n${lessonData.nextSteps}\n`;
  }

  // Infographic mention
  if (options.includeInfographic && content.infographicUrl) {
    prompt += `\n## Visual Summary\nInclude a visual summary slide with an infographic-style layout summarizing the key concepts.\n`;
  }

  return prompt;
}

/**
 * Calculate number of slides based on content and style
 */
function calculateSlideCount(content: TeacherContent, options: PresentonExportOptions): number {
  const lessonData = content.lessonContent as unknown as LessonContent;

  // Base slides: title + objectives + summary
  let slides = 3;

  // Section slides
  const sectionCount = lessonData?.sections?.length || 0;
  if (options.slideStyle === 'focused') {
    // More slides - one per section + extras for activities
    slides += sectionCount * 2;
  } else {
    // Dense - combine sections
    slides += Math.ceil(sectionCount / 2);
  }

  // Vocabulary slide(s)
  const vocabCount = lessonData?.vocabulary?.length || 0;
  if (vocabCount > 0) {
    slides += options.slideStyle === 'focused' ? Math.ceil(vocabCount / 4) : 1;
  }

  // Assessment slide(s)
  const questionCount = lessonData?.assessment?.questions?.length || 0;
  if (questionCount > 0) {
    slides += options.slideStyle === 'focused' ? Math.ceil(questionCount / 2) : 1;
  }

  // Summary/takeaways slide
  if (lessonData?.summaryPoints && lessonData.summaryPoints.length > 0) {
    slides += 1;
  }

  // Infographic slide
  if (options.includeInfographic && content.infographicUrl) {
    slides += 1;
  }

  // Closing slide
  slides += 1;

  // Cap at reasonable limits
  return Math.min(Math.max(slides, 8), 25);
}

/**
 * Generate PowerPoint using Presenton API
 */
export async function generateLessonPPTX(
  content: TeacherContent,
  options: PresentonExportOptions
): Promise<{ data: Buffer; filename: string }> {
  if (!PRESENTON_API_KEY) {
    throw new Error('PRESENTON_API_KEY is not configured');
  }

  // Format the lesson content into a prompt
  const lessonPrompt = formatLessonContent(content, options);

  // Calculate appropriate slide count
  const slideCount = calculateSlideCount(content, options);

  // Prepare the API request
  const requestBody: PresentonRequest = {
    content: lessonPrompt,
    instructions: `Create a visually engaging educational presentation suitable for Grade ${content.gradeLevel} students.
Use clear headings, bullet points, and visual elements.
Keep text concise and readable.
Include relevant icons and imagery where appropriate.
Make the presentation suitable for classroom teaching.`,
    tone: 'educational',
    verbosity: options.slideStyle === 'dense' ? 'concise' : 'standard',
    web_search: false,
    image_type: 'stock',
    theme: options.theme,
    n_slides: slideCount,
    language: options.language || 'English',
    template: 'modern',
    include_table_of_contents: false,
    include_title_slide: true,
    export_as: 'pptx',
  };

  console.log(`[Presenton] Generating presentation with ${slideCount} slides...`);

  // Call Presenton API
  const response = await fetch(PRESENTON_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PRESENTON_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Presenton] API error:', response.status, errorText);
    throw new Error(`Presenton API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json() as PresentonResponse;
  console.log(`[Presenton] Presentation generated: ${result.presentation_id}, credits used: ${result.credits_consumed}`);

  // Download the generated PPTX file
  const fileUrl = result.path;
  console.log(`[Presenton] Downloading PPTX from: ${fileUrl}`);

  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download PPTX: ${fileResponse.status}`);
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const pptxBuffer = Buffer.from(arrayBuffer);

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
