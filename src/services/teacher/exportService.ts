/**
 * Export Service for Teacher Content
 * Generates PDF exports of lessons, quizzes, flashcards, and study guides
 */

import puppeteer from 'puppeteer';
import { TeacherContent, Subject } from '@prisma/client';

// Types for content structures
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

interface StudyGuideContent {
  title: string;
  summary?: string;
  outline?: Array<{ section: string; points: string[] }>;
  keyTerms?: Array<{ term: string; definition: string }>;
  reviewQuestions?: string[];
}

export interface ExportOptions {
  format?: 'pdf' | 'html';
  includeAnswers?: boolean;
  includeTeacherNotes?: boolean;
  paperSize?: 'letter' | 'a4';
  colorScheme?: 'color' | 'grayscale';
}

// Subject colors for styling - matches the Prisma Subject enum
const subjectColors: Record<Subject, { primary: string; secondary: string; accent: string }> = {
  MATH: { primary: '#3B82F6', secondary: '#DBEAFE', accent: '#1D4ED8' },
  ENGLISH: { primary: '#8B5CF6', secondary: '#EDE9FE', accent: '#6D28D9' },
  SCIENCE: { primary: '#10B981', secondary: '#D1FAE5', accent: '#047857' },
  SOCIAL_STUDIES: { primary: '#F59E0B', secondary: '#FEF3C7', accent: '#D97706' },
  ARABIC: { primary: '#059669', secondary: '#D1FAE5', accent: '#047857' },
  ISLAMIC_STUDIES: { primary: '#047857', secondary: '#ECFDF5', accent: '#065F46' },
  ART: { primary: '#EC4899', secondary: '#FCE7F3', accent: '#BE185D' },
  MUSIC: { primary: '#6366F1', secondary: '#E0E7FF', accent: '#4338CA' },
  OTHER: { primary: '#6B7280', secondary: '#F3F4F6', accent: '#4B5563' },
};

/**
 * Generate base CSS styles for exports
 */
