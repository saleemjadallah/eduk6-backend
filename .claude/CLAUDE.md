# Orbit Learn Backend

Educational learning platform backend for kids, built with Node.js, Express, TypeScript, and Prisma.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **AI**: Google Gemini (Flash 2.5 for analysis, Pro for complex tasks)
- **Queue**: BullMQ with Redis
- **Auth**: JWT-based with parent/child/teacher sessions

## Project Structure

```
src/
├── config/           # Configuration (Gemini, database, etc.)
├── middleware/       # Express middleware (auth, validation, quota)
├── routes/
│   ├── auth.routes.ts      # Parent/child authentication
│   ├── lessons.routes.ts   # Lesson management
│   └── teacher/            # Teacher portal routes
│       ├── index.ts        # Teacher route mounting
│       ├── auth.routes.ts  # Teacher authentication
│       └── quota.routes.ts # Token quota management
├── services/
│   ├── ai/           # Gemini AI services
│   ├── auth/         # Session management
│   ├── formatting/   # Document formatting (hybrid approach)
│   ├── learning/     # Lesson, content processing services
│   └── teacher/      # Teacher-specific services
│       ├── index.ts
│       ├── teacherAuthService.ts
│       └── quotaService.ts
├── types/            # TypeScript type extensions
└── utils/            # Logger, helpers
```

---

## Teacher Portal (Phase 1 Complete)

### Overview

The teacher portal is a separate section for educators to create AI-powered educational content and grade papers. It has:
- Separate authentication from parent/child users
- Token-based quota system for AI operations
- Tier-based subscription model (FREE, BASIC, PROFESSIONAL)

### Database Models

All teacher models are defined in `prisma/schema.prisma`:

| Model | Purpose |
|-------|---------|
| `Teacher` | Teacher accounts with auth, subscription, quota tracking |
| `Organization` | Schools/districts with org-level quotas |
| `TokenUsageLog` | Per-teacher AI usage tracking |
| `OrgTokenUsageLog` | Organization-level usage tracking |
| `Rubric` | Grading rubrics with criteria (JSON) |
| `GradingJob` | Batch grading jobs |
| `GradingSubmission` | Individual student submissions |
| `TeacherContent` | Lessons, quizzes, flashcards created by teachers |
| `ContentTemplate` | Reusable content templates |
| `Classroom` | Future classroom management |

### Key Enums

```prisma
enum TeacherRole { TEACHER, ADMIN, SUPER_ADMIN }
enum TeacherSubscriptionTier { FREE, BASIC, PROFESSIONAL }
enum OrgSubscriptionTier { STARTER, PROFESSIONAL, ENTERPRISE }
enum TokenOperation {
  CONTENT_ANALYSIS, LESSON_GENERATION, QUIZ_GENERATION,
  FLASHCARD_GENERATION, GRADING_SINGLE, GRADING_BATCH,
  FEEDBACK_GENERATION, INFOGRAPHIC_GENERATION, OTHER
}
enum ScoringType { POINTS, PERCENTAGE, LETTER_GRADE, PASS_FAIL }
enum GradingJobStatus { PENDING, PROCESSING, COMPLETED, FAILED }
enum SubmissionStatus { PENDING, GRADED, FLAGGED, REVIEWED, FINALIZED }
```

### Subscription Tiers & Quotas

| Tier | Monthly Tokens | Target |
|------|---------------|--------|
| FREE | 100,000 | Individual teachers trying the platform |
| BASIC | 500,000 | Active individual teachers |
| PROFESSIONAL | 2,000,000 | Power users |
| ORG_STARTER | 1,000,000 | Small schools |
| ORG_PROFESSIONAL | 5,000,000 | Medium schools |
| ORG_ENTERPRISE | Custom | Large districts |

### Teacher Authentication

**Middleware** (`src/middleware/teacherAuth.ts`):
- `authenticateTeacher` - Validates JWT, attaches `req.teacher`
- `requireTeacher` - Ensures authenticated teacher
- `requireOrgAdmin` - Requires ADMIN or SUPER_ADMIN role
- `requireVerifiedEmail` - Ensures email is verified
- `requireActiveSubscription` - Checks subscription status

**Service** (`src/services/teacher/teacherAuthService.ts`):
- `signup()` - Create account, send verification email
- `login()` - Authenticate, return tokens + quota info
- `verifyEmail()` - Verify with 6-digit OTP
- `refreshToken()` - Token rotation with reuse detection
- `forgotPassword()` / `resetPassword()` - Password recovery
- `changePassword()` - Authenticated password change

