/**
 * Structured Renderer
 *
 * Renders content blocks into beautiful, styled HTML.
 * This is the deterministic rendering layer - it takes structured
 * content blocks from AI analysis and produces consistent, beautiful output.
 */

import { AgeGroup } from '@prisma/client';
import {
  ContentBlock,
  StructuredContent,
  MetadataBlock,
  HeaderBlock,
  ParagraphBlock,
  ExplanationBlock,
  ExampleBlock,
  KeyConceptBlock,
  RuleBlock,
  FormulaBlock,
  WordProblemBlock,
  BulletListBlock,
  NumberedListBlock,
  StepByStepBlock,
  TipBlock,
  NoteBlock,
  WarningBlock,
  QuestionBlock,
  AnswerBlock,
  DefinitionBlock,
  VocabularyBlock,
  TableBlock,
  DividerBlock,
} from './contentBlocks.js';
import { MathFormatter } from './mathFormatter.js';

// ============================================================================
// RENDERER OPTIONS
// ============================================================================

export interface StructuredRendererOptions {
  ageGroup?: AgeGroup;
  includeIcons?: boolean;
  colorScheme?: 'vibrant' | 'subtle';
}

// ============================================================================
// STRUCTURED RENDERER CLASS
// ============================================================================

export class StructuredRenderer {
  private mathFormatter: MathFormatter;
  private options: Required<StructuredRendererOptions>;

  constructor(options?: StructuredRendererOptions) {
    this.mathFormatter = new MathFormatter();
    const ageGroup = options?.ageGroup || 'OLDER';
    this.options = {
      ageGroup,
      includeIcons: options?.includeIcons ?? true,
      colorScheme: options?.colorScheme ?? (ageGroup === 'YOUNG' ? 'vibrant' : 'subtle'),
    };
  }

  /**
   * Update renderer options (e.g., ageGroup)
   */
  setOptions(options: StructuredRendererOptions): void {
    if (options.ageGroup) {
      this.options.ageGroup = options.ageGroup;
      // Update color scheme if not explicitly set
      if (!options.colorScheme) {
        this.options.colorScheme = options.ageGroup === 'YOUNG' ? 'vibrant' : 'subtle';
      }
    }
    if (options.includeIcons !== undefined) {
      this.options.includeIcons = options.includeIcons;
    }
    if (options.colorScheme) {
      this.options.colorScheme = options.colorScheme;
    }
  }

  /**
   * Render structured content to HTML
   */
  render(content: StructuredContent): string {
    const blocks = content.blocks;
    if (!blocks || blocks.length === 0) {
      return '<p class="text-gray-500 italic">No content available</p>';
    }

    const renderedBlocks = blocks.map((block, index) =>
      this.renderBlock(block, index)
    );

    const ageClass = this.options.ageGroup === 'YOUNG' ? 'age-young' : 'age-older';
    const colorClass = this.options.colorScheme === 'vibrant' ? 'color-vibrant' : 'color-subtle';

    return `<div class="structured-content ${ageClass} ${colorClass}">
${renderedBlocks.join('\n')}
</div>`;
  }

  /**
   * Render a single content block
   */
  private renderBlock(block: ContentBlock, index: number): string {
    switch (block.type) {
      case 'metadata':
        return this.renderMetadata(block);
      case 'header':
        return this.renderHeader(block);
      case 'paragraph':
        return this.renderParagraph(block);
      case 'explanation':
        return this.renderExplanation(block);
      case 'example':
        return this.renderExample(block, index);
      case 'keyConceptBox':
        return this.renderKeyConcept(block);
      case 'rule':
        return this.renderRule(block);
      case 'formula':
        return this.renderFormula(block);
      case 'wordProblem':
        return this.renderWordProblem(block, index);
      case 'bulletList':
        return this.renderBulletList(block);
      case 'numberedList':
        return this.renderNumberedList(block);
      case 'stepByStep':
        return this.renderStepByStep(block);
      case 'tip':
        return this.renderTip(block);
      case 'note':
        return this.renderNote(block);
      case 'warning':
        return this.renderWarning(block);
      case 'question':
        return this.renderQuestion(block);
      case 'answer':
        return this.renderAnswer(block);
      case 'definition':
        return this.renderDefinition(block);
      case 'vocabulary':
        return this.renderVocabulary(block);
      case 'table':
        return this.renderTable(block);
      case 'divider':
        return this.renderDivider(block);
      default:
        return `<p class="text-gray-600">${this.escapeHtml(JSON.stringify(block))}</p>`;
    }
  }

