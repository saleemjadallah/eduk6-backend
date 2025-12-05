/**
 * Document Formatter Service
 *
 * Deterministic, 100% reliable document formatting for educational content.
 * Ported from frontend smartTextFormatter.js with enhancements for:
 * - AI-extracted metadata integration (chapters, vocabulary, exercises)
 * - Age-appropriate styling
 * - Exercise location marking
 *
 * This replaces the unreliable Gemini AI formatting call.
 */

import { AgeGroup } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { MathFormatter } from './mathFormatter.js';
import { StructuredRenderer } from './structuredRenderer.js';
import type { ContentBlock, StructuredContent } from './contentBlocks.js';
import { validateBlocks } from './contentBlocks.js';

// ============================================================================
// TYPES
// ============================================================================

export interface Chapter {
  title: string;
  content?: string;
  keyPoints?: string[];
}

export interface VocabularyItem {
  term: string;
  definition: string;
  example?: string;
}

export interface Exercise {
  id: string;
  type: 'MATH_PROBLEM' | 'FILL_IN_BLANK' | 'SHORT_ANSWER' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  questionText: string;
  expectedAnswer: string;
  acceptableAnswers?: string[];
  hint1?: string;
  hint2?: string;
  explanation?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  locationInContent?: string;
}

export interface DocumentFormatterOptions {
  ageGroup: AgeGroup;
  chapters?: Chapter[];
  vocabulary?: VocabularyItem[];
  exercises?: Exercise[];
  // Rich content blocks from AI analysis (hybrid approach)
  contentBlocks?: ContentBlock[];
}

interface TextAnalysis {
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  hasBullets: boolean;
  hasPageMarkers: boolean;
  hasMetadata: boolean;
  hasNumberedSteps: boolean;
  hasEducationalKeywords: boolean;
  newlineRatio: number;
  needsRestoration: boolean;
}

interface SentenceBoundary {
  index: number;
  punctuation?: string;
  confidence: number;
  type: 'sentence' | 'paragraph' | 'section' | 'question';
  sectionName?: string;
}

interface HeaderCandidate {
  text: string;
  index: number;
  score: number;
  afterText: string;
}

interface HeaderMatch {
  type: 'h2' | 'h3';
  text: string;
}

interface ListItemMatch {
  type: 'bullet' | 'numbered' | 'lettered';
  text: string;
  number?: string;
  letter?: string;
}

// ============================================================================
// PATTERN DEFINITIONS
// ============================================================================

const PATTERNS = {
  // Section/Page markers
  sectionMarker: /\[(?:Section|Page)\s*(\d+)\]/gi,

  // Section headers
  sectionHeaders: [
    /^(Learning Objectives?|Objectives?|Goals?):?\s*$/i,
    /^(Prerequisites?|Requirements?|Before You Begin):?\s*$/i,
    /^(Key Concepts?|Important Concepts?|Main Ideas?):?\s*$/i,
    /^(Summary|Conclusion|Review|Recap):?\s*$/i,
    /^(Introduction|Overview|Background):?\s*$/i,
    /^(Examples?|Practice|Exercises?|Problems?|Activities?):?\s*$/i,
    /^(Steps?|Procedure|Instructions?|How To):?\s*$/i,
    /^(Definition|Formula|Rule|Theorem|Law):?\s*$/i,
    /^(Note|Tip|Remember|Important|Warning|Caution):?\s*$/i,
    /^(Materials?|Supplies|What You Need):?\s*$/i,
  ],

  // Numbered headers
  numberedHeader: /^((?:Step|Example|Part|Section|Chapter|Lesson|Unit|Question|Problem|Exercise)\s*\d+)\s*[:.)]\s*/i,

  // ALL CAPS headers
  allCapsHeader: /^([A-Z][A-Z\s]{5,})$/,

  // Title case headers
  titleCaseHeader: /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,5})\s*$/,

  // Bullet points
  bulletPoint: /^[\s]*[•·∙‣⁃○●◦▪▸\-*]\s*/,

  // Numbered list items
  numberedList: /^[\s]*(\d+)[.)]\s+/,

  // Lettered list items
  letteredList: /^[\s]*([a-zA-Z])[.)]\s+/,

  // Question patterns
  questionPattern: /^(What|Why|How|When|Where|Which|Who|Can|Do|Does|Is|Are|Will|Would|Should|Could)\s+.+\?$/i,

  // Metadata patterns
  durationPattern: /(?:Duration|Time|Length):\s*[\d-]+\s*(?:minutes?|mins?|hours?|hrs?)/i,
  gradeLevelPattern: /(?:Grade|Level|Year)(?:\s*Level)?:\s*(?:K|\d+)(?:st|nd|rd|th)?(?:\s*Grade)?/i,
  subjectPattern: /(?:Subject|Topic|Course):\s*[A-Za-z\s]+/i,
};