**Routes** (`src/routes/teacher/auth.routes.ts`):
```
POST /api/teacher/auth/signup      - Create teacher account
POST /api/teacher/auth/login       - Sign in
POST /api/teacher/auth/refresh     - Refresh access token
POST /api/teacher/auth/logout      - Sign out (invalidate refresh token)
POST /api/teacher/auth/logout-all  - Sign out all sessions
POST /api/teacher/auth/verify-email     - Verify email with OTP
POST /api/teacher/auth/resend-verification - Resend OTP
POST /api/teacher/auth/forgot-password  - Request password reset
POST /api/teacher/auth/verify-reset-code - Verify reset code
POST /api/teacher/auth/reset-password   - Set new password
POST /api/teacher/auth/change-password  - Change password (authed)
GET  /api/teacher/auth/me          - Get current teacher
PATCH /api/teacher/auth/profile    - Update profile
DELETE /api/teacher/auth/delete-account - Delete account
```

### Token Quota System

**Service** (`src/services/teacher/quotaService.ts`):
- `checkQuota()` - Pre-flight check before AI operations
- `recordUsage()` - Log token consumption after operations
- `getUsageStats()` - Usage analytics by period
- `getQuotaInfo()` - Current quota status
- `enforceQuota()` - Throws if quota exceeded
- `resetAllMonthlyQuotas()` - Cron job for monthly reset

**Middleware** (`src/middleware/tokenQuota.ts`):
- `enforceTokenQuota(operation, estimatedTokens?)` - Pre-request quota check
- `enforceTokenQuotaDynamic(operation, getEstimate)` - Dynamic estimation
- `estimateFromContent(field)` - Estimate tokens from text length
- `estimateForGrading(field)` - Estimate for batch grading

**Routes** (`src/routes/teacher/quota.routes.ts`):
```
GET /api/teacher/quota         - Get quota info (used, remaining, reset date)
GET /api/teacher/quota/usage   - Detailed usage stats (day/week/month)
GET /api/teacher/quota/check   - Pre-flight check for specific operation
```

### Token Cost Estimates

| Operation | Est. Tokens | Model |
|-----------|-------------|-------|
| Lesson analysis | 2,000-5,000 | gemini-2.5-flash |
| Quiz generation (10 Qs) | 1,500 | gemini-2.5-flash |
| Flashcard generation (20 cards) | 1,000 | gemini-2.5-flash |
| Single paper grading | 2,000-4,000 | gemini-3-pro |
| Batch grading (30 papers) | 60,000-120,000 | gemini-3-pro |

---

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

---

## API Endpoints

### Parent/Child Authentication
```
POST /api/auth/signup          - Parent signup
POST /api/auth/login           - Parent login
POST /api/auth/refresh         - Refresh token
POST /api/auth/logout          - Logout
GET  /api/auth/me              - Get current user + children
```

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

### Teacher Portal (see above for full list)
```
/api/teacher/auth/*    - Teacher authentication
/api/teacher/quota/*   - Token quota management
```

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://...

# AI
GEMINI_API_KEY=...

# Redis
REDIS_URL=redis://...

# Auth
JWT_SECRET=...
JWT_REFRESH_SECRET=...

# Email (for verification)
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
```

---

## Running

```bash
npm install
npx prisma generate   # Generate Prisma client
npx prisma db push    # Sync schema to database
npm run dev           # Development with hot reload
npm run build         # TypeScript compilation
npm start             # Production
```

---

## Next Steps (Teacher Portal Phase 2+)

The following features are planned but not yet implemented:

### Content Creation
- [ ] `TeacherContent` CRUD routes
- [ ] AI-assisted lesson generation (extend `geminiService.ts`)
- [ ] Quiz generation from content
- [ ] Flashcard generation
- [ ] Infographic generation

### Grading System
- [ ] `Rubric` CRUD routes + RubricBuilder UI
- [ ] Paper upload with text extraction
- [ ] `gradingService.ts` - Rubric-based AI grading
- [ ] Batch processing with BullMQ
- [ ] Confidence scores + flagging for review
- [ ] Teacher override interface
- [ ] Feedback generation

### Organization Features
- [ ] Organization admin dashboard
- [ ] Teacher invitations
- [ ] Org-level quota management

### Billing
- [ ] Stripe integration
- [ ] Subscription upgrade/downgrade
- [ ] Usage-based billing for enterprise

---

## Test Account

For local development testing:
- **Email**: `teacher@test.com`
- **Password**: `Teacher123`
- **Tier**: FREE (100K tokens/month)
