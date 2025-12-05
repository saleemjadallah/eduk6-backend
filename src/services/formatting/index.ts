/**
 * Formatting Services
 *
 * Deterministic, 100% reliable document formatting for educational content.
 * Replaces the unreliable AI formatting call with rule-based heuristic formatting.
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