// ============================================================================
// DOCUMENT FORMATTER CLASS
// ============================================================================

export class DocumentFormatter {
  private mathFormatter: MathFormatter;
  private structuredRenderer: StructuredRenderer;

  constructor() {
    this.mathFormatter = new MathFormatter();
    this.structuredRenderer = new StructuredRenderer();
  }

  /**
   * Main formatting method - 100% reliable, deterministic output
   *
   * Hybrid approach:
   * 1. If contentBlocks are provided (from AI), use StructuredRenderer for beautiful output
   * 2. Otherwise, fall back to heuristic-based formatting
   */
  format(rawText: string, options: DocumentFormatterOptions): string {
    if (!rawText || typeof rawText !== 'string') {
      return '';
    }

    // HYBRID APPROACH: Use StructuredRenderer if AI provided content blocks
    if (options.contentBlocks && options.contentBlocks.length > 0) {
      const blockCount = options.contentBlocks.length;
      try {
        // Validate the content blocks
        if (validateBlocks(options.contentBlocks)) {
          logger.info('Using StructuredRenderer for AI-extracted content blocks', {
            blockCount,
            blockTypes: options.contentBlocks.map(b => b.type).slice(0, 10),
          });

          const structuredContent: StructuredContent = {
            blocks: options.contentBlocks,
          };

          this.structuredRenderer.setOptions({ ageGroup: options.ageGroup });
          return this.structuredRenderer.render(structuredContent);
        } else {
          logger.warn('Content blocks validation failed, falling back to heuristic formatting', {
            blockCount,
          });
        }
      } catch (error) {
        logger.warn('StructuredRenderer failed, falling back to heuristic formatting', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // FALLBACK: Use legacy heuristic-based formatting
    try {
      return this.fullFormat(rawText, options);
    } catch (error) {
      logger.warn('Full formatting failed, using basic format', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      try {
        return this.basicFormat(rawText);
      } catch (basicError) {
        logger.error('Basic formatting failed, using minimal safe format', {
          error: basicError instanceof Error ? basicError.message : 'Unknown error'
        });
        return this.minimalSafeFormat(rawText);
      }
    }
  }

  /**
   * Full formatting with all features
   */
  private fullFormat(rawText: string, options: DocumentFormatterOptions): string {
    // Step 1: Check if text needs line break restoration
    const analysis = this.analyzeText(rawText);
    let processed = rawText;

    if (analysis.needsRestoration) {
      processed = this.restoreLineBreaksSmart(processed);
    }

    // Step 2: Normalize and process section markers
    processed = processed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    processed = this.processSectionMarkers(processed);

    // Step 3: Convert to HTML
    let html = this.convertToHtml(processed, options);

    // Step 4: Apply chapter-based sectioning if available
    if (options.chapters && options.chapters.length > 0) {
      html = this.enhanceWithChapters(html, options.chapters);
    }

    // Step 5: Highlight vocabulary terms if available
    if (options.vocabulary && options.vocabulary.length > 0) {
      html = this.highlightVocabulary(html, options.vocabulary);
    }

    // Step 6: Mark exercise locations if available
    if (options.exercises && options.exercises.length > 0) {
      html = this.markExerciseLocations(html, options.exercises);
    }

    // Step 7: Add age-appropriate wrapper class
    const ageClass = options.ageGroup === 'YOUNG' ? 'age-young' : 'age-older';
    html = `<div class="formatted-content ${ageClass}">\n${html}\n</div>`;

    return html;
  }

  /**
   * Basic formatting fallback
   */
  private basicFormat(rawText: string): string {
    let processed = rawText;

    // Restore line breaks if needed
    const analysis = this.analyzeText(rawText);
    if (analysis.needsRestoration) {
      processed = this.restoreLineBreaksSmart(processed);
    }

    // Simple HTML conversion
    return this.convertToHtml(processed, { ageGroup: 'OLDER' });
  }

  /**
   * Minimal safe formatting that cannot fail
   */
  private minimalSafeFormat(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n\n+/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<div class="formatted-content"><p>')
      .replace(/$/, '</p></div>');
  }

  // ============================================================================
  // TEXT ANALYSIS
  // ============================================================================

  /**
   * Analyze text to understand its structure
   */
  private analyzeText(text: string): TextAnalysis {
    if (!text) {
      return {
        wordCount: 0,
        sentenceCount: 0,
        avgSentenceLength: 0,
        hasBullets: false,
        hasPageMarkers: false,
        hasMetadata: false,
        hasNumberedSteps: false,
        hasEducationalKeywords: false,
        newlineRatio: 0,
        needsRestoration: false,
      };
    }

    const words = text.split(/\s+/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const avgSentenceLength = sentences.length > 0 ? words.length / sentences.length : 0;

    const hasBullets = /[•·∙‣⁃○●◦▪▸]/.test(text);
    const hasPageMarkers = /\[Page\s*\d+\]/i.test(text);
    const hasMetadata = /(Grade Level|Subject|Topic|Duration):/i.test(text);
    const hasNumberedSteps = /(Step|Example|Problem)\s*\d+/i.test(text);
    const hasEducationalKeywords = /(Learning Objectives?|Prerequisites?|Key Concepts?|Summary|Vocabulary)/i.test(text);

    const newlineCount = (text.match(/\n/g) || []).length;
    const newlineRatio = text.length > 0 ? newlineCount / text.length : 0;

    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      avgSentenceLength,
      hasBullets,
      hasPageMarkers,
      hasMetadata,
      hasNumberedSteps,
      hasEducationalKeywords,
      newlineRatio,
      needsRestoration: newlineRatio < 0.002 && text.length > 100,
    };
  }

  // ============================================================================
  // SENTENCE BOUNDARY DETECTION
  // ============================================================================

  /**
   * Detect sentence boundaries with confidence scores
   */
  private detectSentenceBoundaries(text: string): SentenceBoundary[] {
    const boundaries: SentenceBoundary[] = [];

    // Signal 1: Period/!/? followed by capital letter
    const sentenceEndPattern = /([.!?])\s+([A-Z])/g;
    let match;
    while ((match = sentenceEndPattern.exec(text)) !== null) {
      boundaries.push({
        index: match.index,
        punctuation: match[1],
        confidence: 0.85,
        type: 'sentence',
      });
    }

    // Signal 2: Transition phrases
    const transitions = [
      'For example', 'Remember', 'Note that', 'In other words',
      'Therefore', 'However', 'First,', 'Second,', 'Third,', 'Finally,',
      'Next,', 'Then,', 'Also,', 'Additionally', 'The key', 'The simple',
      'Think about', "Let's", 'Now,', "Here's", 'To summarize',
    ];

    for (const phrase of transitions) {
      const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`([.!?])\\s*(${escapedPhrase})`, 'gi');
      while ((match = regex.exec(text)) !== null) {
        boundaries.push({
          index: match.index,
          punctuation: match[1],
          confidence: 0.9,
          type: 'paragraph',
        });
      }
    }

    // Signal 3: Educational section keywords
    const sections = [
      'Learning Objectives?', 'Prerequisites?', 'Key Concepts?', 'Summary',
      'Introduction', 'Overview', 'Conclusion', 'Examples?', 'Practice',
      'Exercises?', 'Vocabulary', 'Formula', 'Rules?', 'Definitions?',
      'Materials?', 'Procedure', 'Steps?', 'Review', 'Assessment',
    ];

    for (const section of sections) {
      const regex = new RegExp(`([.!?]|^)\\s*(${section})\\s*[:•\\-]?`, 'gi');
      while ((match = regex.exec(text)) !== null) {
        boundaries.push({
          index: match.index,
          confidence: 0.95,
          type: 'section',
          sectionName: match[2],
        });
      }
    }

    // Signal 4: Question patterns
    const questionStarters = /([.!?])\s*(What\s+(?:is|are|does|do)|How\s+(?:do|does|can|to)|Why\s+(?:do|does|is|are)|When\s+(?:do|does|should))/gi;
    while ((match = questionStarters.exec(text)) !== null) {
      boundaries.push({
        index: match.index,
        punctuation: match[1],
        confidence: 0.88,
        type: 'question',
      });
    }

    return boundaries;
  }

  // ============================================================================
  // LINE BREAK RESTORATION
  // ============================================================================

  /**
   * Smart line break restoration using heuristic analysis
   */
  private restoreLineBreaksSmart(text: string): string {
    if (!text) return '';

    const analysis = this.analyzeText(text);
    if (!analysis.needsRestoration) return text;

    let result = text;

    // Normalize whitespace
    result = result.replace(/\s+/g, ' ').trim();

    // Detect boundaries and insert breaks
    const boundaries = this.detectSentenceBoundaries(result);

    // Sort by index descending
    boundaries.sort((a, b) => b.index - a.index);

    const processedRanges = new Set<number>();

    for (const boundary of boundaries) {
      const rangeKey = Math.floor(boundary.index / 10);
      if (processedRanges.has(rangeKey)) continue;

      if (boundary.confidence > 0.7) {
        let insertPoint = boundary.index;

        if (boundary.punctuation) {
          const punctIndex = result.indexOf(boundary.punctuation, boundary.index);
          if (punctIndex !== -1) {
            insertPoint = punctIndex + 1;
          }
        }

        if (insertPoint > 0 && insertPoint < result.length) {
          const breakType = boundary.type === 'section' ? '\n\n\n' :
                            boundary.type === 'paragraph' ? '\n\n' :
                            boundary.type === 'question' ? '\n\n' : '\n';

          result = result.slice(0, insertPoint) + breakType + result.slice(insertPoint).trimStart();
          processedRanges.add(rangeKey);
        }
      }
    }

    // Handle specific patterns
    result = result.replace(/\s*\[Page\s*(\d+)\]\s*/gi, '\n\n[Section $1]\n\n');
    result = result.replace(/\s*(\[Section\s*\d+\])\s*/gi, '\n\n$1\n\n');

    // Bullets
    result = result.replace(/\s*([•·∙‣⁃○●◦▪▸])\s*/g, '\n$1 ');
    result = result.replace(/([.!?])\s*-\s+([A-Z])/g, '$1\n- $2');

    // Numbered lists
    result = result.replace(/\s+(\d+[.)]\s+)([A-Z])/g, '\n$1$2');
    result = result.replace(/\s+([a-z][.)]\s+)([A-Z])/g, '\n$1$2');

    // Metadata fields
    result = result.replace(/(Grade Level:\s*[^:]+?)(?=\s+(?:Subject|Topic|Duration|Time|Prerequisites?):)/gi, '$1\n');
    result = result.replace(/(Subject:\s*[^:]+?)(?=\s+(?:Grade Level|Topic|Duration|Time|Prerequisites?):)/gi, '$1\n');
    result = result.replace(/(Topic:\s*[^:]+?)(?=\s+(?:Grade Level|Subject|Duration|Time|Prerequisites?):)/gi, '$1\n');

    // Step/Example patterns
    result = result.replace(/\s+(Step\s+\d+)\s*:/gi, '\n\n$1:');
    result = result.replace(/\s+(Example\s+\d+)\s*:/gi, '\n\n$1:');
    result = result.replace(/\s+(Problem\s+\d+)\s*:/gi, '\n\n$1:');
    result = result.replace(/\s+(Part\s+\d+)\s*:/gi, '\n\n$1:');

    // Section headers
    const sectionHeaders = [
      'Learning Objectives?', 'Prerequisites?', 'Key Concepts?', 'Summary',
      'Introduction', 'Overview', 'Conclusion', 'Review', 'Vocabulary',
      'Materials?', 'Procedure', 'Assessment', 'Practice', 'Exercises?',
    ];

    for (const header of sectionHeaders) {
      const regex = new RegExp(`([.!?]|^)\\s*(${header})\\s*([•\\-:]?)`, 'gi');
      result = result.replace(regex, '$1\n\n$2$3');
    }

    // "The [Something] Rule/Formula" patterns
    result = result.replace(/([.!?])\s+(The\s+(?:Simple\s+)?(?:Rule|Formula|Method|Key|Basic)\s+(?:for|of|to)\s+[A-Z])/gi, '$1\n\n$2');

    // Clean up
    result = result.replace(/\n{4,}/g, '\n\n\n');
    result = result.replace(/^\n+/, '');
    result = result.replace(/\n+$/, '');

    result = result.split('\n')
      .map(line => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');

    return result;
  }

  // ============================================================================
  // HTML CONVERSION
  // ============================================================================

  /**
   * Process section markers
   */
  private processSectionMarkers(text: string): string {
    return text.replace(PATTERNS.sectionMarker, '\n\n---SECTION $1---\n\n');
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Convert to title case
   */
  private toTitleCase(str: string): string {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Format inline text (bold, math)
   */
  private formatInlineText(text: string): string {
    let formatted = this.escapeHtml(text);

    // Bold text
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');

    // Key term definitions
    formatted = formatted.replace(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(means?|is defined as|refers to|is when)/g,
      '<strong>$1</strong> $2'
    );

    // Math expressions
    formatted = this.mathFormatter.formatMathExpressions(formatted);

    return formatted;
  }

  /**
   * Check if line is a header
   */
  private isHeader(line: string, nextLine: string = ''): HeaderMatch | false {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 80) return false;

    // Check section headers
    for (const pattern of PATTERNS.sectionHeaders) {
      if (pattern.test(trimmed)) {
        return { type: 'h2', text: trimmed.replace(/:$/, '') };
      }
    }

    // ALL CAPS
    if (PATTERNS.allCapsHeader.test(trimmed) && trimmed.length > 5) {
      return { type: 'h2', text: this.toTitleCase(trimmed) };
    }

    // Numbered headers
    const numberedMatch = trimmed.match(PATTERNS.numberedHeader);
    if (numberedMatch) {
      return { type: 'h3', text: trimmed };
    }

    // Inline headers ending with colon
    if (trimmed.endsWith(':') && trimmed.length < 50 && /^[A-Z]/.test(trimmed)) {
      if (!PATTERNS.bulletPoint.test(trimmed) && !PATTERNS.numberedList.test(trimmed)) {
        return { type: 'h3', text: trimmed.replace(/:$/, '') };
      }
    }

    // Title case headers
    if (PATTERNS.titleCaseHeader.test(trimmed) && trimmed.length < 40) {
      if (nextLine && nextLine.trim().length > trimmed.length) {
        return { type: 'h3', text: trimmed };
      }
    }

    return false;
  }

  /**
   * Check if line is a list item
   */
  private isListItem(line: string): ListItemMatch | false {
    const trimmed = line.trim();

    if (PATTERNS.bulletPoint.test(trimmed)) {
      return { type: 'bullet', text: trimmed.replace(PATTERNS.bulletPoint, '') };
    }

    const numberedMatch = trimmed.match(PATTERNS.numberedList);
    if (numberedMatch) {
      return { type: 'numbered', number: numberedMatch[1], text: trimmed.replace(PATTERNS.numberedList, '') };
    }

    const letteredMatch = trimmed.match(PATTERNS.letteredList);
    if (letteredMatch) {
      return { type: 'lettered', letter: letteredMatch[1], text: trimmed.replace(PATTERNS.letteredList, '') };
    }

    return false;
  }

  /**
   * Convert processed text to HTML
   */
  private convertToHtml(text: string, options: DocumentFormatterOptions): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let currentParagraph: string[] = [];
    let inList = false;
    let listType: 'bullet' | 'numbered' | 'lettered' | null = null;
    let listItems: string[] = [];

    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        const paragraphText = currentParagraph.join(' ').trim();
        if (paragraphText) {
          result.push(`<p>${this.formatInlineText(paragraphText)}</p>`);
        }
        currentParagraph = [];
      }
    };

    const flushList = () => {
      if (listItems.length > 0) {
        const tag = listType === 'numbered' || listType === 'lettered' ? 'ol' : 'ul';
        const items = listItems.map(item => `<li>${this.formatInlineText(item)}</li>`).join('\n');
        result.push(`<${tag}>\n${items}\n</${tag}>`);
        listItems = [];
        inList = false;
        listType = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1] || '';
      const trimmed = line.trim();

      // Empty line
      if (!trimmed) {
        flushList();
        flushParagraph();
        continue;
      }

      // Section dividers
      const sectionMatch = trimmed.match(/^---SECTION\s*(\d+)---$/);
      if (sectionMatch) {
        flushList();
        flushParagraph();
        const sectionNum = sectionMatch[1];
        result.push(`<div class="section-break" data-section="${sectionNum}"><span class="section-marker">Section ${sectionNum}</span></div>`);
        continue;
      }

      // Headers
      const header = this.isHeader(trimmed, nextLine);
      if (header) {
        flushList();
        flushParagraph();
        result.push(`<${header.type} class="lesson-header">${this.escapeHtml(header.text)}</${header.type}>`);
        continue;
      }

      // List items
      const listItem = this.isListItem(trimmed);
      if (listItem) {
        flushParagraph();

        if (inList && listType !== listItem.type) {
          flushList();
        }

        inList = true;
        listType = listItem.type;
        listItems.push(listItem.text);
        continue;
      }

      // If in list but not a list item, flush list
      if (inList) {
        flushList();
      }

      // Questions
      if (PATTERNS.questionPattern.test(trimmed)) {
        flushParagraph();
        result.push(`<p class="question"><strong>${this.formatInlineText(trimmed)}</strong></p>`);
        continue;
      }

      // Metadata
      if (PATTERNS.gradeLevelPattern.test(trimmed) ||
          PATTERNS.subjectPattern.test(trimmed) ||
          PATTERNS.durationPattern.test(trimmed)) {
        flushParagraph();
        result.push(`<p class="metadata">${this.formatInlineText(trimmed)}</p>`);
        continue;
      }

      // Regular text
      currentParagraph.push(trimmed);
    }

    // Flush remaining
    flushList();
    flushParagraph();

    return result.join('\n');
  }