  // ============================================================================
  // BLOCK RENDERERS
  // ============================================================================

  private renderMetadata(block: MetadataBlock): string {
    const items: string[] = [];

    if (block.gradeLevel) {
      items.push(`<span class="metadata-item grade"><span class="label">Grade:</span> ${this.escapeHtml(block.gradeLevel)}</span>`);
    }
    if (block.subject) {
      items.push(`<span class="metadata-item subject"><span class="label">Subject:</span> ${this.escapeHtml(block.subject)}</span>`);
    }
    if (block.topic) {
      items.push(`<span class="metadata-item topic"><span class="label">Topic:</span> ${this.escapeHtml(block.topic)}</span>`);
    }
    if (block.duration) {
      items.push(`<span class="metadata-item duration"><span class="label">Duration:</span> ${this.escapeHtml(block.duration)}</span>`);
    }

    if (items.length === 0) return '';

    let prerequisites = '';
    if (block.prerequisites && block.prerequisites.length > 0) {
      prerequisites = `
      <div class="prerequisites">
        <span class="label">Prerequisites:</span>
        <ul>${block.prerequisites.map(p => `<li>${this.escapeHtml(p)}</li>`).join('')}</ul>
      </div>`;
    }

    return `<div class="metadata-bar">
  <div class="metadata-items">${items.join('')}</div>
  ${prerequisites}
</div>`;
  }

  private renderHeader(block: HeaderBlock): string {
    const tag = `h${block.level}`;
    const classes = [
      'content-header',
      `header-level-${block.level}`,
    ].join(' ');

    return `<${tag} class="${classes}">${this.formatText(block.text)}</${tag}>`;
  }

  private renderParagraph(block: ParagraphBlock): string {
    const text = block.text;

    // Split long paragraphs into digestible chunks (max 4-5 sentences each)
    const chunks = this.splitLongParagraph(text);

    if (chunks.length === 1) {
      return `<p class="content-paragraph">${this.formatText(chunks[0])}</p>`;
    }

    // Multiple chunks - render each as a separate paragraph
    return chunks
      .map(chunk => `<p class="content-paragraph">${this.formatText(chunk)}</p>`)
      .join('\n');
  }

  /**
   * Split long paragraphs into smaller chunks for better readability.
   * Target: 4-5 sentences per chunk.
   */
  private splitLongParagraph(text: string, maxSentences: number = 4): string[] {
    if (!text || text.trim().length === 0) {
      return [text];
    }

    const sentences = this.splitIntoSentences(text);

    // If already short enough, return as-is
    if (sentences.length <= maxSentences) {
      return [text.trim()];
    }

    // Split into chunks of maxSentences
    const chunks: string[] = [];
    for (let i = 0; i < sentences.length; i += maxSentences) {
      const chunk = sentences.slice(i, i + maxSentences).join(' ').trim();
      if (chunk) {
        chunks.push(chunk);
      }
    }

    return chunks;
  }

