/**
 * Math Formatter Service
 *
 * Handles formatting of mathematical expressions, fractions, equations,
 * and operation sequences for educational content.
 *
 * Designed for ages 4-12 with age-appropriate visual styling.
 */

export class MathFormatter {
  /**
   * Format all math expressions in the text
   */
  formatMathExpressions(text: string): string {
    let result = text;

    // Order matters: more specific patterns first

    // 1. Fraction multiplication: 1/2 × 1/4 = 1/8
    result = result.replace(
      /(\d+\/\d+)\s*[x×]\s*(\d+\/\d+)\s*=\s*(\d+\/\d+)/g,
      '<code class="math fraction-operation">$1 × $2 = $3</code>'
    );

    // 2. Fraction division: 1/2 ÷ 1/4 = 2
    result = result.replace(
      /(\d+\/\d+)\s*[÷/]\s*(\d+\/\d+)\s*=\s*(\d+(?:\/\d+)?)/g,
      '<code class="math fraction-operation">$1 ÷ $2 = $3</code>'
    );

    // 3. Fraction equality: 1/2 = 2/4
    result = result.replace(
      /(\d+\/\d+)\s*=\s*(\d+\/\d+)/g,
      '<code class="math fraction-equality">$1 = $2</code>'
    );

    // 4. Simple multiplication equations: 3 × 4 = 12
    result = result.replace(
      /(\d+)\s*[x×]\s*(\d+)\s*=\s*(\d+)/g,
      '<code class="math multiplication">$1 × $2 = $3</code>'
    );

    // 5. Simple division equations: 12 ÷ 3 = 4
    result = result.replace(
      /(\d+)\s*[÷/]\s*(\d+)\s*=\s*(\d+)/g,
      '<code class="math division">$1 ÷ $2 = $3</code>'
    );

    // 6. Addition equations: 5 + 3 = 8
    result = result.replace(
      /(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)/g,
      '<code class="math addition">$1 + $2 = $3</code>'
    );

    // 7. Subtraction equations: 8 - 3 = 5
    result = result.replace(
      /(\d+)\s*-\s*(\d+)\s*=\s*(\d+)/g,
      '<code class="math subtraction">$1 - $2 = $3</code>'
    );

    // 8. Fill-in-the-blank style: 1/2 × ___ = 1/8 or 1/2 × ? = 1/8
    result = result.replace(
      /(\d+\/\d+|\d+)\s*[x×+\-÷]\s*[_?]+\s*=\s*(\d+\/\d+|\d+)/g,
      (match) => `<code class="math fill-blank">${match.replace(/[_]+/g, '___').replace(/\?/g, '?')}</code>`
    );

    // 9. Standalone fractions (not already wrapped): 1/2, 3/4, etc.
    // Use negative lookbehind/ahead to avoid double-wrapping
    result = result.replace(
      /(?<!class="math[^"]*">)(?<!")\b(\d+\/\d+)\b(?!<\/code>)/g,
      '<span class="fraction">$1</span>'
    );

    // 10. Comparison expressions: 1/2 > 1/4, 2/3 < 3/4
    result = result.replace(
      /(\d+\/\d+)\s*([<>≤≥=])\s*(\d+\/\d+)/g,
      '<code class="math comparison">$1 $2 $3</code>'
    );

    // 11. Number comparisons: 5 > 3, 2 < 8
    result = result.replace(
      /(\d+)\s*([<>≤≥])\s*(\d+)/g,
      '<code class="math comparison">$1 $2 $3</code>'
    );

    // 12. Algebraic expressions: a + b, x × y
    result = result.replace(
      /\b([a-z])\s*([+\-×÷])\s*([a-z])\b/gi,
      '<code class="math algebraic">$1 $2 $3</code>'
    );