  // ============================================================================
  // ENHANCEMENT METHODS
  // ============================================================================

  /**
   * Enhance HTML with chapter structure from AI analysis
   */
  private enhanceWithChapters(html: string, chapters: Chapter[]): string {
    // If we have chapter data, we could add navigation or structure
    // For now, chapters are primarily used to guide sectioning during restoration
    // This can be enhanced later to add chapter markers or navigation
    return html;
  }

  /**
   * Highlight vocabulary terms from AI analysis
   */
  private highlightVocabulary(html: string, vocabulary: VocabularyItem[]): string {
    if (!vocabulary.length) return html;

    let result = html;

    for (const item of vocabulary) {
      // Case-insensitive term matching, but not inside HTML tags
      const escapedTerm = item.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const termRegex = new RegExp(`(?<!<[^>]*)\\b(${escapedTerm})\\b(?![^<]*>)`, 'gi');

      const escapedDefinition = this.escapeHtml(item.definition).replace(/"/g, '&quot;');

      result = result.replace(termRegex, (match) =>
        `<span class="vocabulary-term" data-definition="${escapedDefinition}" title="${escapedDefinition}">${match}</span>`
      );
    }

    return result;
  }

  /**
   * Mark exercise locations in the content
   */
  private markExerciseLocations(html: string, exercises: Exercise[]): string {
    if (!exercises.length) return html;

    let result = html;

    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];
      const questionText = exercise.questionText;

      // Find the question text in the content and wrap with reference attribute
      const escapedQuestion = questionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match text that's not already inside an HTML tag
      const pattern = new RegExp(`(?<!<[^>]*)(${escapedQuestion})(?![^<]*>)`, 'gi');

      result = result.replace(pattern, (match) =>
        `<span class="interactive-exercise" data-exercise-id="${exercise.id}" data-type="${exercise.type}">${match}</span>`
      );
    }

    return result;
  }
}

// Export singleton instance
export const documentFormatter = new DocumentFormatter();