  /**
   * Split text into sentences using smart boundary detection.
   * Handles abbreviations, decimals, and other edge cases.
   */
  private splitIntoSentences(text: string): string[] {
    if (!text) return [];

    // Common abbreviations that shouldn't end sentences
    const abbreviations = [
      'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr',
      'vs', 'etc', 'i.e', 'e.g', 'al', 'Inc', 'Ltd', 'Co',
      'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      'St', 'Ave', 'Blvd', 'Rd', 'Mt', 'ft', 'in', 'cm', 'mm', 'km', 'kg', 'lb',
      'No', 'Vol', 'Ch', 'Sec', 'Fig', 'pg', 'pp'
    ];

    // Protect abbreviations by temporarily replacing periods
    let processed = text;
    const protectedMarkers: string[] = [];

    abbreviations.forEach((abbr, idx) => {
      const marker = `__ABBR${idx}__`;
      const regex = new RegExp(`\\b${abbr}\\.`, 'gi');
      processed = processed.replace(regex, (match) => {
        protectedMarkers.push(match);
        return marker;
      });
    });

    // Protect decimal numbers (e.g., 3.14, $4.99)
    processed = processed.replace(/(\d+)\.(\d+)/g, '$1__DECIMAL__$2');

    // Protect ellipses
    processed = processed.replace(/\.{3}/g, '__ELLIPSIS__');

    // Split on sentence-ending punctuation followed by space and capital letter
    // or end of string
    const sentencePattern = /([.!?])\s+(?=[A-Z])|([.!?])$/g;

    const sentences: string[] = [];
    let lastIndex = 0;
    let match;

    while ((match = sentencePattern.exec(processed)) !== null) {
      const sentence = processed.slice(lastIndex, match.index + 1).trim();
      if (sentence) {
        sentences.push(sentence);
      }
      lastIndex = match.index + match[0].length;
    }

    // Don't forget the last part if no ending punctuation
    if (lastIndex < processed.length) {
      const remaining = processed.slice(lastIndex).trim();
      if (remaining) {
        sentences.push(remaining);
      }
    }

    // Restore protected patterns
    return sentences.map(sentence => {
      let restored = sentence;

      // Restore abbreviations
      abbreviations.forEach((abbr, idx) => {
        const marker = `__ABBR${idx}__`;
        if (restored.includes(marker)) {
          restored = restored.replace(new RegExp(marker, 'g'), `${abbr}.`);
        }
      });

      // Restore decimals
      restored = restored.replace(/__DECIMAL__/g, '.');

      // Restore ellipses
      restored = restored.replace(/__ELLIPSIS__/g, '...');

      return restored.trim();
    }).filter(s => s.length > 0);
  }

  private renderExplanation(block: ExplanationBlock): string {
    const emphasisClass = block.emphasis === 'important' ? 'explanation-important' : '';
    return `<div class="explanation-block ${emphasisClass}">
  <p>${this.formatText(block.text)}</p>
</div>`;
  }

  private renderExample(block: ExampleBlock, index: number): string {
    const title = block.title || `Example ${index + 1}`;
    const icon = this.options.includeIcons ? '<span class="icon">📝</span>' : '';

    let solution = '';
    if (block.solution) {
      solution = `<div class="example-solution">
    <span class="solution-label">Solution:</span>
    <p>${this.formatText(block.solution)}</p>
  </div>`;
    }

    return `<div class="example-block">
  <div class="example-header">${icon}<span class="example-title">${this.escapeHtml(title)}</span></div>
  <div class="example-content">${this.formatText(block.content)}</div>
  ${solution}
</div>`;
  }

  private renderKeyConcept(block: KeyConceptBlock): string {
    const icon = this.options.includeIcons ? '<span class="icon">💡</span>' : '';
    const title = block.title || 'Key Concept';

    return `<div class="key-concept-box">
  <div class="concept-header">${icon}<span class="concept-title">${this.escapeHtml(title)}</span></div>
  <p class="concept-text">${this.formatText(block.text)}</p>
</div>`;
  }