function getBaseStyles(subject: Subject, colorScheme: 'color' | 'grayscale' = 'color'): string {
  const colors = colorScheme === 'color' ? subjectColors[subject] : {
    primary: '#374151',
    secondary: '#F3F4F6',
    accent: '#1F2937',
  };

  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1F2937;
      padding: 0.5in;
    }

    .header {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 3px solid ${colors.primary};
    }

    .header h1 {
      font-size: 24pt;
      font-weight: 700;
      color: ${colors.primary};
      margin-bottom: 8px;
    }

    .header .meta {
      display: flex;
      justify-content: center;
      gap: 24px;
      font-size: 10pt;
      color: #6B7280;
    }

    .header .meta span {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: ${colors.secondary};
      color: ${colors.accent};
      border-radius: 16px;
      font-size: 9pt;
      font-weight: 600;
    }

    .section {
      margin-bottom: 24px;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 14pt;
      font-weight: 600;
      color: ${colors.primary};
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 2px solid ${colors.secondary};
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-title .icon {
      font-size: 16pt;
    }

    .objectives-list {
      list-style: none;
      padding: 0;
    }

    .objectives-list li {
      padding: 8px 12px;
      margin-bottom: 8px;
      background: ${colors.secondary};
      border-left: 4px solid ${colors.primary};
      border-radius: 0 8px 8px 0;
    }

    .lesson-section {
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .lesson-section h3 {
      font-size: 12pt;
      font-weight: 600;
      color: ${colors.accent};
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .lesson-section .duration {
      font-size: 9pt;
      color: #6B7280;
      font-weight: 400;
    }

    .lesson-section .content {
      color: #374151;
      margin-bottom: 12px;
    }

    .activities {
      background: ${colors.secondary};
      border-radius: 8px;
      padding: 12px;
      margin-top: 8px;
    }

    .activities h4 {
      font-size: 10pt;
      font-weight: 600;
      color: ${colors.accent};
      margin-bottom: 8px;
    }

    .activities ul {
      margin-left: 16px;
    }

    .activities li {
      margin-bottom: 4px;
      color: #4B5563;
    }

    .vocabulary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .vocabulary-card {
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      padding: 12px;
    }

    .vocabulary-card .term {
      font-weight: 600;
      color: ${colors.primary};
      margin-bottom: 4px;
    }

    .vocabulary-card .definition {
      font-size: 10pt;
      color: #4B5563;
    }

    .vocabulary-card .example {
      font-size: 9pt;
      color: #6B7280;
      font-style: italic;
      margin-top: 4px;
    }

    .question-card {
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      page-break-inside: avoid;
    }

    .question-card .number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: ${colors.primary};
      color: white;
      border-radius: 50%;
      font-weight: 600;
      font-size: 10pt;
      margin-right: 8px;
    }

    .question-card .question-text {
      font-weight: 500;
      color: #1F2937;
      margin-bottom: 12px;
    }

    .question-card .meta-row {
      display: flex;
      gap: 12px;
      margin-bottom: 8px;
      font-size: 9pt;
    }

    .options-list {
      list-style: none;
      padding: 0;
      margin-top: 8px;
    }

    .options-list li {
      padding: 8px 12px;
      margin-bottom: 6px;
      background: #F9FAFB;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .options-list li.correct {
      background: #D1FAE5;
      border-color: #10B981;
    }

    .option-letter {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: #E5E7EB;
      border-radius: 50%;
      font-weight: 600;
      font-size: 9pt;
    }

    .correct .option-letter {
      background: #10B981;
      color: white;
    }

    .answer-section {
      margin-top: 12px;
      padding: 12px;
      background: #ECFDF5;
      border-radius: 8px;
      border-left: 4px solid #10B981;
    }

    .answer-section .label {
      font-weight: 600;
      color: #047857;
      font-size: 9pt;
      margin-bottom: 4px;
    }

    .answer-section .answer {
      color: #065F46;
    }

    .answer-section .explanation {
      margin-top: 8px;
      font-size: 10pt;
      color: #4B5563;
    }

    .flashcard {
      background: #FFFFFF;
      border: 2px solid ${colors.primary};
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      page-break-inside: avoid;
    }

    .flashcard .front {
      font-size: 12pt;
      font-weight: 600;
      color: ${colors.primary};
      padding-bottom: 12px;
      margin-bottom: 12px;
      border-bottom: 1px dashed #E5E7EB;
    }

    .flashcard .back {
      color: #374151;
    }

    .flashcard .hint {
      margin-top: 8px;
      font-size: 9pt;
      color: #6B7280;
      font-style: italic;
    }

    .flashcard .category {
      margin-top: 8px;
      display: inline-block;
      padding: 2px 8px;
      background: ${colors.secondary};
      color: ${colors.accent};
      border-radius: 12px;
      font-size: 8pt;
    }

    .teacher-notes {
      background: #FEF3C7;
      border: 1px solid #F59E0B;
      border-radius: 12px;
      padding: 16px;
      margin-top: 24px;
    }

    .teacher-notes h3 {
      color: #D97706;
      font-size: 12pt;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .teacher-notes .content {
      color: #92400E;
      font-size: 10pt;
    }

    .summary-box {
      background: ${colors.secondary};
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
    }

    .summary-box p {
      color: #374151;
      line-height: 1.7;
    }

    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #E5E7EB;
      text-align: center;
      font-size: 9pt;
      color: #9CA3AF;
    }

    .page-break {
      page-break-before: always;
    }

    @media print {
      body {
        padding: 0;
      }

      .section {
        page-break-inside: avoid;
      }

      .question-card, .flashcard, .lesson-section {
        page-break-inside: avoid;
      }
    }
  `;
}

/**
 * Generate HTML for lesson content
 */
function generateLessonHTML(
  content: TeacherContent,
  lessonData: LessonContent,
  options: ExportOptions
): string {
  const subject = (content.subject || 'OTHER') as Subject;
  const styles = getBaseStyles(subject, options.colorScheme);

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${lessonData.title || content.title}</title>
      <style>${styles}</style>
    </head>
    <body>
      <div class="header">
        <h1>${lessonData.title || content.title}</h1>
        <div class="meta">
          <span class="badge">${(content.subject || 'OTHER').replace('_', ' ')}</span>
          <span>Grade: ${content.gradeLevel}</span>
          <span>Created: ${new Date(content.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
  `;

  // Summary
  if (lessonData.summary) {
    html += `
      <div class="summary-box">
        <p>${lessonData.summary}</p>
      </div>
    `;
  }

  // Learning Objectives
  if (lessonData.objectives && lessonData.objectives.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">🎯</span> Learning Objectives</h2>
        <ul class="objectives-list">
          ${lessonData.objectives.map(obj => `<li>${obj}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Lesson Sections
  if (lessonData.sections && lessonData.sections.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">📚</span> Lesson Content</h2>
        ${lessonData.sections.map((section, i) => `
          <div class="lesson-section">
            <h3>
              ${i + 1}. ${section.title}
              ${section.duration ? `<span class="duration">⏱ ${section.duration} min</span>` : ''}
            </h3>
            <div class="content">${section.content}</div>
            ${section.activities && section.activities.length > 0 ? `
              <div class="activities">
                <h4>📝 Activities</h4>
                ${section.activities.map(act => {
                  if (typeof act === 'string') {
                    return `<ul><li>${act}</li></ul>`;
                  }
                  // Handle activity object format from full lessons
                  const actObj = act as ActivityObject;
                  return `
                    <div class="activity-item" style="margin-bottom: 12px; padding: 12px; background: white; border-radius: 8px;">
                      ${actObj.name ? `<div style="font-weight: 600; margin-bottom: 4px;">${actObj.name}</div>` : ''}
                      ${actObj.description ? `<div style="margin-bottom: 8px;">${actObj.description}</div>` : ''}
                      ${actObj.duration ? `<div style="font-size: 9pt; color: #6B7280;">⏱ ${actObj.duration} min</div>` : ''}
                      ${actObj.materials && actObj.materials.length > 0 ? `
                        <div style="margin-top: 8px;">
                          <div style="font-size: 9pt; font-weight: 500; color: #4B5563;">Materials:</div>
                          <ul style="margin: 4px 0 0 16px; font-size: 10pt;">
                            ${actObj.materials.map(m => `<li>${m}</li>`).join('')}
                          </ul>
                        </div>
                      ` : ''}
                      ${actObj.discussionQuestions && actObj.discussionQuestions.length > 0 ? `
                        <div style="margin-top: 8px;">
                          <div style="font-size: 9pt; font-weight: 500; color: #4B5563;">Discussion Questions:</div>
                          <ul style="margin: 4px 0 0 16px; font-size: 10pt;">
                            ${actObj.discussionQuestions.map(q => `<li>${q}</li>`).join('')}
                          </ul>
                        </div>
                      ` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Vocabulary
  if (lessonData.vocabulary && lessonData.vocabulary.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">📖</span> Vocabulary</h2>
        <div class="vocabulary-grid">
          ${lessonData.vocabulary.map(vocab => `
            <div class="vocabulary-card">
              <div class="term">${vocab.term}</div>
              <div class="definition">${vocab.definition}</div>
              ${vocab.example ? `<div class="example">Example: ${vocab.example}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Assessment Questions
  if (lessonData.assessment?.questions && lessonData.assessment.questions.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">✅</span> Assessment Questions</h2>
        ${lessonData.assessment.questions.map((q, i) => `
          <div class="question-card">
            <div class="question-text">
              <span class="number">${i + 1}</span>
              ${q.question}
            </div>
            ${q.options && q.options.length > 0 ? `
              <ul class="options-list">
                ${q.options.map((opt, j) => `
                  <li class="${options.includeAnswers && opt === q.correctAnswer ? 'correct' : ''}">
                    <span class="option-letter">${String.fromCharCode(65 + j)}</span>
                    ${opt}
                  </li>
                `).join('')}
              </ul>
            ` : ''}
            ${options.includeAnswers ? `
              <div class="answer-section">
                <div class="label">Answer:</div>
                <div class="answer">${q.correctAnswer}</div>
                ${q.explanation ? `<div class="explanation">${q.explanation}</div>` : ''}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Practice Exercises (for full lessons)
  if (lessonData.practiceExercises && lessonData.practiceExercises.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">✏️</span> Practice Exercises</h2>
        ${lessonData.practiceExercises.map((ex, i) => `
          <div class="question-card">
            <div class="question-text">
              <span class="number">${i + 1}</span>
              ${ex.question}
            </div>
            ${ex.hint ? `<div style="font-size: 10pt; color: #6B7280; margin-top: 8px;">💡 Hint: ${ex.hint}</div>` : ''}
            ${options.includeAnswers && ex.answer ? `
              <div class="answer-section">
                <div class="label">Answer:</div>
                <div class="answer">${ex.answer}</div>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Summary Points (for full lessons)
  if (lessonData.summaryPoints && lessonData.summaryPoints.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">📌</span> Key Takeaways</h2>
        <ul class="objectives-list">
          ${lessonData.summaryPoints.map(point => `<li>${point}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Review Questions (for full lessons)
  if (lessonData.reviewQuestions && lessonData.reviewQuestions.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">❓</span> Review Questions</h2>
        <ol style="padding-left: 20px;">
          ${lessonData.reviewQuestions.map(q => `<li style="margin-bottom: 12px;">${q}</li>`).join('')}
        </ol>
      </div>
    `;
  }

  // Prerequisites and Next Steps (for full lessons)
  if (lessonData.prerequisites || lessonData.nextSteps) {
    html += `
      <div class="section" style="background: #F9FAFB; border-radius: 12px; padding: 16px; margin-top: 20px;">
        ${lessonData.prerequisites && lessonData.prerequisites.length > 0 ? `
          <div style="margin-bottom: 12px;">
            <h3 style="font-size: 11pt; color: #4B5563; margin-bottom: 8px;">📚 Prerequisites</h3>
            <ul style="margin-left: 16px; color: #6B7280; font-size: 10pt;">
              ${lessonData.prerequisites.map(p => `<li>${p}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${lessonData.nextSteps ? `
          <div>
            <h3 style="font-size: 11pt; color: #4B5563; margin-bottom: 8px;">➡️ What's Next</h3>
            <p style="color: #6B7280; font-size: 10pt;">${lessonData.nextSteps}</p>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Additional Resources (for full lessons)
  if (lessonData.additionalResources && lessonData.additionalResources.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">🔗</span> Additional Resources</h2>
        <ul style="padding-left: 20px;">
          ${lessonData.additionalResources.map(r => `<li style="margin-bottom: 8px;">${r}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Teacher Notes
  if (options.includeTeacherNotes && lessonData.teacherNotes) {
    html += `
      <div class="teacher-notes">
        <h3>📋 Teacher Notes</h3>
        <div class="content">${lessonData.teacherNotes}</div>
      </div>
    `;
  }

  html += `
      <div class="footer">
        Generated by Orbit Learn • ${new Date().toLocaleDateString()}
      </div>
    </body>
    </html>
  `;

  return html;
}

/**
 * Generate HTML for quiz content
 */
function generateQuizHTML(
  content: TeacherContent,
  quizData: QuizContent,
  options: ExportOptions
): string {
  const subject = (content.subject || 'OTHER') as Subject;
  const styles = getBaseStyles(subject, options.colorScheme);

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${quizData.title || content.title} - Quiz</title>
      <style>${styles}</style>
    </head>
    <body>
      <div class="header">
        <h1>${quizData.title || content.title}</h1>
        <div class="meta">
          <span class="badge">${(content.subject || 'OTHER').replace('_', ' ')}</span>
          <span>Grade: ${content.gradeLevel}</span>
          ${quizData.totalPoints ? `<span>Total Points: ${quizData.totalPoints}</span>` : ''}
          ${quizData.estimatedTime ? `<span>⏱ ${quizData.estimatedTime} min</span>` : ''}
        </div>
      </div>

      <div class="section">
        <h2 class="section-title"><span class="icon">📝</span> Questions</h2>
        ${quizData.questions.map((q, i) => `
          <div class="question-card">
            <div class="question-text">
              <span class="number">${i + 1}</span>
              ${q.question}
            </div>
            <div class="meta-row">
              <span class="badge">${q.type.replace('_', ' ')}</span>
              ${q.difficulty ? `<span class="badge">${q.difficulty}</span>` : ''}
              ${q.points ? `<span>${q.points} pts</span>` : ''}
            </div>
            ${q.options && q.options.length > 0 ? `
              <ul class="options-list">
                ${q.options.map((opt, j) => `
                  <li class="${options.includeAnswers && opt === q.correctAnswer ? 'correct' : ''}">
                    <span class="option-letter">${String.fromCharCode(65 + j)}</span>
                    ${opt}
                  </li>
                `).join('')}
              </ul>
            ` : ''}
            ${options.includeAnswers ? `
              <div class="answer-section">
                <div class="label">Correct Answer:</div>
                <div class="answer">${q.correctAnswer}</div>
                ${q.explanation ? `<div class="explanation">${q.explanation}</div>` : ''}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>

      <div class="footer">
        Generated by Orbit Learn • ${new Date().toLocaleDateString()}
      </div>
    </body>
    </html>
  `;

  return html;
}

/**
 * Generate HTML for flashcard content
 */
function generateFlashcardHTML(
  content: TeacherContent,
  flashcardData: FlashcardContent,
  options: ExportOptions
): string {
  const subject = (content.subject || 'OTHER') as Subject;
  const styles = getBaseStyles(subject, options.colorScheme);

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${flashcardData.title || content.title} - Flashcards</title>
      <style>${styles}</style>
    </head>
    <body>
      <div class="header">
        <h1>${flashcardData.title || content.title}</h1>
        <div class="meta">
          <span class="badge">${(content.subject || 'OTHER').replace('_', ' ')}</span>
          <span>Grade: ${content.gradeLevel}</span>
          <span>${flashcardData.cards.length} Cards</span>
        </div>
      </div>

      <div class="section">
        <h2 class="section-title"><span class="icon">🃏</span> Flashcards</h2>
        ${flashcardData.cards.map((card, i) => `
          <div class="flashcard">
            <div class="front">
              <strong>Card ${i + 1}:</strong> ${card.front}
            </div>
            <div class="back">${card.back}</div>
            ${card.hint ? `<div class="hint">💡 Hint: ${card.hint}</div>` : ''}
            ${card.category ? `<span class="category">${card.category}</span>` : ''}
          </div>
        `).join('')}
      </div>

      <div class="footer">
        Generated by Orbit Learn • ${new Date().toLocaleDateString()}
      </div>
    </body>
    </html>
  `;

  return html;
}

/**
 * Generate HTML for study guide content
 */
function generateStudyGuideHTML(
  content: TeacherContent,
  guideData: StudyGuideContent,
  options: ExportOptions
): string {
  const subject = (content.subject || 'OTHER') as Subject;
  const styles = getBaseStyles(subject, options.colorScheme);

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${guideData.title || content.title} - Study Guide</title>
      <style>${styles}</style>
    </head>
    <body>
      <div class="header">
        <h1>${guideData.title || content.title}</h1>
        <div class="meta">
          <span class="badge">${(content.subject || 'OTHER').replace('_', ' ')}</span>
          <span>Grade: ${content.gradeLevel}</span>
          <span class="badge">Study Guide</span>
        </div>
      </div>
  `;

  // Summary
  if (guideData.summary) {
    html += `
      <div class="summary-box">
        <p>${guideData.summary}</p>
      </div>
    `;
  }

  // Outline
  if (guideData.outline && guideData.outline.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">📋</span> Outline</h2>
        ${guideData.outline.map((section, i) => `
          <div class="lesson-section">
            <h3>${i + 1}. ${section.section}</h3>
            <ul>
              ${section.points.map(point => `<li>${point}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Key Terms
  if (guideData.keyTerms && guideData.keyTerms.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">📖</span> Key Terms</h2>
        <div class="vocabulary-grid">
          ${guideData.keyTerms.map(term => `
            <div class="vocabulary-card">
              <div class="term">${term.term}</div>
              <div class="definition">${term.definition}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Review Questions
  if (guideData.reviewQuestions && guideData.reviewQuestions.length > 0) {
    html += `
      <div class="section">
        <h2 class="section-title"><span class="icon">❓</span> Review Questions</h2>
        <ol>
          ${guideData.reviewQuestions.map(q => `<li style="margin-bottom: 12px;">${q}</li>`).join('')}
        </ol>
      </div>
    `;
  }

  html += `
      <div class="footer">
        Generated by Orbit Learn • ${new Date().toLocaleDateString()}
      </div>
    </body>
    </html>
  `;

  return html;
}

/**
 * Main export function - generates HTML or PDF from TeacherContent
 */
export async function exportContent(
  content: TeacherContent,
  options: ExportOptions = {}
): Promise<{ data: Buffer | string; mimeType: string; filename: string }> {
  const opts: ExportOptions = {
    format: options.format ?? 'pdf',
    includeAnswers: options.includeAnswers ?? true,
    includeTeacherNotes: options.includeTeacherNotes ?? true,
    paperSize: options.paperSize ?? 'letter',
    colorScheme: options.colorScheme ?? 'color',
  };

  let html: string;
  let filename: string;
  const contentType = content.contentType;
  // Clean title for filename: replace non-alphanumeric with spaces, collapse multiple spaces, trim
  const cleanTitle = content.title
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 50);

  // Generate HTML based on content type
  switch (contentType) {
    case 'LESSON':
    case 'WORKSHEET':
      const lessonData = content.lessonContent as unknown as LessonContent;
      html = generateLessonHTML(content, lessonData || { title: content.title }, opts);
      filename = `${cleanTitle} - Orbit Learn`;
      break;

    case 'QUIZ':
      const quizData = content.quizContent as unknown as QuizContent;
      html = generateQuizHTML(content, quizData || { title: content.title, questions: [] }, opts);
      filename = `${cleanTitle} - Orbit Learn`;
      break;

    case 'FLASHCARD_DECK':
      const flashcardData = content.flashcardContent as unknown as FlashcardContent;
      html = generateFlashcardHTML(content, flashcardData || { title: content.title, cards: [] }, opts);
      filename = `${cleanTitle} - Orbit Learn`;
      break;

    case 'STUDY_GUIDE':
      const guideData = content.lessonContent as unknown as StudyGuideContent;
      html = generateStudyGuideHTML(content, guideData || { title: content.title }, opts);
      filename = `${cleanTitle} - Orbit Learn`;
      break;

    default:
      // Default to lesson format
      const defaultData = content.lessonContent as unknown as LessonContent;
      html = generateLessonHTML(content, defaultData || { title: content.title }, opts);
      filename = `${cleanTitle} - Orbit Learn`;
  }

  // Return HTML if requested
  if (opts.format === 'html') {
    return {
      data: html,
      mimeType: 'text/html',
      filename: `${filename}.html`,
    };
  }

  // Generate PDF using Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: opts.paperSize === 'a4' ? 'A4' : 'Letter',
      printBackground: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in',
      },
    });

    return {
      data: Buffer.from(pdfBuffer),
      mimeType: 'application/pdf',
      filename: `${filename}.pdf`,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Export multiple content items as a single PDF
 */
export async function exportMultipleContent(
  contents: TeacherContent[],
  options: ExportOptions = { format: 'pdf' }
): Promise<{ data: Buffer; mimeType: string; filename: string }> {
  // Generate HTML for each content item
  const htmlParts: string[] = [];

  for (const content of contents) {
    const result = await exportContent(content, { ...options, format: 'html' });
    // Extract body content only (strip html/head tags)
    const bodyMatch = (result.data as string).match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      htmlParts.push(bodyMatch[1]);
    }
  }

  // Combine into single HTML
  const combinedHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Content Export</title>
      <style>${getBaseStyles('OTHER', options.colorScheme)}</style>
    </head>
    <body>
      ${htmlParts.join('<div class="page-break"></div>')}
    </body>
    </html>
  `;

  // Generate PDF
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(combinedHtml, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: options.paperSize === 'a4' ? 'A4' : 'Letter',
      printBackground: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in',
      },
    });

    return {
      data: Buffer.from(pdfBuffer),
      mimeType: 'application/pdf',
      filename: `Orbit_Learn_Export_${new Date().toISOString().split('T')[0]}.pdf`,
    };
  } finally {
    await browser.close();
  }
}

export default {
  exportContent,
  exportMultipleContent,
};