    // 13. Parenthesized expressions: (a × b) / (c × d)
    result = result.replace(
      /\(([^)]+)\)\s*[/÷]\s*\(([^)]+)\)/g,
      '<code class="math parenthesized">($1) ÷ ($2)</code>'
    );

    return result;
  }

  /**
   * Format a standalone fraction for visual display
   */
  formatFraction(numerator: number | string, denominator: number | string): string {
    return `<span class="fraction" data-numerator="${numerator}" data-denominator="${denominator}">${numerator}/${denominator}</span>`;
  }

  /**
   * Format an equation with proper styling
   */
  formatEquation(equation: string): string {
    // Normalize operators
    let normalized = equation
      .replace(/\*/g, '×')
      .replace(/x(?=\s*\d)/gi, '×')
      .replace(/\//g, '÷');

    return `<code class="math equation">${normalized}</code>`;
  }

  /**
   * Detect if text contains math content
   */
  containsMath(text: string): boolean {
    const mathPatterns = [
      /\d+\/\d+/,           // Fractions
      /\d+\s*[×÷+\-=]\s*\d+/, // Operations
      /[a-z]\s*[×÷+\-=]\s*[a-z]/i, // Algebraic
      /\([^)]+\)\s*[×÷+\-=]/, // Parenthesized
    ];

    return mathPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Extract all math expressions from text
   */
  extractMathExpressions(text: string): string[] {
    const expressions: string[] = [];

    // Fraction operations
    const fractionOps = text.match(/\d+\/\d+\s*[×÷+\-=]\s*\d+(?:\/\d+)?(?:\s*=\s*\d+(?:\/\d+)?)?/g);
    if (fractionOps) expressions.push(...fractionOps);

    // Simple operations
    const simpleOps = text.match(/\d+\s*[×÷+\-]\s*\d+\s*=\s*\d+/g);
    if (simpleOps) expressions.push(...simpleOps);

    // Standalone fractions
    const fractions = text.match(/\b\d+\/\d+\b/g);
    if (fractions) expressions.push(...fractions);

    return [...new Set(expressions)]; // Remove duplicates
  }
}

/**
 * CSS styles for math formatting
 * Include these in your frontend stylesheet
 */
export const mathFormatterStyles = `
  /* Base math styling */
  .math {
    font-family: 'Computer Modern', 'Latin Modern Math', 'Cambria Math', Georgia, serif;
    background: #fef3c7;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-weight: 500;
    white-space: nowrap;
  }

  /* Fraction styling */
  .fraction {
    font-family: 'Computer Modern', Georgia, serif;
    font-weight: 600;
    color: #4338ca;
  }

  /* Operation-specific colors */
  .math.multiplication {
    background: #dbeafe;
    color: #1e40af;
  }

  .math.division {
    background: #fce7f3;
    color: #9d174d;
  }

  .math.addition {
    background: #dcfce7;
    color: #166534;
  }

  .math.subtraction {
    background: #fee2e2;
    color: #991b1b;
  }

  .math.fraction-operation {
    background: #fef9c3;
    color: #854d0e;
  }

  .math.fill-blank {
    background: #f3e8ff;
    color: #6b21a8;
    border: 1px dashed #a855f7;
  }

  .math.comparison {
    background: #e0e7ff;
    color: #3730a3;
  }

  .math.algebraic {
    background: #f0fdfa;
    color: #0f766e;
    font-style: italic;
  }

  /* Age-specific adjustments */
  .age-young .math {
    font-size: 1.2em;
    padding: 0.25rem 0.5rem;
    border-radius: 0.5rem;
  }

  .age-young .fraction {
    font-size: 1.25em;
    font-weight: 700;
  }

  .age-older .math {
    font-size: 1em;
  }

  /* Interactive exercise math */
  .interactive-exercise .math {
    background: rgba(251, 191, 36, 0.2);
    border: 1px solid rgba(251, 191, 36, 0.5);
  }
`;

// Export singleton instance
export const mathFormatter = new MathFormatter();
