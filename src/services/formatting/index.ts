/**
 * Formatting Services
 *
 * Deterministic, 100% reliable document formatting for educational content.
 * Replaces the unreliable AI formatting call with rule-based heuristic formatting.
 *
 * Hybrid Approach:
 * 1. AI extracts rich content blocks (structure, semantics)
 * 2. StructuredRenderer renders blocks beautifully with 100% reliability
 */

export {
  DocumentFormatter,
  documentFormatter,
  type Chapter,
  type VocabularyItem,
  type Exercise,
  type DocumentFormatterOptions,
} from './documentFormatter.js';

export {
  MathFormatter,
  mathFormatter,
  mathFormatterStyles,
} from './mathFormatter.js';

export {
  StructuredRenderer,
  structuredRenderer,
  structuredRendererStyles,
  type StructuredRendererOptions,
} from './structuredRenderer.js';

export {
  type ContentBlock,
  type ContentBlockType,
  type StructuredContent,
  type MetadataBlock,
  type HeaderBlock,
  type ParagraphBlock,
  type ExplanationBlock,
  type ExampleBlock,
  type KeyConceptBlock,
  type RuleBlock,
  type FormulaBlock,
  type WordProblemBlock,
  type BulletListBlock,
  type NumberedListBlock,
  type StepByStepBlock,
  type TipBlock,
  type NoteBlock,
  type WarningBlock,
  type QuestionBlock,
  type AnswerBlock,
  type DefinitionBlock,
  type VocabularyBlock,
  type TableBlock,
  type DividerBlock,
  validateBlock,
  validateBlocks,
  createBlockId,
  isBlockType,
} from './contentBlocks.js';