  private renderRule(block: RuleBlock): string {
    const icon = this.options.includeIcons ? '<span class="icon">📐</span>' : '';

    let description = '';
    if (block.description) {
      description = `<p class="rule-description">${this.formatText(block.description)}</p>`;
    }

    let steps = '';
    if (block.steps && block.steps.length > 0) {
      steps = `<ol class="rule-steps">
    ${block.steps.map(step => `<li>${this.formatText(step)}</li>`).join('\n    ')}
  </ol>`;
    }

    let formula = '';
    if (block.formula) {
      formula = `<div class="rule-formula">${this.mathFormatter.formatMathExpressions(this.escapeHtml(block.formula))}</div>`;
    }

    return `<div class="rule-box">
  <div class="rule-header">${icon}<span class="rule-title">${this.escapeHtml(block.title)}</span></div>
  ${description}
  ${steps}
  ${formula}
</div>`;
  }

  private renderFormula(block: FormulaBlock): string {
    const icon = this.options.includeIcons ? '<span class="icon">🔢</span>' : '';

    let explanation = '';
    if (block.explanation) {
      explanation = `<p class="formula-explanation">${this.formatText(block.explanation)}</p>`;
    }

    return `<div class="formula-block">
  <div class="formula-display">${icon}${this.mathFormatter.formatMathExpressions(this.escapeHtml(block.formula))}</div>
  ${explanation}
</div>`;
  }

  private renderWordProblem(block: WordProblemBlock, index: number): string {
    const title = block.title || `Problem ${index + 1}`;
    const icon = block.icon || (this.options.includeIcons ? '📚' : '');

    const parts: string[] = [];

    parts.push(`<div class="problem-statement">
    <span class="part-label">Problem:</span>
    <p>${this.formatText(block.problem)}</p>
  </div>`);

    if (block.understand) {
      parts.push(`<div class="problem-understand">
    <span class="part-label">Understand:</span>
    <p>${this.formatText(block.understand)}</p>
  </div>`);
    }

    if (block.setup) {
      parts.push(`<div class="problem-setup">
    <span class="part-label">Set up:</span>
    <p>${this.formatText(block.setup)}</p>
  </div>`);
    }

    if (block.calculate) {
      parts.push(`<div class="problem-calculate">
    <span class="part-label">Calculate:</span>
    <p>${this.formatText(block.calculate)}</p>
  </div>`);
    }

    if (block.simplify) {
      parts.push(`<div class="problem-simplify">
    <span class="part-label">Simplify:</span>
    <p>${this.formatText(block.simplify)}</p>
  </div>`);
    }

    parts.push(`<div class="problem-answer">
    <span class="part-label">Answer:</span>
    <p>${this.formatText(block.answer)}</p>
  </div>`);

    return `<div class="word-problem-block">
  <div class="problem-header"><span class="problem-icon">${icon}</span><span class="problem-title">${this.escapeHtml(title)}</span></div>
  <div class="problem-parts">
    ${parts.join('\n    ')}
  </div>
</div>`;
  }

  private renderBulletList(block: BulletListBlock): string {
    let title = '';
    if (block.title) {
      title = `<div class="list-title">${this.escapeHtml(block.title)}</div>`;
    }

    const items = block.items.map(item =>
      `<li>${this.formatText(item)}</li>`
    ).join('\n    ');

    return `<div class="bullet-list-block">
  ${title}
  <ul class="content-list bullet-list">
    ${items}
  </ul>
</div>`;
  }

  private renderNumberedList(block: NumberedListBlock): string {
    let title = '';
    if (block.title) {
      title = `<div class="list-title">${this.escapeHtml(block.title)}</div>`;
    }

    const items = block.items.map(item =>
      `<li>${this.formatText(item)}</li>`
    ).join('\n    ');

    return `<div class="numbered-list-block">
  ${title}
  <ol class="content-list numbered-list">
    ${items}
  </ol>
</div>`;
  }

