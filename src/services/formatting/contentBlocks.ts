/**
 * Content Block Types
 *
 * Rich structured content blocks for educational content.
 * AI extracts these from raw text, then the StructuredRenderer
 * renders them beautifully with consistent styling.
 */

// ============================================================================
// BASE TYPES
// ============================================================================

export type ContentBlockType =
  | 'metadata'
  | 'header'
  | 'paragraph'
  | 'explanation'
  | 'example'
  | 'keyConceptBox'
  | 'rule'
  | 'formula'
  | 'wordProblem'
  | 'bulletList'
  | 'numberedList'
  | 'stepByStep'
  | 'tip'
  | 'note'
  | 'warning'
  | 'question'
  | 'answer'
  | 'definition'
  | 'vocabulary'
  | 'table'
  | 'divider';

// ============================================================================
// CONTENT BLOCK INTERFACES
// ============================================================================

export interface BaseBlock {
  type: ContentBlockType;
  id?: string;
}

export interface MetadataBlock extends BaseBlock {
  type: 'metadata';
  gradeLevel?: string;
  subject?: string;
  topic?: string;
  duration?: string;
  prerequisites?: string[];
}

export interface HeaderBlock extends BaseBlock {
  type: 'header';
  level: 1 | 2 | 3 | 4;
  text: string;
}

export interface ParagraphBlock extends BaseBlock {
  type: 'paragraph';
  text: string;
}

export interface ExplanationBlock extends BaseBlock {
  type: 'explanation';
  text: string;
  emphasis?: 'normal' | 'important';
}

export interface ExampleBlock extends BaseBlock {
  type: 'example';
  title?: string;
  content: string;
  solution?: string;
}

export interface KeyConceptBlock extends BaseBlock {
  type: 'keyConceptBox';
  title?: string;
  text: string;
}

export interface RuleBlock extends BaseBlock {
  type: 'rule';
  title: string;
  description?: string;
  steps?: string[];
  formula?: string;
}

export interface FormulaBlock extends BaseBlock {
  type: 'formula';
  formula: string;
  explanation?: string;
}

export interface WordProblemBlock extends BaseBlock {
  type: 'wordProblem';
  title?: string;
  icon?: string;
  problem: string;
  understand?: string;
  setup?: string;
  calculate?: string;
  simplify?: string;
  answer: string;
}

export interface BulletListBlock extends BaseBlock {
  type: 'bulletList';
  title?: string;
  items: string[];
}

export interface NumberedListBlock extends BaseBlock {
  type: 'numberedList';
  title?: string;
  items: string[];
}

export interface StepByStepBlock extends BaseBlock {
  type: 'stepByStep';
  title?: string;
  steps: Array<{
    label?: string;
    content: string;
  }>;
}

export interface TipBlock extends BaseBlock {
  type: 'tip';
  text: string;
}

export interface NoteBlock extends BaseBlock {
  type: 'note';
  text: string;
}

export interface WarningBlock extends BaseBlock {
  type: 'warning';
  text: string;
}

export interface QuestionBlock extends BaseBlock {
  type: 'question';
  text: string;
  hint?: string;
}

export interface AnswerBlock extends BaseBlock {
  type: 'answer';
  text: string;
  explanation?: string;
}

export interface DefinitionBlock extends BaseBlock {
  type: 'definition';
  term: string;
  definition: string;
  example?: string;
}

export interface VocabularyBlock extends BaseBlock {
  type: 'vocabulary';
  terms: Array<{
    term: string;
    definition: string;
    example?: string;
  }>;
}

export interface TableBlock extends BaseBlock {
  type: 'table';
  title?: string;
  headers?: string[];
  rows: string[][];
}

export interface DividerBlock extends BaseBlock {
  type: 'divider';
  style?: 'solid' | 'dashed' | 'section';
  label?: string;
}

// Union type for all content blocks
export type ContentBlock =
  | MetadataBlock
  | HeaderBlock
  | ParagraphBlock
  | ExplanationBlock
  | ExampleBlock
  | KeyConceptBlock
  | RuleBlock
  | FormulaBlock
  | WordProblemBlock
  | BulletListBlock
  | NumberedListBlock
  | StepByStepBlock
  | TipBlock
  | NoteBlock
  | WarningBlock
  | QuestionBlock
  | AnswerBlock
  | DefinitionBlock
  | VocabularyBlock
  | TableBlock
  | DividerBlock;

// ============================================================================
// STRUCTURED CONTENT
// ============================================================================

export interface StructuredContent {
  /**
   * Content blocks in order of appearance
   */
  blocks: ContentBlock[];

  /**
   * Overall document metadata
   */
  documentInfo?: {
    totalSections?: number;
    hasProblems?: boolean;
    hasFormulas?: boolean;
    estimatedReadTime?: string;
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Type guard to check if a block is a specific type
 */
export function isBlockType<T extends ContentBlock>(
  block: ContentBlock,
  type: T['type']
): block is T {
  return block.type === type;
}

/**
 * Create a unique block ID
 */
export function createBlockId(type: ContentBlockType, index: number): string {
  return `${type}-${index}`;
}

/**
 * Validate a content block structure
 */
export function validateBlock(block: unknown): block is ContentBlock {
  if (!block || typeof block !== 'object') return false;
  const b = block as Record<string, unknown>;
  if (typeof b.type !== 'string') return false;

  const validTypes: ContentBlockType[] = [
    'metadata', 'header', 'paragraph', 'explanation', 'example',
    'keyConceptBox', 'rule', 'formula', 'wordProblem', 'bulletList',
    'numberedList', 'stepByStep', 'tip', 'note', 'warning', 'question',
    'answer', 'definition', 'vocabulary', 'table', 'divider'
  ];

  return validTypes.includes(b.type as ContentBlockType);
}

/**
 * Validate an array of content blocks
 */
export function validateBlocks(blocks: unknown): blocks is ContentBlock[] {
  if (!Array.isArray(blocks)) return false;
  return blocks.every(validateBlock);
}
