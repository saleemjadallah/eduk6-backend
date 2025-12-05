# Orbit Learn Backend

Educational learning platform backend for kids, built with Node.js, Express, TypeScript, and Prisma.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **AI**: Google Gemini (Flash 2.5 for analysis, Pro for complex tasks)
- **Queue**: BullMQ with Redis
- **Auth**: JWT-based with parent/child sessions

## Project Structure

```
src/
├── config/           # Configuration (Gemini, database, etc.)
├── middleware/       # Express middleware (auth, validation)
├── routes/           # API route handlers
├── services/
│   ├── ai/           # Gemini AI services
│   ├── formatting/   # Document formatting (hybrid approach)
│   └── learning/     # Lesson, content processing services
└── utils/            # Logger, helpers
```

## Content Formatting System (Hybrid Approach)

The system uses a **hybrid AI + deterministic rendering** approach for 100% reliable, beautiful document formatting:

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Content Upload (PDF/Text)                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Gemini AI Analysis (geminiService.ts)           │
│  - Extracts: title, summary, vocabulary, exercises          │
│  - Extracts: contentBlocks[] (semantic structure)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│            DocumentFormatter (documentFormatter.ts)          │
│  - Checks if contentBlocks available                        │
│  - If YES → StructuredRenderer (beautiful styled HTML)      │
│  - If NO  → Heuristic formatting (fallback)                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Formatted HTML Output                     │
│  - 100% reliable (deterministic rendering)                  │
│  - Age-appropriate styling (YOUNG vs OLDER)                 │
│  - Color-coded blocks (word problems, rules, formulas)      │
└─────────────────────────────────────────────────────────────┘
```

### Content Block Types

The AI extracts these semantic block types (`src/services/formatting/contentBlocks.ts`):

| Block Type | Purpose | Styling |
|------------|---------|---------|
| `metadata` | Grade, subject, duration | Purple gradient bar |
| `header` | Section headers (h1-h4) | Blue themed |
| `keyConceptBox` | Important concepts | Yellow box with lightbulb |
| `rule` | Mathematical/grammar rules | Blue box with steps |
| `formula` | Math formulas | Yellow dashed border |
| `wordProblem` | Multi-step problems | Purple header, color-coded sections |
| `stepByStep` | Procedural steps | Green with numbered circles |
| `tip` / `note` / `warning` | Callout boxes | Green/Blue/Yellow |
| `question` / `answer` | Q&A pairs | Indigo/Green |
| `vocabulary` | Term definitions | Pink themed |
| `table` | Data tables | Striped rows |
| `bulletList` / `numberedList` | Lists | Standard styling |
| `divider` | Section breaks | Solid/dashed/labeled |

### Key Files

| File | Purpose |
|------|---------|
| `services/formatting/contentBlocks.ts` | TypeScript interfaces for all block types |
| `services/formatting/structuredRenderer.ts` | Renders blocks to styled HTML (1200+ lines of CSS) |
| `services/formatting/documentFormatter.ts` | Main formatter with hybrid logic |
| `services/formatting/mathFormatter.ts` | Math expression formatting (fractions, equations) |
| `services/ai/promptBuilder.ts` | AI prompts including contentBlocks extraction |
| `services/ai/geminiService.ts` | Gemini API integration |

### Word Problem Rendering

Word problems get special treatment with color-coded sections:

```
┌─────────────────────────────────────────┐
│ 🍕 Pizza Party!            (purple bar) │
├─────────────────────────────────────────┤
│ Problem:    (purple)  The problem text  │
│ Understand: (green)   What we know      │
│ Set up:     (blue)    The equation      │
│ Calculate:  (yellow)  The math steps    │
│ Simplify:   (orange)  Reduce if needed  │
│ Answer:     (green)   Final answer      │
└─────────────────────────────────────────┘
```

### Age-Appropriate Styling

- **YOUNG (4-7)**: Larger fonts (1.1rem), more line height (1.8), vibrant colors
- **OLDER (8-12)**: Standard fonts (1rem), normal line height (1.7), subtle colors

## API Endpoints

### Lesson Analysis
```
POST /api/lessons/analyze
Body: { content, childId?, sourceType, subject?, title? }
Returns: { lesson, analysis }
```

### Content Processing
```
POST /api/lessons/process
Body: { content, task: 'study_guide'|'summary'|'explain'|'simplify', childId? }
```

## Environment Variables

```env
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
REDIS_URL=redis://...
JWT_SECRET=...
```

## Running

```bash
npm install
npm run dev      # Development with hot reload
npm run build    # TypeScript compilation
npm start        # Production
```