  private renderStepByStep(block: StepByStepBlock): string {
    const icon = this.options.includeIcons ? '<span class="icon">👣</span>' : '';
    const title = block.title || 'Steps';

    const steps = block.steps.map((step, i) => {
      const label = step.label || `Step ${i + 1}`;
      return `<div class="step-item">
      <span class="step-number">${i + 1}</span>
      <div class="step-content">
        <span class="step-label">${this.escapeHtml(label)}:</span>
        <p>${this.formatText(step.content)}</p>
      </div>
    </div>`;
    }).join('\n    ');

    return `<div class="step-by-step-block">
  <div class="steps-header">${icon}<span class="steps-title">${this.escapeHtml(title)}</span></div>
  <div class="steps-container">
    ${steps}
  </div>
</div>`;
  }

  private renderTip(block: TipBlock): string {
    const icon = this.options.includeIcons ? '<span class="icon">💡</span>' : '';
    return `<div class="tip-block">
  <div class="tip-header">${icon}<span class="tip-label">Tip</span></div>
  <p class="tip-text">${this.formatText(block.text)}</p>
</div>`;
  }

  private renderNote(block: NoteBlock): string {
    const icon = this.options.includeIcons ? '<span class="icon">📝</span>' : '';
    return `<div class="note-block">
  <div class="note-header">${icon}<span class="note-label">Note</span></div>
  <p class="note-text">${this.formatText(block.text)}</p>
</div>`;
  }

  private renderWarning(block: WarningBlock): string {
    const icon = this.options.includeIcons ? '<span class="icon">⚠️</span>' : '';
    return `<div class="warning-block">
  <div class="warning-header">${icon}<span class="warning-label">Watch Out!</span></div>
  <p class="warning-text">${this.formatText(block.text)}</p>
</div>`;
  }

  private renderQuestion(block: QuestionBlock): string {
    const icon = this.options.includeIcons ? '<span class="icon">❓</span>' : '';

    let hint = '';
    if (block.hint) {
      hint = `<p class="question-hint"><span class="hint-label">Hint:</span> ${this.formatText(block.hint)}</p>`;
    }

    return `<div class="question-block">
  <div class="question-content">${icon}<p class="question-text">${this.formatText(block.text)}</p></div>
  ${hint}
</div>`;
  }

  private renderAnswer(block: AnswerBlock): string {
    const icon = this.options.includeIcons ? '<span class="icon">✅</span>' : '';

    let explanation = '';
    if (block.explanation) {
      explanation = `<p class="answer-explanation">${this.formatText(block.explanation)}</p>`;
    }

    return `<div class="answer-block">
  <div class="answer-content">${icon}<p class="answer-text">${this.formatText(block.text)}</p></div>
  ${explanation}
</div>`;
  }

  private renderDefinition(block: DefinitionBlock): string {
    let example = '';
    if (block.example) {
      example = `<p class="definition-example"><span class="example-label">Example:</span> ${this.formatText(block.example)}</p>`;
    }

    return `<div class="definition-block">
  <span class="term">${this.escapeHtml(block.term)}</span>
  <span class="definition-text">${this.formatText(block.definition)}</span>
  ${example}
</div>`;
  }

  private renderVocabulary(block: VocabularyBlock): string {
    const icon = this.options.includeIcons ? '<span class="icon">📖</span>' : '';

    const terms = block.terms.map(item => {
      let example = '';
      if (item.example) {
        example = `<span class="vocab-example">${this.formatText(item.example)}</span>`;
      }
      return `<div class="vocab-item">
      <span class="vocab-term">${this.escapeHtml(item.term)}</span>
      <span class="vocab-definition">${this.formatText(item.definition)}</span>
      ${example}
    </div>`;
    }).join('\n    ');

    return `<div class="vocabulary-block">
  <div class="vocab-header">${icon}<span class="vocab-title">Vocabulary</span></div>
  <div class="vocab-list">
    ${terms}
  </div>
</div>`;
  }

  private renderTable(block: TableBlock): string {
    let title = '';
    if (block.title) {
      title = `<div class="table-title">${this.escapeHtml(block.title)}</div>`;
    }

    let header = '';
    if (block.headers && block.headers.length > 0) {
      header = `<thead>
      <tr>${block.headers.map(h => `<th>${this.escapeHtml(h)}</th>`).join('')}</tr>
    </thead>`;
    }

    const rows = block.rows.map(row =>
      `<tr>${row.map(cell => `<td>${this.formatText(cell)}</td>`).join('')}</tr>`
    ).join('\n      ');

    return `<div class="table-block">
  ${title}
  <table class="content-table">
    ${header}
    <tbody>
      ${rows}
    </tbody>
  </table>
</div>`;
  }

  private renderDivider(block: DividerBlock): string {
    const style = block.style || 'solid';

    if (block.label) {
      return `<div class="divider-block divider-${style} with-label">
  <span class="divider-label">${this.escapeHtml(block.label)}</span>
</div>`;
    }

    return `<div class="divider-block divider-${style}"></div>`;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

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
   * Format text with math expressions and basic formatting
   */
  private formatText(text: string): string {
    let formatted = this.escapeHtml(text);

    // Apply math formatting
    formatted = this.mathFormatter.formatMathExpressions(formatted);

    // Bold text
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');

    // Italic text
    formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');

    return formatted;
  }
}

// ============================================================================
// CSS STYLES
// ============================================================================

export const structuredRendererStyles = `
/* ============================================
   STRUCTURED CONTENT STYLES
   ============================================ */

.structured-content {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.7;
  color: #1a202c;
}

/* Age-specific adjustments */
.structured-content.age-young {
  font-size: 1.1rem;
  line-height: 1.8;
}

.structured-content.age-older {
  font-size: 1rem;
  line-height: 1.7;
}

/* ============================================
   METADATA BAR
   ============================================ */

.metadata-bar {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 1rem 1.25rem;
  border-radius: 12px;
  margin-bottom: 1.5rem;
}

.metadata-items {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.metadata-item {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(255,255,255,0.2);
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.875rem;
}

.metadata-item .label {
  font-weight: 600;
}

/* ============================================
   HEADERS
   ============================================ */

.content-header {
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  font-weight: 700;
  color: #2d3748;
}

.header-level-1 {
  font-size: 1.875rem;
  border-bottom: 3px solid #4299e1;
  padding-bottom: 0.5rem;
}

.header-level-2 {
  font-size: 1.5rem;
  color: #2b6cb0;
}

.header-level-3 {
  font-size: 1.25rem;
  color: #3182ce;
}

.header-level-4 {
  font-size: 1.125rem;
  color: #4299e1;
}

/* ============================================
   PARAGRAPHS & EXPLANATIONS
   ============================================ */

.content-paragraph {
  margin-bottom: 1rem;
  color: #4a5568;
}

.explanation-block {
  margin: 1rem 0;
  padding: 1rem;
  background: #f7fafc;
  border-radius: 8px;
  border-left: 4px solid #4299e1;
}

.explanation-important {
  background: #fffbeb;
  border-left-color: #f59e0b;
}

/* ============================================
   KEY CONCEPT BOX
   ============================================ */

.key-concept-box {
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border: 2px solid #f59e0b;
  border-radius: 12px;
  padding: 1rem 1.25rem;
  margin: 1.25rem 0;
}

.concept-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.concept-title {
  font-weight: 700;
  color: #92400e;
  font-size: 1.1rem;
}

.concept-text {
  color: #78350f;
  margin: 0;
}

/* ============================================
   RULE BOX
   ============================================ */

.rule-box {
  background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%);
  border: 2px solid #0284c7;
  border-radius: 12px;
  padding: 1rem 1.25rem;
  margin: 1.25rem 0;
}

.rule-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.rule-title {
  font-weight: 700;
  color: #0c4a6e;
  font-size: 1.1rem;
}

.rule-steps {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.rule-steps li {
  margin-bottom: 0.5rem;
  color: #0369a1;
}

.rule-formula {
  background: white;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-size: 1.1rem;
  text-align: center;
  margin-top: 0.75rem;
}

/* ============================================
   FORMULA BLOCK
   ============================================ */

.formula-block {
  background: #fefce8;
  border: 2px dashed #ca8a04;
  border-radius: 12px;
  padding: 1rem;
  margin: 1rem 0;
  text-align: center;
}

.formula-display {
  font-size: 1.25rem;
  font-weight: 600;
  color: #713f12;
}

/* ============================================
   WORD PROBLEM
   ============================================ */

.word-problem-block {
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  margin: 1.25rem 0;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.problem-header {
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
  color: white;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.problem-icon {
  font-size: 1.25rem;
}

.problem-title {
  font-weight: 700;
  font-size: 1.1rem;
}

.problem-parts {
  padding: 1rem;
}

.problem-parts > div {
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  border-radius: 8px;
}

.problem-statement {
  background: #faf5ff;
  border-left: 4px solid #8b5cf6;
}

.problem-understand {
  background: #f0fdf4;
  border-left: 4px solid #22c55e;
}

.problem-setup {
  background: #eff6ff;
  border-left: 4px solid #3b82f6;
}

.problem-calculate {
  background: #fefce8;
  border-left: 4px solid #eab308;
}

.problem-simplify {
  background: #fff7ed;
  border-left: 4px solid #f97316;
}

.problem-answer {
  background: #dcfce7;
  border-left: 4px solid #16a34a;
}

.part-label {
  font-weight: 700;
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.problem-statement .part-label { color: #7c3aed; }
.problem-understand .part-label { color: #16a34a; }
.problem-setup .part-label { color: #2563eb; }
.problem-calculate .part-label { color: #ca8a04; }
.problem-simplify .part-label { color: #ea580c; }
.problem-answer .part-label { color: #15803d; }

/* ============================================
   LISTS
   ============================================ */

.content-list {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.content-list li {
  margin-bottom: 0.5rem;
}

.bullet-list {
  list-style-type: disc;
}

.numbered-list {
  list-style-type: decimal;
}

.list-title {
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: #374151;
}

/* ============================================
   STEP BY STEP
   ============================================ */

.step-by-step-block {
  background: #f0fdf4;
  border: 2px solid #22c55e;
  border-radius: 12px;
  padding: 1rem;
  margin: 1.25rem 0;
}

.steps-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.steps-title {
  font-weight: 700;
  color: #15803d;
  font-size: 1.1rem;
}

.step-item {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.step-number {
  width: 28px;
  height: 28px;
  background: #22c55e;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}

.step-label {
  font-weight: 600;
  color: #166534;
}

/* ============================================
   TIP, NOTE, WARNING
   ============================================ */

.tip-block, .note-block, .warning-block {
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin: 1rem 0;
}

.tip-block {
  background: #ecfdf5;
  border-left: 4px solid #10b981;
}

.note-block {
  background: #eff6ff;
  border-left: 4px solid #3b82f6;
}

.warning-block {
  background: #fef3c7;
  border-left: 4px solid #f59e0b;
}

.tip-header, .note-header, .warning-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  margin-bottom: 0.25rem;
}

.tip-label { color: #059669; }
.note-label { color: #2563eb; }
.warning-label { color: #d97706; }

/* ============================================
   QUESTION & ANSWER
   ============================================ */

.question-block {
  background: #eef2ff;
  border: 2px solid #6366f1;
  border-radius: 12px;
  padding: 1rem;
  margin: 1rem 0;
}

.question-content {
  display: flex;
  gap: 0.5rem;
}

.question-text {
  font-weight: 600;
  color: #4338ca;
  margin: 0;
}

.question-hint {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: #6366f1;
  font-style: italic;
}

.answer-block {
  background: #dcfce7;
  border: 2px solid #22c55e;
  border-radius: 12px;
  padding: 1rem;
  margin: 1rem 0;
}

.answer-content {
  display: flex;
  gap: 0.5rem;
}

.answer-text {
  font-weight: 600;
  color: #15803d;
  margin: 0;
}

.answer-explanation {
  margin-top: 0.5rem;
  font-size: 0.9rem;
  color: #166534;
}

/* ============================================
   DEFINITION & VOCABULARY
   ============================================ */

.definition-block {
  background: #f5f3ff;
  border-left: 4px solid #8b5cf6;
  padding: 0.75rem 1rem;
  margin: 0.75rem 0;
  border-radius: 0 8px 8px 0;
}

.definition-block .term {
  font-weight: 700;
  color: #6d28d9;
  margin-right: 0.5rem;
}

.definition-block .term::after {
  content: ':';
}

.vocabulary-block {
  background: #fdf4ff;
  border: 2px solid #d946ef;
  border-radius: 12px;
  padding: 1rem;
  margin: 1.25rem 0;
}

.vocab-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.vocab-title {
  font-weight: 700;
  color: #a21caf;
  font-size: 1.1rem;
}

.vocab-item {
  padding: 0.5rem 0;
  border-bottom: 1px solid #f5d0fe;
}

.vocab-item:last-child {
  border-bottom: none;
}

.vocab-term {
  font-weight: 700;
  color: #86198f;
}

.vocab-term::after {
  content: ' - ';
  font-weight: normal;
}

.vocab-example {
  display: block;
  font-size: 0.875rem;
  color: #a855f7;
  font-style: italic;
  margin-top: 0.25rem;
}

/* ============================================
   TABLE
   ============================================ */

.table-block {
  margin: 1.25rem 0;
  overflow-x: auto;
}

.table-title {
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.content-table {
  width: 100%;
  border-collapse: collapse;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.content-table th {
  background: #f3f4f6;
  font-weight: 600;
  text-align: left;
  padding: 0.75rem;
  border-bottom: 2px solid #e5e7eb;
}

.content-table td {
  padding: 0.75rem;
  border-bottom: 1px solid #e5e7eb;
}

.content-table tr:last-child td {
  border-bottom: none;
}

.content-table tr:nth-child(even) {
  background: #f9fafb;
}

/* ============================================
   DIVIDER
   ============================================ */

.divider-block {
  margin: 1.5rem 0;
  border: none;
  height: 2px;
}

.divider-solid {
  background: #e5e7eb;
}

.divider-dashed {
  background: transparent;
  border-top: 2px dashed #d1d5db;
}

.divider-section {
  background: transparent;
  height: auto;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.divider-section::before,
.divider-section::after {
  content: '';
  flex: 1;
  height: 2px;
  background: #d1d5db;
}

.divider-label {
  background: #f3f4f6;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ============================================
   SLIDE HEADER (from PPT extraction)
   ============================================ */

.slide-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0.75rem 1.25rem;
  border-radius: 12px;
  margin: 1.5rem 0 1rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.slide-number {
  background: rgba(255,255,255,0.2);
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.slide-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
  flex: 1;
}

/* ============================================
   SLIDE IMAGES (from PPTX extraction)
   ============================================ */

.slide-image {
  margin: 1rem 0;
  text-align: center;
}

.slide-image img.lesson-image {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* Multiple images in a slide */
.slide-images-container {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: center;
  margin: 1rem 0;
}

.slide-images-container .slide-image {
  flex: 1 1 300px;
  max-width: 100%;
  margin: 0;
}

/* ============================================
   MATH EXPRESSIONS (from mathFormatter)
   ============================================ */

.structured-content .math {
  font-family: 'Computer Modern', Georgia, serif;
  background: #fef3c7;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-weight: 600;
}

.structured-content .fraction {
  color: #4338ca;
  font-weight: 600;
}

/* Icons */
.icon {
  font-size: 1.25rem;
  line-height: 1;
}
`;

// Export singleton instance (can be reconfigured via setOptions)
export const structuredRenderer = new StructuredRenderer();

// Export factory function for custom instances
export function createRenderer(options?: StructuredRendererOptions): StructuredRenderer {
  return new StructuredRenderer(options);
}
