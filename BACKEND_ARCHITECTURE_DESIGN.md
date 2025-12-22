# NanoBanana Backend Architecture
## K-6 AI Learning Platform - Production Backend Design

**Target Deployment:** Railway (GitHub → Railway CI/CD)
**Stack:** Node.js + Express + TypeScript, PostgreSQL, Redis, Cloudflare R2

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Database Schema](#3-database-schema)
4. [API Design](#4-api-design)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [AI Integration Layer](#6-ai-integration-layer)
7. [Content Processing Pipeline](#7-content-processing-pipeline)
8. [Gamification Engine](#8-gamification-engine)
9. [Safety & Compliance](#9-safety--compliance)
10. [Caching Strategy](#10-caching-strategy)
11. [File Storage (R2)](#11-file-storage-r2)
12. [Environment Configuration](#12-environment-configuration)
13. [Railway Deployment](#13-railway-deployment)
14. [Implementation Roadmap](#14-implementation-roadmap)

---

## 1. Architecture Overview

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                        │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐            │
│   │  React Web App  │    │   Flutter iOS   │    │ Flutter Android │            │
│   │   (claude.ai)   │    │                 │    │                 │            │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘            │
└────────────┼─────────────────────┼─────────────────────┼───────────────────────┘
             │                      │                      │
             └──────────────────────┼──────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY                                         │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │  Express Server (Railway)                                                │   │
│   │  - Rate Limiting (express-rate-limit)                                   │   │
│   │  - CORS (configured for frontend origins)                               │   │
│   │  - Helmet (security headers)                                            │   │
│   │  - Request Logging (morgan + winston)                                   │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────┐    ┌────────────────────┐    ┌─────────────────────┐
│  AUTH SERVICE │    │  LEARNING SERVICE  │    │  GAMIFICATION SVC   │
│               │    │                    │    │                     │
│ - JWT/Refresh │    │ - Lesson CRUD      │    │ - XP Engine         │
│ - Parent Auth │    │ - Content Process  │    │ - Streak Tracker    │
│ - Child PIN   │    │ - Chat w/ Gemini   │    │ - Badge Unlocks     │
│ - Consent     │    │ - Flashcards       │    │ - Leaderboards      │
│ - Sessions    │    │ - Quizzes          │    │ - Daily Challenges  │
└───────┬───────┘    └─────────┬──────────┘    └──────────┬──────────┘
        │                      │                          │
        └──────────────────────┼──────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                             │
│                                                                                  │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────────┐│
│   │   PostgreSQL    │    │     Redis       │    │    Cloudflare R2            ││
│   │   (Railway)     │    │   (Railway)     │    │    (Object Storage)         ││
│   │                 │    │                 │    │                             ││
│   │ - Users/Auth    │    │ - Sessions      │    │ - PDF uploads               ││
│   │ - Lessons       │    │ - Rate limits   │    │ - AI-generated images       ││
│   │ - Progress      │    │ - Cache         │    │ - Voice audio (TTS)         ││
│   │ - Gamification  │    │ - Job queues    │    │ - User content              ││
│   │ - Safety logs   │    │ - Real-time     │    │                             ││
│   └─────────────────┘    └─────────────────┘    └─────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL SERVICES                                        │
│                                                                                  │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐            │
│   │  Google Vertex  │    │   ElevenLabs    │    │     Stripe      │            │
│   │                 │    │                 │    │                 │            │
│   │ - Gemini Chat   │    │ - Jeffrey TTS   │    │ - Subscriptions │            │
│   │ - Content Gen   │    │ - Arabic Voice  │    │ - Consent CC    │            │
│   │ - Vision API    │    │ - Child Voices  │    │ - Payments      │            │
│   │ - Safety Filter │    │                 │    │                 │            │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── index.ts              # Environment config loader
│   │   ├── database.ts           # PostgreSQL connection
│   │   ├── redis.ts              # Redis connection
│   │   ├── r2.ts                 # Cloudflare R2 client
│   │   └── gemini.ts             # Gemini AI configuration
│   │
│   ├── middleware/
│   │   ├── auth.ts               # JWT verification
│   │   ├── requireParent.ts      # Parent-only routes
│   │   ├── requireChild.ts       # Child session routes
│   │   ├── requireConsent.ts     # COPPA consent check
│   │   ├── rateLimit.ts          # Rate limiting configs
│   │   ├── errorHandler.ts       # Global error handler
│   │   ├── requestLogger.ts      # Request/response logging
│   │   └── validateInput.ts      # Zod schema validation
│   │
│   ├── routes/
│   │   ├── index.ts              # Route aggregator
│   │   ├── auth.routes.ts        # /api/auth/*
│   │   ├── parent.routes.ts      # /api/parent/*
│   │   ├── child.routes.ts       # /api/child/*
│   │   ├── lessons.routes.ts     # /api/lessons/*
│   │   ├── chat.routes.ts        # /api/chat/*
│   │   ├── flashcards.routes.ts  # /api/flashcards/*
│   │   ├── gamification.routes.ts # /api/gamification/*
│   │   ├── uploads.routes.ts     # /api/uploads/*
│   │   └── admin.routes.ts       # /api/admin/* (internal)
│   │
│   ├── services/
│   │   ├── auth/
│   │   │   ├── authService.ts        # Login, signup, tokens
│   │   │   ├── tokenService.ts       # JWT generation/verification
│   │   │   ├── sessionService.ts     # Redis session management
│   │   │   └── consentService.ts     # COPPA verification
│   │   │
│   │   ├── ai/
│   │   │   ├── geminiService.ts      # Core Gemini API wrapper
│   │   │   ├── promptBuilder.ts      # Context-aware prompts
│   │   │   ├── safetyFilters.ts      # Input/output filtering
│   │   │   ├── responseValidator.ts  # Post-generation validation
│   │   │   └── contentGenerator.ts   # Flashcards, quizzes, etc.
│   │   │
│   │   ├── learning/
│   │   │   ├── lessonService.ts      # Lesson CRUD
│   │   │   ├── contentProcessor.ts   # PDF/image/video processing
│   │   │   ├── flashcardService.ts   # Flashcard management
│   │   │   ├── quizService.ts        # Quiz generation
│   │   │   └── progressService.ts    # Learning progress tracking
│   │   │
│   │   ├── gamification/
│   │   │   ├── xpEngine.ts           # XP calculations & awards
│   │   │   ├── streakService.ts      # Daily streak tracking
│   │   │   ├── badgeService.ts       # Achievement unlocks
│   │   │   ├── challengeService.ts   # Daily challenges
│   │   │   └── leaderboardService.ts # Rankings (privacy-safe)
│   │   │
│   │   ├── storage/
│   │   │   ├── r2Service.ts          # R2 upload/download
│   │   │   ├── imageService.ts       # Image optimization
│   │   │   └── audioService.ts       # TTS audio storage
│   │   │
│   │   ├── monitoring/
│   │   │   ├── safetyLogger.ts       # Safety incident logging
│   │   │   ├── parentAlerts.ts       # Parent notification system
│   │   │   └── analyticsService.ts   # Usage analytics
│   │   │
│   │   └── external/
│   │       ├── elevenLabsService.ts  # TTS generation
│   │       ├── stripeService.ts      # Payment/subscription
│   │       └── emailService.ts       # Transactional email
│   │
│   ├── models/
│   │   ├── Parent.ts
│   │   ├── Child.ts
│   │   ├── Consent.ts
│   │   ├── Lesson.ts
│   │   ├── LessonContent.ts
│   │   ├── ChatMessage.ts
│   │   ├── Flashcard.ts
│   │   ├── FlashcardDeck.ts
│   │   ├── Quiz.ts
│   │   ├── UserProgress.ts
│   │   ├── XPTransaction.ts
│   │   ├── Badge.ts
│   │   ├── Streak.ts
│   │   ├── SafetyLog.ts
│   │   └── Subscription.ts
│   │
│   ├── schemas/
│   │   ├── auth.schema.ts        # Zod schemas for auth
│   │   ├── lesson.schema.ts      # Zod schemas for lessons
│   │   ├── chat.schema.ts        # Zod schemas for chat
│   │   └── common.schema.ts      # Shared schemas
│   │
│   ├── utils/
│   │   ├── encryption.ts         # AES-256 for sensitive data
│   │   ├── validation.ts         # Common validators
│   │   ├── dateUtils.ts          # Timezone-aware date handling
│   │   ├── tokenUtils.ts         # Token generation helpers
│   │   └── constants.ts          # App constants
│   │
│   ├── jobs/
│   │   ├── jobQueue.ts           # BullMQ queue setup
│   │   ├── processors/
│   │   │   ├── contentProcessor.ts   # Async content processing
│   │   │   ├── imageGenerator.ts     # AI image generation
│   │   │   ├── ttsGenerator.ts       # Voice synthesis
│   │   │   └── reportGenerator.ts    # Parent reports
│   │   └── schedulers/
│   │       ├── streakChecker.ts      # Midnight streak reset
│   │       ├── challengeRotator.ts   # Daily challenge generation
│   │       └── cleanupJob.ts         # Old data cleanup
│   │
│   ├── types/
│   │   ├── express.d.ts          # Express request extensions
│   │   ├── api.types.ts          # API request/response types
│   │   └── domain.types.ts       # Business domain types
│   │
│   └── app.ts                    # Express app setup
│   └── server.ts                 # Server entry point
│
├── prisma/
│   ├── schema.prisma             # Database schema
│   └── migrations/               # Migration files
│
├── tests/
│   ├── unit/                     # Unit tests
│   ├── integration/              # Integration tests
│   └── e2e/                      # End-to-end tests
│
├── scripts/
│   ├── seed.ts                   # Database seeding
│   └── migrate.ts                # Migration runner
│
├── .env.example                  # Environment template
├── .env.local                    # Local development (gitignored)
├── package.json
├── tsconfig.json
├── Dockerfile                    # For Railway
└── railway.json                  # Railway configuration
```

---

## 3. Database Schema

### Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// AUTHENTICATION & USERS
// ============================================

model Parent {
  id                String    @id @default(uuid())
  email             String    @unique
  passwordHash      String
  firstName         String?
  lastName          String?
  phone             String?
  country           String    @default("AE")
  timezone          String    @default("Asia/Dubai")
  
  // Email verification
  emailVerified     Boolean   @default(false)
  emailVerifiedAt   DateTime?
  
  // Consent tracking
  consents          Consent[]
  
  // Subscription
  subscriptionTier  SubscriptionTier @default(FREE)
  subscriptionStatus SubscriptionStatus @default(ACTIVE)
  stripeCustomerId  String?
  subscriptionExpiresAt DateTime?
  
  // Relationships
  children          Child[]
  
  // Timestamps
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  lastLoginAt       DateTime?
  
  @@index([email])
}

model Child {
  id                String    @id @default(uuid())
  parentId          String
  parent            Parent    @relation(fields: [parentId], references: [id], onDelete: Cascade)
  
  // Profile
  displayName       String    // "Banana Explorer", etc. (no real name required)
  avatarUrl         String?
  pin               String    @db.Char(4)  // 4-digit PIN for profile switching
  dateOfBirth       DateTime  // For age calculation, never exposed
  ageGroup          AgeGroup  // Calculated: 4-7 or 8-12
  
  // Learning preferences
  gradeLevel        Int?      // 1-6
  curriculumType    CurriculumType?
  preferredLanguage String    @default("en")
  learningStyle     LearningStyle?
  
  // Privacy settings
  voiceEnabled      Boolean   @default(true)
  avatarVisible     Boolean   @default(true)
  
  // Relationships
  lessons           Lesson[]
  chatMessages      ChatMessage[]
  flashcardDecks    FlashcardDeck[]
  progress          UserProgress?
  xpTransactions    XPTransaction[]
  earnedBadges      EarnedBadge[]
  streak            Streak?
  safetyLogs        SafetyLog[]
  textSelections    TextSelection[]
  
  // Timestamps
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  lastActiveAt      DateTime?
  
  @@index([parentId])
}

model Consent {
  id                String    @id @default(uuid())
  parentId          String
  parent            Parent    @relation(fields: [parentId], references: [id], onDelete: Cascade)
  
  // Verification method
  method            ConsentMethod
  status            ConsentStatus
  
  // Verification details (encrypted)
  verificationData  Json?     // Encrypted transaction ID, etc.
  ipAddress         String?
  userAgent         String?
  
  // Timestamps
  consentGivenAt    DateTime?
  expiresAt         DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  
  @@index([parentId, status])
}

// ============================================
// LEARNING CONTENT
// ============================================

model Lesson {
  id                String    @id @default(uuid())
  childId           String
  child             Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  
  // Content metadata
  title             String
  summary           String?   @db.Text
  subject           Subject?
  gradeLevel        String?
  sourceType        SourceType
  
  // Original content reference
  originalFileUrl   String?   // R2 URL
  originalFileName  String?
  originalFileSize  Int?
  youtubeUrl        String?
  youtubeVideoId    String?
  
  // AI-processed content
  extractedText     String?   @db.Text
  chapters          Json?     // Array of chapter objects
  keyConcepts       String[]  // For chat context
  vocabulary        Json?     // Array of {term, definition, example}
  suggestedQuestions String[]
  
  // Processing status
  processingStatus  ProcessingStatus @default(PENDING)
  processingError   String?
  aiConfidence      Float?    // 0-1 confidence score
  
  // Safety review
  safetyReviewed    Boolean   @default(false)
  safetyFlags       String[]  // Any flagged content
  
  // Relationships
  chatMessages      ChatMessage[]
  flashcardDecks    FlashcardDeck[]
  quizzes           Quiz[]
  textSelections    TextSelection[]
  
  // Progress
  percentComplete   Float     @default(0)
  lastAccessedAt    DateTime?
  timeSpentSeconds  Int       @default(0)
  
  // Timestamps
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  
  @@index([childId, createdAt])
  @@index([processingStatus])
}

model ChatMessage {
  id                String    @id @default(uuid())
  childId           String
  child             Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  lessonId          String?
  lesson            Lesson?   @relation(fields: [lessonId], references: [id], onDelete: SetNull)
  
  // Message content
  role              MessageRole
  content           String    @db.Text
  
  // AI metadata (for assistant messages)
  modelUsed         String?   // gemini-1.5-flash, etc.
  tokensUsed        Int?
  responseTimeMs    Int?
  
  // Safety tracking
  safetyRatings     Json?     // Gemini safety ratings
  wasFiltered       Boolean   @default(false)
  filterReason      String?
  
  // Voice integration
  audioUrl          String?   // TTS audio URL
  
  // Timestamps
  createdAt         DateTime  @default(now())
  
  @@index([childId, createdAt])
  @@index([lessonId])
}

// ============================================
// FLASHCARDS & QUIZZES
// ============================================

model FlashcardDeck {
  id                String    @id @default(uuid())
  childId           String
  child             Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  lessonId          String?
  lesson            Lesson?   @relation(fields: [lessonId], references: [id], onDelete: SetNull)
  
  title             String
  description       String?
  subject           Subject?
  isAIGenerated     Boolean   @default(false)
  
  // Relationships
  flashcards        Flashcard[]
  
  // Progress
  masteryLevel      Float     @default(0)  // 0-100%
  lastStudiedAt     DateTime?
  
  // Timestamps
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  
  @@index([childId])
}

model Flashcard {
  id                String    @id @default(uuid())
  deckId            String
  deck              FlashcardDeck @relation(fields: [deckId], references: [id], onDelete: Cascade)
  
  front             String    @db.Text
  back              String    @db.Text
  imageUrl          String?
  audioUrl          String?   // TTS pronunciation
  
  // Spaced repetition (SM-2 algorithm)
  easeFactor        Float     @default(2.5)
  interval          Int       @default(1)   // Days
  repetitions       Int       @default(0)
  nextReviewAt      DateTime  @default(now())
  
  // Statistics
  timesReviewed     Int       @default(0)
  timesCorrect      Int       @default(0)
  
  // Order
  orderIndex        Int       @default(0)
  
  // Timestamps
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  
  @@index([deckId, nextReviewAt])
}

model Quiz {
  id                String    @id @default(uuid())
  lessonId          String
  lesson            Lesson    @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  
  title             String
  type              QuizType
  questions         Json      // Array of question objects
  
  // Attempts
  attempts          QuizAttempt[]
  
  // Timestamps
  createdAt         DateTime  @default(now())
  
  @@index([lessonId])
}

model QuizAttempt {
  id                String    @id @default(uuid())
  quizId            String
  quiz              Quiz      @relation(fields: [quizId], references: [id], onDelete: Cascade)
  
  answers           Json      // User's answers
  score             Float     // 0-100
  timeSpentSeconds  Int
  
  // XP awarded
  xpEarned          Int       @default(0)
  
  // Timestamps
  completedAt       DateTime  @default(now())
  
  @@index([quizId])
}

// ============================================
// GAMIFICATION
// ============================================

model UserProgress {
  id                String    @id @default(uuid())
  childId           String    @unique
  child             Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  
  // XP & Level
  currentXP         Int       @default(0)
  totalXP           Int       @default(0)
  level             Int       @default(1)
  
  // Subject-specific progress
  subjectProgress   Json?     // {math: {xp, level}, science: {xp, level}, ...}
  
  // Statistics
  lessonsCompleted  Int       @default(0)
  questionsAnswered Int       @default(0)
  flashcardsReviewed Int      @default(0)
  perfectScores     Int       @default(0)
  totalStudyTimeSeconds Int   @default(0)
  
  // Timestamps
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}

model XPTransaction {
  id                String    @id @default(uuid())
  childId           String
  child             Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  
  amount            Int
  reason            XPReason
  sourceType        String?   // "lesson", "flashcard", "quiz", etc.
  sourceId          String?   // ID of the source entity
  
  // Bonus info
  wasBonus          Boolean   @default(false)
  bonusMultiplier   Float?
  bonusReason       String?   // "streak_bonus", "first_of_day", etc.
  
  createdAt         DateTime  @default(now())
  
  @@index([childId, createdAt])
}

model Streak {
  id                String    @id @default(uuid())
  childId           String    @unique
  child             Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  
  current           Int       @default(0)
  longest           Int       @default(0)
  lastActivityDate  DateTime  @db.Date
  freezeAvailable   Boolean   @default(false)
  freezeUsedAt      DateTime?
  
  updatedAt         DateTime  @updatedAt
}

model Badge {
  id                String    @id @default(uuid())
  
  // Badge definition
  code              String    @unique  // "first_lesson", "streak_7", etc.
  name              String
  description       String
  icon              String    // Emoji or icon name
  category          BadgeCategory
  rarity            BadgeRarity
  
  // Requirements
  requirements      Json      // Criteria for unlocking
  xpReward          Int       @default(0)
  
  // Earned instances
  earnedBy          EarnedBadge[]
  
  createdAt         DateTime  @default(now())
}

model EarnedBadge {
  id                String    @id @default(uuid())
  childId           String
  child             Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  badgeId           String
  badge             Badge     @relation(fields: [badgeId], references: [id])
  
  earnedAt          DateTime  @default(now())
  
  @@unique([childId, badgeId])
  @@index([childId])
}

model DailyChallenge {
  id                String    @id @default(uuid())
  
  date              DateTime  @db.Date @unique
  type              ChallengeType
  target            Int
  description       String
  xpReward          Int
  
  // Completions
  completions       ChallengeCompletion[]
  
  createdAt         DateTime  @default(now())
  
  @@index([date])
}

model ChallengeCompletion {
  id                String    @id @default(uuid())
  challengeId       String
  challenge         DailyChallenge @relation(fields: [challengeId], references: [id])
  childId           String
  
  progress          Int       @default(0)
  completed         Boolean   @default(false)
  completedAt       DateTime?
  
  @@unique([challengeId, childId])
}

// ============================================
// TEXT SELECTION & INTERACTIONS
// ============================================

model TextSelection {
  id                String    @id @default(uuid())
  childId           String
  child             Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  lessonId          String
  lesson            Lesson    @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  
  selectedText      String    @db.Text
  beforeContext     String?   @db.Text
  afterContext      String?   @db.Text
  pageNumber        Int?
  
  actionType        SelectionAction
  userQuestion      String?
  resultData        Json      // Action-specific result
  
  xpAwarded         Int       @default(0)
  
  createdAt         DateTime  @default(now())
  
  @@index([childId, createdAt])
  @@index([lessonId])
}

// ============================================
// SAFETY & MONITORING
// ============================================

model SafetyLog {
  id                String    @id @default(uuid())
  childId           String
  child             Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  
  incidentType      SafetyIncidentType
  severity          SafetySeverity
  
  // Context
  inputText         String?   @db.Text
  outputText        String?   @db.Text
  lessonId          String?
  
  // AI safety ratings
  geminiSafetyRatings Json?
  
  // Flags
  flags             String[]
  
  // Resolution
  wasBlocked        Boolean   @default(false)
  parentNotified    Boolean   @default(false)
  parentNotifiedAt  DateTime?
  parentAction      String?   // "acknowledged", "restricted", etc.
  
  createdAt         DateTime  @default(now())
  
  @@index([childId, createdAt])
  @@index([severity])
}

// ============================================
// ENUMS
// ============================================

enum SubscriptionTier {
  FREE
  FAMILY
  FAMILY_PLUS
  ANNUAL
}

enum SubscriptionStatus {
  ACTIVE
  CANCELLED
  EXPIRED
  PAST_DUE
}

enum AgeGroup {
  YOUNG    // 4-7
  OLDER    // 8-12
}

enum CurriculumType {
  BRITISH
  AMERICAN
  INDIAN_CBSE
  INDIAN_ICSE
  IB
  ARABIC
}

enum LearningStyle {
  VISUAL
  AUDITORY
  READING
  KINESTHETIC
}

enum ConsentMethod {
  CREDIT_CARD
  KBQ           // Knowledge-based questions
  MANUAL_REVIEW
}

enum ConsentStatus {
  PENDING
  VERIFIED
  FAILED
  EXPIRED
}

enum Subject {
  MATH
  SCIENCE
  ENGLISH
  ARABIC
  ISLAMIC_STUDIES
  SOCIAL_STUDIES
  ART
  MUSIC
  OTHER
}

enum SourceType {
  PDF
  IMAGE
  YOUTUBE
  TEXT
  CAMERA
}

enum ProcessingStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum MessageRole {
  USER
  ASSISTANT
  SYSTEM
}

enum QuizType {
  MULTIPLE_CHOICE
  TRUE_FALSE
  FILL_BLANK
  MATCHING
}

enum XPReason {
  LESSON_COMPLETE
  LESSON_PROGRESS
  FLASHCARD_REVIEW
  FLASHCARD_CORRECT
  QUIZ_COMPLETE
  QUIZ_PERFECT
  CHAT_QUESTION
  DAILY_CHALLENGE
  STREAK_BONUS
  BADGE_EARNED
  FIRST_OF_DAY
  TEXT_SELECTION
}

enum BadgeCategory {
  LEARNING
  STREAK
  MASTERY
  SOCIAL
  SPECIAL
}

enum BadgeRarity {
  COMMON
  RARE
  EPIC
  LEGENDARY
}

enum ChallengeType {
  LESSONS
  QUESTIONS
  FLASHCARDS
  TIME
  STREAK
}

enum SelectionAction {
  ASK
  FLASHCARD
  QUIZ
  SAVE
  READ
}

enum SafetyIncidentType {
  PROFANITY
  PII_DETECTED
  INAPPROPRIATE_TOPIC
  JAILBREAK_ATTEMPT
  HARMFUL_CONTENT
  BLOCKED_BY_GEMINI
  PARENT_OVERRIDE
}

enum SafetySeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}
```

---

## 4. API Design

### RESTful API Endpoints

```yaml
# ============================================
# AUTHENTICATION
# ============================================

POST   /api/auth/signup
  # Parent signup with email/password
  Body: { email, password, firstName?, lastName?, country? }
  Response: { success, requiresEmailVerification: true }

POST   /api/auth/login
  # Parent login
  Body: { email, password }
  Response: { token, refreshToken, parent, children }

POST   /api/auth/refresh
  # Refresh access token
  Body: { refreshToken }
  Response: { token, refreshToken }

POST   /api/auth/logout
  # Invalidate tokens
  Headers: Authorization: Bearer <token>
  Response: { success }

POST   /api/auth/verify-email
  # Verify email with code
  Body: { code }
  Response: { success, message }

POST   /api/auth/forgot-password
  Body: { email }
  Response: { success, message }

POST   /api/auth/reset-password
  Body: { token, newPassword }
  Response: { success }

# ============================================
# PARENTAL CONSENT (COPPA)
# ============================================

POST   /api/consent/initiate-cc
  # Start credit card verification
  Headers: Authorization: Bearer <parentToken>
  Response: { clientSecret } # Stripe PaymentIntent

POST   /api/consent/verify-cc
  # Complete credit card verification
  Body: { paymentIntentId }
  Response: { success, consentId }

POST   /api/consent/kbq/questions
  # Get knowledge-based questions
  Response: { questions: [{id, question, options}] }

POST   /api/consent/kbq/verify
  # Verify KBQ answers
  Body: { answers: [{questionId, selectedOption}] }
  Response: { success, passed }

GET    /api/consent/status
  # Check consent status
  Response: { status, method, expiresAt }

# ============================================
# CHILD PROFILES
# ============================================

GET    /api/children
  # Get all children for parent
  Response: { children: [...] }

POST   /api/children
  # Create new child profile
  Body: { displayName, dateOfBirth, pin, gradeLevel?, curriculumType? }
  Response: { child }

PATCH  /api/children/:childId
  # Update child profile
  Body: { displayName?, avatarUrl?, learningStyle?, ... }
  Response: { child }

DELETE /api/children/:childId
  # Delete child profile (and all data!)
  Response: { success }

POST   /api/children/:childId/switch
  # Switch to child session (requires PIN)
  Body: { pin }
  Response: { childToken, child }

# ============================================
# LESSONS
# ============================================

GET    /api/lessons
  # Get lessons for current child
  Query: ?subject=MATH&status=COMPLETED
  Response: { lessons: [...], total, page }

GET    /api/lessons/:lessonId
  # Get single lesson with content
  Response: { lesson }

POST   /api/lessons
  # Create lesson from uploaded content
  Body: FormData { file?, youtubeUrl?, subject?, title? }
  Response: { lesson, processingStatus }

PATCH  /api/lessons/:lessonId
  # Update lesson metadata
  Body: { title?, subject? }
  Response: { lesson }

DELETE /api/lessons/:lessonId
  Response: { success }

GET    /api/lessons/:lessonId/status
  # Check processing status
  Response: { status, progress, error? }

POST   /api/lessons/:lessonId/progress
  # Update learning progress
  Body: { percentComplete, timeSpentSeconds }
  Response: { xpAwarded, newProgress }

# ============================================
# CHAT (JEFFREY AI)
# ============================================

GET    /api/chat/:lessonId/history
  # Get chat history for lesson
  Query: ?limit=50&before=<messageId>
  Response: { messages: [...] }

POST   /api/chat/:lessonId/message
  # Send message to Jeffrey
  Body: { content }
  Response: { 
    userMessage,
    assistantMessage,
    xpAwarded,
    safetyStatus
  }

POST   /api/chat/:lessonId/message/stream
  # Send message with streaming response
  Body: { content }
  Response: Server-Sent Events stream

DELETE /api/chat/:lessonId/history
  # Clear chat history for lesson
  Response: { success }

# ============================================
# TEXT SELECTIONS
# ============================================

POST   /api/selections/ask-jeffrey
  # Ask Jeffrey about selected text
  Body: { lessonId, selectedText, context, userQuestion? }
  Response: { answer, voiceUrl?, xpAwarded }

POST   /api/selections/create-flashcard
  Body: { lessonId, selectedText, context }
  Response: { flashcard, deckId, xpAwarded }

POST   /api/selections/generate-quiz
  Body: { lessonId, selectedText, context }
  Response: { quiz, xpAwarded }

POST   /api/selections/save
  Body: { lessonId, selectedText, collectionName?, tags? }
  Response: { savedItem, xpAwarded }

POST   /api/selections/read-aloud
  Body: { lessonId, selectedText }
  Response: { audioUrl }

# ============================================
# FLASHCARDS
# ============================================

GET    /api/flashcards/decks
  # Get all decks for child
  Response: { decks: [...] }

GET    /api/flashcards/decks/:deckId
  Response: { deck, flashcards }

POST   /api/flashcards/decks
  # Create new deck
  Body: { title, description?, subject?, lessonId? }
  Response: { deck }

POST   /api/flashcards/decks/:deckId/generate
  # AI-generate flashcards from lesson
  Body: { count?: 10 }
  Response: { flashcards, xpAwarded }

POST   /api/flashcards/decks/:deckId/cards
  # Add card to deck
  Body: { front, back, imageUrl? }
  Response: { flashcard }

DELETE /api/flashcards/decks/:deckId
  Response: { success }

GET    /api/flashcards/due
  # Get cards due for review (spaced repetition)
  Query: ?deckId=<id>&limit=20
  Response: { cards: [...] }

POST   /api/flashcards/:cardId/review
  # Submit review result
  Body: { quality: 0-5 } # 0=forgot, 5=perfect
  Response: { nextReview, xpAwarded }

# ============================================
# QUIZZES
# ============================================

GET    /api/quizzes/:lessonId
  # Get quizzes for lesson
  Response: { quizzes: [...] }

POST   /api/quizzes/generate
  # Generate quiz from lesson
  Body: { lessonId, type?: "MULTIPLE_CHOICE", count?: 5 }
  Response: { quiz }

POST   /api/quizzes/:quizId/attempt
  # Submit quiz attempt
  Body: { answers: [{questionId, answer}] }
  Response: { 
    score, 
    correctAnswers, 
    xpAwarded,
    perfectBonus?
  }

# ============================================
# GAMIFICATION
# ============================================

GET    /api/gamification/progress
  # Get current progress
  Response: { 
    xp, level, xpToNextLevel,
    streak, badges, 
    dailyChallenge,
    recentAchievements
  }

GET    /api/gamification/badges
  # Get all badges (earned and unearned)
  Response: { earned: [...], available: [...] }

GET    /api/gamification/leaderboard
  # Privacy-safe leaderboard
  Query: ?type=weekly&scope=global
  Response: { 
    rankings: [{rank, displayName, avatar, xp}],
    userRank
  }

GET    /api/gamification/daily-challenge
  # Get today's challenge
  Response: { challenge, progress, completed }

POST   /api/gamification/streak/freeze
  # Use streak freeze
  Response: { success, freezeUsed }

GET    /api/gamification/xp/history
  # XP transaction history
  Query: ?days=7
  Response: { transactions: [...], totalByDay }

# ============================================
# UPLOADS
# ============================================

POST   /api/uploads/presign
  # Get presigned URL for direct R2 upload
  Body: { filename, contentType, size }
  Response: { uploadUrl, fileId, expiresAt }

POST   /api/uploads/confirm
  # Confirm upload and start processing
  Body: { fileId, lessonTitle?, subject? }
  Response: { lessonId, processingStatus }

GET    /api/uploads/:fileId/status
  # Check upload processing status
  Response: { status, progress, error? }

# ============================================
# PARENT DASHBOARD
# ============================================

GET    /api/parent/dashboard
  # Aggregated dashboard data
  Response: {
    children: [{
      id, displayName, avatar,
      todayProgress, weekProgress,
      currentStreak, level
    }],
    familyStats
  }

GET    /api/parent/children/:childId/report
  # Detailed child report
  Query: ?period=week
  Response: {
    summary,
    lessonsCompleted,
    studyTimeByDay,
    subjectProgress,
    strengths,
    areasForImprovement
  }

GET    /api/parent/children/:childId/safety
  # Safety logs
  Query: ?severity=HIGH&days=30
  Response: { incidents: [...], summary }

POST   /api/parent/children/:childId/safety/:logId/acknowledge
  # Acknowledge safety incident
  Body: { action?: "restrict_topic" }
  Response: { success }

PATCH  /api/parent/children/:childId/settings
  # Update child's settings
  Body: { voiceEnabled?, screenTimeLimit?, ... }
  Response: { settings }

GET    /api/parent/subscription
  Response: { tier, status, expiresAt, usage }

POST   /api/parent/subscription/manage
  # Create Stripe billing portal session
  Response: { portalUrl }

# ============================================
# VOICE (TTS)
# ============================================

POST   /api/voice/generate
  # Generate TTS audio
  Body: { text, voice?: "jeffrey", language?: "en" }
  Response: { audioUrl }

GET    /api/voice/voices
  # Available voices
  Response: { voices: [{id, name, language, preview}] }
```

---

## 5. Authentication & Authorization

### JWT Structure

```typescript
// Access Token (short-lived: 15 minutes)
interface AccessTokenPayload {
  sub: string;           // User ID (parent or child)
  type: 'parent' | 'child';
  parentId?: string;     // For child tokens, reference to parent
  ageGroup?: AgeGroup;   // For child tokens
  iat: number;
  exp: number;
}

// Refresh Token (long-lived: 7 days, stored in Redis)
interface RefreshTokenPayload {
  sub: string;
  type: 'parent' | 'child';
  jti: string;           // Unique token ID for revocation
  iat: number;
  exp: number;
}
```

### Session Management with Redis

```typescript
// src/services/auth/sessionService.ts

import { redis } from '../../config/redis';

interface Session {
  userId: string;
  type: 'parent' | 'child';
  parentId?: string;
  refreshTokenId: string;
  createdAt: Date;
  lastActivityAt: Date;
  deviceInfo?: string;
}

export const sessionService = {
  async createSession(session: Session): Promise<void> {
    const key = `session:${session.refreshTokenId}`;
    await redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify(session));
    
    // Track active sessions per user
    await redis.sadd(`user:${session.userId}:sessions`, session.refreshTokenId);
  },
  
  async invalidateSession(refreshTokenId: string): Promise<void> {
    const key = `session:${refreshTokenId}`;
    const session = await redis.get(key);
    if (session) {
      const parsed = JSON.parse(session);
      await redis.srem(`user:${parsed.userId}:sessions`, refreshTokenId);
      await redis.del(key);
    }
  },
  
  async invalidateAllSessions(userId: string): Promise<void> {
    const sessions = await redis.smembers(`user:${userId}:sessions`);
    if (sessions.length > 0) {
      const keys = sessions.map(id => `session:${id}`);
      await redis.del(...keys);
      await redis.del(`user:${userId}:sessions`);
    }
  },
  
  async getActiveSessionCount(userId: string): Promise<number> {
    return redis.scard(`user:${userId}:sessions`);
  }
};
```

### Child Profile PIN Verification

```typescript
// src/services/auth/childAuthService.ts

import bcrypt from 'bcrypt';
import { prisma } from '../../config/database';
import { tokenService } from './tokenService';

export const childAuthService = {
  async switchToChild(
    parentId: string, 
    childId: string, 
    pin: string
  ): Promise<{ childToken: string; child: Child }> {
    // Verify child belongs to parent
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId }
    });
    
    if (!child) {
      throw new UnauthorizedError('Child not found');
    }
    
    // Verify PIN
    if (child.pin !== pin) {
      // Log failed attempt
      await logFailedPINAttempt(parentId, childId);
      throw new UnauthorizedError('Invalid PIN');
    }
    
    // Create child session token
    const childToken = tokenService.generateChildToken({
      sub: childId,
      type: 'child',
      parentId,
      ageGroup: child.ageGroup,
    });
    
    // Update last active
    await prisma.child.update({
      where: { id: childId },
      data: { lastActiveAt: new Date() }
    });
    
    return { childToken, child };
  }
};
```

---

## 6. AI Integration Layer

### Gemini Service

```typescript
// src/services/ai/geminiService.ts

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { config } from '../../config';
import { SafetyFilters } from './safetyFilters';
import { PromptBuilder } from './promptBuilder';

interface GeminiConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

// Child-safe settings - STRICTEST possible
const CHILD_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
];

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private promptBuilder: PromptBuilder;
  private safetyFilters: SafetyFilters;
  
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.promptBuilder = new PromptBuilder();
    this.safetyFilters = new SafetyFilters();
  }
  
  async chat(
    message: string,
    context: {
      childId: string;
      ageGroup: AgeGroup;
      lessonContext?: LessonContext;
      conversationHistory?: ChatMessage[];
    }
  ): Promise<ChatResponse> {
    const startTime = Date.now();
    
    // 1. Pre-filter user input
    const inputValidation = await this.safetyFilters.validateInput(message, context.ageGroup);
    if (!inputValidation.passed) {
      return this.createSafetyBlockedResponse(inputValidation, context.childId);
    }
    
    // 2. Build system prompt
    const systemPrompt = this.promptBuilder.buildSystemInstructions({
      ageGroup: context.ageGroup,
      lessonContext: context.lessonContext,
    });
    
    // 3. Build conversation history
    const history = this.formatConversationHistory(context.conversationHistory);
    
    // 4. Call Gemini
    const model = this.genAI.getGenerativeModel({
      model: context.ageGroup === 'YOUNG' ? 'gemini-1.5-flash' : 'gemini-1.5-flash',
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: context.ageGroup === 'YOUNG' ? 200 : 400,
      },
      systemInstruction: systemPrompt,
    });
    
    const chat = model.startChat({ history });
    
    let result;
    try {
      result = await chat.sendMessage(message);
    } catch (error) {
      if (error.message?.includes('SAFETY')) {
        return this.createSafetyBlockedResponse({ 
          passed: false, 
          flags: ['blocked_by_gemini'] 
        }, context.childId);
      }
      throw error;
    }
    
    const response = result.response;
    const responseText = response.text();
    
    // 5. Post-filter output
    const outputValidation = await this.safetyFilters.validateOutput(responseText, context.ageGroup);
    if (!outputValidation.passed) {
      return this.createSafetyBlockedResponse(outputValidation, context.childId);
    }
    
    // 6. Log safety ratings
    await this.logSafetyRatings(context.childId, response.candidates?.[0]?.safetyRatings);
    
    return {
      content: responseText,
      safetyRatings: response.candidates?.[0]?.safetyRatings,
      tokensUsed: response.usageMetadata?.totalTokenCount,
      responseTimeMs: Date.now() - startTime,
      wasFiltered: false,
    };
  }
  
  async generateFlashcards(
    lessonContent: string,
    context: { ageGroup: AgeGroup; subject?: Subject; count?: number }
  ): Promise<Flashcard[]> {
    const prompt = this.promptBuilder.buildFlashcardPrompt(lessonContent, context);
    
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    });
    
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
  }
  
  async analyzeContent(
    content: string,
    context: { ageGroup: AgeGroup; subject?: Subject }
  ): Promise<LessonAnalysis> {
    const prompt = this.promptBuilder.buildContentAnalysisPrompt(content, context);
    
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-1.5-pro', // Use Pro for better content analysis
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
      },
    });
    
    const result = await model.generateContent(prompt);
    const analysis = JSON.parse(result.response.text());
    
    // Validate content is child-appropriate
    const safetyCheck = await this.safetyFilters.validateContent(analysis, context.ageGroup);
    if (!safetyCheck.passed) {
      throw new ContentSafetyError(safetyCheck.flags);
    }
    
    return analysis;
  }
  
  private createSafetyBlockedResponse(
    validation: SafetyValidation, 
    childId: string
  ): ChatResponse {
    // Log safety incident
    this.logSafetyIncident(childId, validation);
    
    return {
      content: "I'm not sure about that topic! Let's talk about something from your lesson instead. 📚",
      wasFiltered: true,
      filterReason: validation.flags.join(', '),
    };
  }
}

export const geminiService = new GeminiService();
```

### Prompt Builder

```typescript
// src/services/ai/promptBuilder.ts

export class PromptBuilder {
  buildSystemInstructions(context: {
    ageGroup: AgeGroup;
    lessonContext?: LessonContext;
  }): string {
    const instructions: string[] = [];
    
    // Core identity
    instructions.push(this.getJeffreyIdentity());
    
    // Safety rules (CRITICAL)
    instructions.push(this.getSafetyRules());
    
    // Age-appropriate communication
    instructions.push(this.getAgeGuidance(context.ageGroup));
    
    // Lesson context
    if (context.lessonContext) {
      instructions.push(this.getLessonGuidance(context.lessonContext));
    }
    
    return instructions.join('\n\n');
  }
  
  private getJeffreyIdentity(): string {
    return `You are Jeffrey, a friendly and enthusiastic AI learning buddy for children on the Orbit Learn platform.

PERSONALITY:
- Always positive, encouraging, and patient
- Use simple, age-appropriate language
- Celebrate every effort and success
- Make learning fun with enthusiasm
- Use emojis sparingly but warmly 🌟
- Never be condescending or boring

GOAL:
Help children understand concepts deeply through conversation, examples, and analogies they can relate to.`;
  }
  
  private getSafetyRules(): string {
    return `CRITICAL SAFETY RULES (NEVER VIOLATE):

1. NEVER ask for or mention personal information (real names, addresses, phone numbers, school names, parent names, age specifics)

2. NEVER discuss topics inappropriate for children:
   - Violence, weapons, or scary content
   - Romance, relationships, or adult themes
   - Drugs, alcohol, or substances
   - Politics or controversial social issues
   - Death or serious illness in detail
   - Horror or disturbing content

3. NEVER provide external links or suggest visiting websites

4. NEVER pretend to be a real person, teacher, parent, or authority figure

5. If asked about these topics, redirect kindly:
   "That's not something I know about! Let's focus on your lesson. What would you like to learn about [subject]?"

6. If a child seems upset or mentions harm, respond with:
   "It sounds like you might be having a tough time. That's okay! Maybe talk to a grown-up you trust about how you're feeling. I'm here to help with learning! 💙"

7. NEVER discuss how you work or your capabilities beyond being a learning helper`;
  }
  
  private getAgeGuidance(ageGroup: AgeGroup): string {
    if (ageGroup === 'YOUNG') {
      return `LANGUAGE FOR AGES 4-7:
- Use very simple words (1-2 syllables preferred)
- Keep sentences short (5-10 words max)
- Use lots of examples from daily life
- Reference things kids love: animals, toys, games, family
- Always be extra encouraging
- Use more emojis for visual appeal 🎉
- Explain everything as if talking to a young child`;
    }
    
    return `LANGUAGE FOR AGES 8-12:
- Use grade-appropriate vocabulary
- Explain new words when introducing them
- Give more detailed explanations
- Use analogies from their world (games, sports, movies)
- Encourage curiosity and deeper questions
- Can handle slightly longer conversations`;
  }
  
  private getLessonGuidance(lesson: LessonContext): string {
    return `CURRENT LESSON CONTEXT:

Subject: ${lesson.subject || 'General'}
Topic: ${lesson.title}
Key Concepts: ${lesson.keyConcepts?.join(', ') || 'None specified'}

Summary: ${lesson.summary || 'No summary available'}

When answering questions:
1. First try to relate answers to the current lesson
2. Use examples from the lesson content when possible
3. If the question is unrelated, gently guide back to the lesson
4. Suggest exploring related topics within the lesson`;
  }
  
  buildFlashcardPrompt(content: string, context: {
    ageGroup: AgeGroup;
    count?: number;
  }): string {
    return `Generate ${context.count || 10} flashcards from this educational content for a ${
      context.ageGroup === 'YOUNG' ? 'young child (ages 4-7)' : 'child (ages 8-12)'
    }.

Content:
${content}

Requirements:
- Each card should test ONE concept only
- Questions should be clear and simple
- Answers should be concise (1-2 sentences max)
- Use age-appropriate language
- Make it engaging and fun
- Include helpful hints where appropriate

Return as JSON array:
[
  {
    "front": "Question text",
    "back": "Answer text",
    "hint": "Optional hint"
  }
]`;
  }
}
```

---

## 7. Content Processing Pipeline

### Upload & Processing Flow

```typescript
// src/services/learning/contentProcessor.ts

import { Queue, Worker } from 'bullmq';
import { redis } from '../../config/redis';
import { r2Service } from '../storage/r2Service';
import { geminiService } from '../ai/geminiService';
import { prisma } from '../../config/database';

// Job queue for async processing
const processingQueue = new Queue('content-processing', {
  connection: redis,
});

export const contentProcessor = {
  async initiateProcessing(
    lessonId: string,
    fileUrl: string,
    sourceType: SourceType,
    context: { childId: string; ageGroup: AgeGroup }
  ): Promise<void> {
    // Add to processing queue
    await processingQueue.add('process-content', {
      lessonId,
      fileUrl,
      sourceType,
      context,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    
    // Update status
    await prisma.lesson.update({
      where: { id: lessonId },
      data: { processingStatus: 'PROCESSING' },
    });
  }
};

// Worker to process content
const worker = new Worker('content-processing', async (job) => {
  const { lessonId, fileUrl, sourceType, context } = job.data;
  
  try {
    // 1. Extract text based on source type
    let extractedText: string;
    
    switch (sourceType) {
      case 'PDF':
        extractedText = await extractTextFromPDF(fileUrl);
        break;
      case 'IMAGE':
        extractedText = await extractTextFromImage(fileUrl);
        break;
      case 'YOUTUBE':
        extractedText = await extractTranscript(fileUrl);
        break;
      default:
        throw new Error(`Unsupported source type: ${sourceType}`);
    }
    
    // 2. Safety check on raw content
    const safetyCheck = await safetyFilters.validateContent(
      extractedText, 
      context.ageGroup
    );
    if (!safetyCheck.passed) {
      await handleUnsafeContent(lessonId, safetyCheck, context.childId);
      return;
    }
    
    // 3. AI content analysis
    const analysis = await geminiService.analyzeContent(extractedText, {
      ageGroup: context.ageGroup,
    });
    
    // 4. Update lesson with processed content
    await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        extractedText,
        title: analysis.title,
        summary: analysis.summary,
        gradeLevel: analysis.gradeLevel,
        chapters: analysis.chapters,
        keyConcepts: analysis.keyConcepts,
        vocabulary: analysis.vocabulary,
        suggestedQuestions: analysis.suggestedQuestions,
        processingStatus: 'COMPLETED',
        aiConfidence: analysis.confidence,
        safetyReviewed: true,
      },
    });
    
    // 5. Award XP for uploading content
    await xpEngine.awardXP(context.childId, {
      amount: 10,
      reason: 'LESSON_COMPLETE',
      sourceType: 'lesson',
      sourceId: lessonId,
    });
    
    // 6. Notify client via WebSocket/polling
    await notifyProcessingComplete(lessonId);
    
  } catch (error) {
    await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        processingStatus: 'FAILED',
        processingError: error.message,
      },
    });
    throw error;
  }
}, { connection: redis });

async function extractTextFromPDF(fileUrl: string): Promise<string> {
  // Download from R2
  const pdfBuffer = await r2Service.download(fileUrl);
  
  // Use pdf-parse or similar
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(pdfBuffer);
  
  return data.text;
}

async function extractTextFromImage(fileUrl: string): Promise<string> {
  // Use Gemini Vision for OCR
  const imageBuffer = await r2Service.download(fileUrl);
  const base64Image = imageBuffer.toString('base64');
  
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent([
    'Extract all text from this image. Return only the text, no commentary.',
    { inlineData: { mimeType: 'image/png', data: base64Image } },
  ]);
  
  return result.response.text();
}

async function extractTranscript(youtubeUrl: string): Promise<string> {
  // Use youtube-transcript or similar service
  const { YoutubeTranscript } = require('youtube-transcript');
  const transcript = await YoutubeTranscript.fetchTranscript(extractVideoId(youtubeUrl));
  
  return transcript.map((t: any) => t.text).join(' ');
}
```

---

## 8. Gamification Engine

### XP Engine

```typescript
// src/services/gamification/xpEngine.ts

import { prisma } from '../../config/database';
import { badgeService } from './badgeService';
import { streakService } from './streakService';

interface XPAward {
  amount: number;
  reason: XPReason;
  sourceType?: string;
  sourceId?: string;
  bonus?: { multiplier: number; reason: string };
}

// XP values by action
const XP_VALUES = {
  LESSON_COMPLETE: 50,
  LESSON_PROGRESS: 5,    // Per 10% progress
  FLASHCARD_REVIEW: 2,
  FLASHCARD_CORRECT: 5,
  QUIZ_COMPLETE: 20,
  QUIZ_PERFECT: 50,      // Bonus for 100%
  CHAT_QUESTION: 3,
  DAILY_CHALLENGE: 100,
  STREAK_BONUS: 10,      // Per day of streak
  TEXT_SELECTION: 2,
  FIRST_OF_DAY: 25,      // First activity of the day
};

// Level thresholds
const LEVEL_THRESHOLDS = [
  0, 100, 250, 500, 800, 1200, 1700, 2300, 3000, 4000,
  5000, 6500, 8000, 10000, 12500, 15000, 18000, 22000, 27000, 33000,
];

export const xpEngine = {
  async awardXP(childId: string, award: XPAward): Promise<{
    xpAwarded: number;
    newLevel?: number;
    leveledUp: boolean;
    newBadges: Badge[];
  }> {
    // Get current progress
    let progress = await prisma.userProgress.findUnique({
      where: { childId },
    });
    
    if (!progress) {
      progress = await prisma.userProgress.create({
        data: { childId },
      });
    }
    
    // Calculate bonuses
    let finalAmount = award.amount;
    let wasBonus = false;
    let bonusReason = '';
    
    // Streak bonus
    const streak = await streakService.getCurrentStreak(childId);
    if (streak > 0) {
      const streakBonus = Math.min(streak * 0.1, 1); // Max 100% bonus
      finalAmount = Math.floor(finalAmount * (1 + streakBonus));
      wasBonus = true;
      bonusReason = `streak_${streak}`;
    }
    
    // First of day bonus
    const isFirstToday = await this.isFirstActivityToday(childId);
    if (isFirstToday) {
      finalAmount += XP_VALUES.FIRST_OF_DAY;
      wasBonus = true;
      bonusReason += '_first_of_day';
    }
    
    // Custom bonus
    if (award.bonus) {
      finalAmount = Math.floor(finalAmount * award.bonus.multiplier);
      wasBonus = true;
      bonusReason = award.bonus.reason;
    }
    
    // Record transaction
    await prisma.xPTransaction.create({
      data: {
        childId,
        amount: finalAmount,
        reason: award.reason,
        sourceType: award.sourceType,
        sourceId: award.sourceId,
        wasBonus,
        bonusMultiplier: wasBonus ? finalAmount / award.amount : null,
        bonusReason: bonusReason || null,
      },
    });
    
    // Update progress
    const oldLevel = progress.level;
    const newXP = progress.currentXP + finalAmount;
    const newTotalXP = progress.totalXP + finalAmount;
    const { level, xpIntoLevel } = this.calculateLevel(newTotalXP);
    
    await prisma.userProgress.update({
      where: { childId },
      data: {
        currentXP: xpIntoLevel,
        totalXP: newTotalXP,
        level,
      },
    });
    
    const leveledUp = level > oldLevel;
    
    // Check for badge unlocks
    const newBadges = await badgeService.checkAndAwardBadges(childId, {
      xpEarned: finalAmount,
      totalXP: newTotalXP,
      level,
      reason: award.reason,
    });
    
    // Update streak
    await streakService.recordActivity(childId);
    
    return {
      xpAwarded: finalAmount,
      newLevel: leveledUp ? level : undefined,
      leveledUp,
      newBadges,
    };
  },
  
  calculateLevel(totalXP: number): { level: number; xpIntoLevel: number } {
    let level = 1;
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
      if (totalXP >= LEVEL_THRESHOLDS[i]) {
        level = i + 1;
      } else {
        break;
      }
    }
    
    const xpIntoLevel = totalXP - LEVEL_THRESHOLDS[level - 1];
    return { level, xpIntoLevel };
  },
  
  getXPToNextLevel(level: number, currentXP: number): number {
    if (level >= LEVEL_THRESHOLDS.length) return 0;
    const nextThreshold = LEVEL_THRESHOLDS[level] - LEVEL_THRESHOLDS[level - 1];
    return nextThreshold - currentXP;
  },
  
  async isFirstActivityToday(childId: string): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const count = await prisma.xPTransaction.count({
      where: {
        childId,
        createdAt: { gte: today },
      },
    });
    
    return count === 0;
  },
};
```

### Streak Service

```typescript
// src/services/gamification/streakService.ts

import { prisma } from '../../config/database';
import { startOfDay, differenceInDays } from 'date-fns';

export const streakService = {
  async recordActivity(childId: string): Promise<{
    current: number;
    isNewStreak: boolean;
    extended: boolean;
  }> {
    const today = startOfDay(new Date());
    
    let streak = await prisma.streak.findUnique({
      where: { childId },
    });
    
    if (!streak) {
      streak = await prisma.streak.create({
        data: {
          childId,
          current: 1,
          longest: 1,
          lastActivityDate: today,
        },
      });
      return { current: 1, isNewStreak: true, extended: false };
    }
    
    const lastActivity = startOfDay(streak.lastActivityDate);
    const daysDiff = differenceInDays(today, lastActivity);
    
    if (daysDiff === 0) {
      // Same day - no change
      return { current: streak.current, isNewStreak: false, extended: false };
    }
    
    if (daysDiff === 1) {
      // Consecutive day - extend streak
      const newCurrent = streak.current + 1;
      const newLongest = Math.max(newCurrent, streak.longest);
      
      await prisma.streak.update({
        where: { childId },
        data: {
          current: newCurrent,
          longest: newLongest,
          lastActivityDate: today,
        },
      });
      
      return { current: newCurrent, isNewStreak: false, extended: true };
    }
    
    // Streak broken (daysDiff > 1)
    // Check if freeze is available
    if (streak.freezeAvailable && daysDiff === 2) {
      await prisma.streak.update({
        where: { childId },
        data: {
          lastActivityDate: today,
          freezeAvailable: false,
          freezeUsedAt: new Date(),
        },
      });
      return { current: streak.current, isNewStreak: false, extended: false };
    }
    
    // Reset streak
    await prisma.streak.update({
      where: { childId },
      data: {
        current: 1,
        lastActivityDate: today,
      },
    });
    
    return { current: 1, isNewStreak: true, extended: false };
  },
  
  async getCurrentStreak(childId: string): Promise<number> {
    const streak = await prisma.streak.findUnique({
      where: { childId },
    });
    
    if (!streak) return 0;
    
    // Check if streak is still valid
    const today = startOfDay(new Date());
    const lastActivity = startOfDay(streak.lastActivityDate);
    const daysDiff = differenceInDays(today, lastActivity);
    
    if (daysDiff > 1) {
      return 0; // Streak is broken
    }
    
    return streak.current;
  },
  
  async useFreeze(childId: string): Promise<boolean> {
    const streak = await prisma.streak.findUnique({
      where: { childId },
    });
    
    if (!streak || !streak.freezeAvailable) {
      return false;
    }
    
    await prisma.streak.update({
      where: { childId },
      data: {
        freezeAvailable: false,
        freezeUsedAt: new Date(),
      },
    });
    
    return true;
  },
};
```

---

## 9. Safety & Compliance

### Safety Filters

```typescript
// src/services/ai/safetyFilters.ts

interface SafetyValidation {
  passed: boolean;
  flags: string[];
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// Blocklists by age group
const BLOCKED_TOPICS = {
  YOUNG: [
    'death', 'kill', 'blood', 'scary', 'nightmare', 'monster',
    'fight', 'war', 'gun', 'knife', 'hate', 'stupid', 'dumb',
    // ... extensive list
  ],
  OLDER: [
    'violence', 'weapons', 'drugs', 'alcohol', 'romance',
    // ... age-appropriate list
  ],
};

// PII patterns
const PII_PATTERNS = [
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,  // Phone numbers
  /\b\d{3}[-]?\d{2}[-]?\d{4}\b/,     // SSN
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
  /\b\d{1,5}\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr)\b/i, // Address
  // UAE-specific
  /\b05\d{8}\b/,                      // UAE mobile
  /\b97[1|0]\d{9}\b/,                 // UAE international
];

// Jailbreak patterns
const JAILBREAK_PATTERNS = [
  /ignore.*instructions/i,
  /pretend.*you.*are/i,
  /roleplay.*as/i,
  /act.*like.*you.*are/i,
  /bypass.*safety/i,
  /forget.*rules/i,
  /new.*persona/i,
];

export class SafetyFilters {
  async validateInput(text: string, ageGroup: AgeGroup): Promise<SafetyValidation> {
    const flags: string[] = [];
    
    // Check for PII
    for (const pattern of PII_PATTERNS) {
      if (pattern.test(text)) {
        flags.push('pii_detected');
        break;
      }
    }
    
    // Check for jailbreak attempts
    for (const pattern of JAILBREAK_PATTERNS) {
      if (pattern.test(text)) {
        flags.push('jailbreak_attempt');
        break;
      }
    }
    
    // Check for blocked topics
    const blockedWords = BLOCKED_TOPICS[ageGroup];
    const lowerText = text.toLowerCase();
    for (const word of blockedWords) {
      if (lowerText.includes(word)) {
        flags.push(`inappropriate_topic:${word}`);
        break;
      }
    }
    
    // Check for profanity (use external service or list)
    if (await this.containsProfanity(text)) {
      flags.push('profanity');
    }
    
    const severity = this.calculateSeverity(flags);
    
    return {
      passed: flags.length === 0,
      flags,
      severity,
    };
  }
  
  async validateOutput(text: string, ageGroup: AgeGroup): Promise<SafetyValidation> {
    // Similar checks for AI output
    const flags: string[] = [];
    
    // Ensure no external links
    if (/https?:\/\/|www\./i.test(text)) {
      flags.push('external_links');
    }
    
    // Ensure no requests for personal info
    const personalInfoPatterns = [
      /what.*your.*name/i,
      /where.*do.*you.*live/i,
      /what.*school/i,
      /how.*old.*are.*you/i,
      /your.*parent/i,
    ];
    for (const pattern of personalInfoPatterns) {
      if (pattern.test(text)) {
        flags.push('asks_personal_info');
        break;
      }
    }
    
    // Check for inappropriate content that slipped through
    const blockedOutputWords = ['stupid', 'dumb', 'hate', 'scary'];
    const lowerText = text.toLowerCase();
    for (const word of blockedOutputWords) {
      if (lowerText.includes(word)) {
        flags.push(`inappropriate_output:${word}`);
      }
    }
    
    return {
      passed: flags.length === 0,
      flags,
      severity: this.calculateSeverity(flags),
    };
  }
  
  async validateContent(content: string | object, ageGroup: AgeGroup): Promise<SafetyValidation> {
    // For lesson content being processed
    const textToCheck = typeof content === 'string' 
      ? content 
      : JSON.stringify(content);
    
    return this.validateInput(textToCheck, ageGroup);
  }
  
  private calculateSeverity(flags: string[]): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (flags.some(f => f.includes('jailbreak'))) return 'CRITICAL';
    if (flags.some(f => f.includes('pii'))) return 'HIGH';
    if (flags.some(f => f.includes('profanity'))) return 'MEDIUM';
    if (flags.length > 0) return 'LOW';
    return 'LOW';
  }
  
  private async containsProfanity(text: string): Promise<boolean> {
    // Use a profanity filter library or API
    // Example: bad-words npm package
    const Filter = require('bad-words');
    const filter = new Filter();
    return filter.isProfane(text);
  }
}
```

### Safety Logger

```typescript
// src/services/monitoring/safetyLogger.ts

import { prisma } from '../../config/database';
import { parentAlerts } from './parentAlerts';

export const safetyLogger = {
  async logIncident(
    childId: string,
    incident: {
      type: SafetyIncidentType;
      severity: SafetySeverity;
      inputText?: string;
      outputText?: string;
      lessonId?: string;
      flags: string[];
      geminiRatings?: any;
      wasBlocked: boolean;
    }
  ): Promise<void> {
    // Create log entry
    const log = await prisma.safetyLog.create({
      data: {
        childId,
        incidentType: incident.type,
        severity: incident.severity,
        inputText: incident.inputText,
        outputText: incident.outputText,
        lessonId: incident.lessonId,
        flags: incident.flags,
        geminiSafetyRatings: incident.geminiRatings,
        wasBlocked: incident.wasBlocked,
      },
    });
    
    // Notify parent for HIGH or CRITICAL
    if (['HIGH', 'CRITICAL'].includes(incident.severity)) {
      await parentAlerts.sendSafetyAlert(childId, log);
    }
  },
  
  async getRecentIncidents(
    childId: string, 
    options: { days?: number; severity?: SafetySeverity }
  ): Promise<SafetyLog[]> {
    const since = new Date();
    since.setDate(since.getDate() - (options.days || 7));
    
    return prisma.safetyLog.findMany({
      where: {
        childId,
        createdAt: { gte: since },
        ...(options.severity && { severity: options.severity }),
      },
      orderBy: { createdAt: 'desc' },
    });
  },
};
```

---

## 10. Caching Strategy

### Redis Cache Service

```typescript
// src/services/cache/cacheService.ts

import { redis } from '../../config/redis';

interface CacheOptions {
  ttl?: number; // seconds
  prefix?: string;
}

export const cacheService = {
  // Default TTLs by data type
  TTL: {
    SESSION: 7 * 24 * 60 * 60,      // 7 days
    USER_PROGRESS: 5 * 60,           // 5 minutes
    LESSON_CONTENT: 60 * 60,         // 1 hour
    LEADERBOARD: 10 * 60,            // 10 minutes
    DAILY_CHALLENGE: 24 * 60 * 60,   // 24 hours
    RATE_LIMIT: 60,                  // 1 minute
  },
  
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    const fullKey = options.prefix ? `${options.prefix}:${key}` : key;
    const data = await redis.get(fullKey);
    return data ? JSON.parse(data) : null;
  },
  
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const fullKey = options.prefix ? `${options.prefix}:${key}` : key;
    const ttl = options.ttl || 300; // Default 5 minutes
    await redis.setex(fullKey, ttl, JSON.stringify(value));
  },
  
  async delete(key: string, options: CacheOptions = {}): Promise<void> {
    const fullKey = options.prefix ? `${options.prefix}:${key}` : key;
    await redis.del(fullKey);
  },
  
  async invalidatePattern(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  },
  
  // Rate limiting
  async checkRateLimit(
    identifier: string, 
    limit: number, 
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const key = `ratelimit:${identifier}`;
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    // Clean old entries and count
    await redis.zremrangebyscore(key, 0, windowStart);
    const count = await redis.zcard(key);
    
    if (count >= limit) {
      const oldestTimestamp = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const resetAt = new Date(Number(oldestTimestamp[1]) + windowSeconds * 1000);
      return { allowed: false, remaining: 0, resetAt };
    }
    
    // Add current request
    await redis.zadd(key, now.toString(), now.toString());
    await redis.expire(key, windowSeconds);
    
    return {
      allowed: true,
      remaining: limit - count - 1,
      resetAt: new Date(now + windowSeconds * 1000),
    };
  },
};
```

### Caching Strategy by Route

```typescript
// Cache key patterns and TTLs

const CACHE_CONFIG = {
  // User data - short TTL, invalidate on write
  'user:progress:{childId}': { ttl: 300, invalidateOn: ['xp:award', 'lesson:complete'] },
  'user:streak:{childId}': { ttl: 3600, invalidateOn: ['activity:record'] },
  'user:badges:{childId}': { ttl: 3600, invalidateOn: ['badge:award'] },
  
  // Lesson data - longer TTL after processing
  'lesson:{lessonId}': { ttl: 3600, invalidateOn: ['lesson:update'] },
  'lesson:chapters:{lessonId}': { ttl: 86400 }, // 24h - rarely changes
  
  // Gamification - moderate TTL
  'leaderboard:weekly': { ttl: 600 }, // 10 min - refreshed regularly
  'dailychallenge:{date}': { ttl: 86400 }, // All day
  
  // Flashcards - cached until reviewed
  'flashcards:due:{childId}': { ttl: 1800, invalidateOn: ['flashcard:review'] },
  
  // AI responses - don't cache (unique each time)
  // 'chat:*': NO CACHING
};
```

---

## 11. File Storage (R2)

### R2 Service

```typescript
// src/services/storage/r2Service.ts

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../config';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

// Bucket structure
const BUCKETS = {
  UPLOADS: 'nanobanana-uploads',       // User-uploaded content
  GENERATED: 'nanobanana-generated',   // AI-generated content
  AUDIO: 'nanobanana-audio',           // TTS audio files
  TEMP: 'nanobanana-temp',             // Temporary files
};

export const r2Service = {
  async getPresignedUploadUrl(
    childId: string,
    filename: string,
    contentType: string,
    sizeBytes: number
  ): Promise<{ uploadUrl: string; fileId: string; key: string }> {
    // Validate file size
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (sizeBytes > MAX_SIZE) {
      throw new FileTooLargeError(`Max file size is ${MAX_SIZE / 1024 / 1024}MB`);
    }
    
    // Validate content type
    const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!ALLOWED_TYPES.includes(contentType)) {
      throw new InvalidFileTypeError('File type not allowed');
    }
    
    const fileId = generateId();
    const ext = filename.split('.').pop();
    const key = `${childId}/${fileId}.${ext}`;
    
    const command = new PutObjectCommand({
      Bucket: BUCKETS.UPLOADS,
      Key: key,
      ContentType: contentType,
    });
    
    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
    
    return { uploadUrl, fileId, key };
  },
  
  async getPublicUrl(bucket: string, key: string): Promise<string> {
    // Return CDN URL if configured, otherwise direct R2 URL
    if (config.r2.cdnDomain) {
      return `https://${config.r2.cdnDomain}/${bucket}/${key}`;
    }
    return `${config.r2.endpoint}/${bucket}/${key}`;
  },
  
  async download(bucket: string, key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    
    const response = await r2Client.send(command);
    const chunks: Buffer[] = [];
    
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  },
  
  async delete(bucket: string, key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    
    await r2Client.send(command);
  },
  
  async uploadGenerated(
    childId: string,
    type: 'image' | 'audio' | 'video',
    content: Buffer,
    contentType: string
  ): Promise<string> {
    const bucket = type === 'audio' ? BUCKETS.AUDIO : BUCKETS.GENERATED;
    const ext = contentType.split('/')[1];
    const key = `${childId}/${type}/${generateId()}.${ext}`;
    
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: contentType,
    });
    
    await r2Client.send(command);
    
    return this.getPublicUrl(bucket, key);
  },
  
  // Cleanup old temp files (run via cron)
  async cleanupTempFiles(olderThanHours: number = 24): Promise<number> {
    // List and delete old files from temp bucket
    // ... implementation
    return 0;
  },
};
```

---

## 12. Environment Configuration

### Environment Variables

```bash
# .env.example

# ============================================
# SERVER
# ============================================
NODE_ENV=development
PORT=3000
API_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

# ============================================
# DATABASE (Railway PostgreSQL)
# ============================================
DATABASE_URL=postgresql://user:password@host:5432/nanobanana?schema=public

# ============================================
# REDIS (Railway Redis)
# ============================================
REDIS_URL=redis://default:password@host:6379

# ============================================
# AUTHENTICATION
# ============================================
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# ============================================
# GOOGLE CLOUD / GEMINI
# ============================================
GOOGLE_CLOUD_PROJECT=nanobanana-prod
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-1.5-flash-latest

# ============================================
# CLOUDFLARE R2
# ============================================
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_CDN_DOMAIN=cdn.nanobanana.com

# ============================================
# ELEVENLABS (TTS)
# ============================================
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_VOICE_ID=voice-id-for-jeffrey

# ============================================
# STRIPE (Payments)
# ============================================
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_FAMILY=price_...
STRIPE_PRICE_FAMILY_PLUS=price_...
STRIPE_PRICE_ANNUAL=price_...

# ============================================
# EMAIL (SendGrid/Resend)
# ============================================
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG....
EMAIL_FROM=hello@nanobanana.com
EMAIL_FROM_NAME=NanoBanana Learning

# ============================================
# SAFETY & MONITORING
# ============================================
SAFETY_LOG_LEVEL=info
ENABLE_PARENT_ALERTS=true
SENTRY_DSN=https://...@sentry.io/...

# ============================================
# RATE LIMITING
# ============================================
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
CHAT_RATE_LIMIT_WINDOW_MS=60000
CHAT_RATE_LIMIT_MAX=30
```

### Config Loader

```typescript
// src/config/index.ts

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  env: z.enum(['development', 'production', 'test']),
  port: z.number().default(3000),
  apiUrl: z.string().url(),
  frontendUrl: z.string().url(),
  
  database: z.object({
    url: z.string(),
  }),
  
  redis: z.object({
    url: z.string(),
  }),
  
  jwt: z.object({
    secret: z.string().min(32),
    accessExpiry: z.string().default('15m'),
    refreshExpiry: z.string().default('7d'),
  }),
  
  gemini: z.object({
    apiKey: z.string(),
    model: z.string().default('gemini-1.5-flash-latest'),
  }),
  
  r2: z.object({
    accountId: z.string(),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    endpoint: z.string(),
    cdnDomain: z.string().optional(),
  }),
  
  elevenLabs: z.object({
    apiKey: z.string(),
    voiceId: z.string(),
  }),
  
  stripe: z.object({
    secretKey: z.string(),
    webhookSecret: z.string(),
    prices: z.object({
      family: z.string(),
      familyPlus: z.string(),
      annual: z.string(),
    }),
  }),
  
  email: z.object({
    provider: z.enum(['sendgrid', 'resend']),
    apiKey: z.string(),
    from: z.string().email(),
    fromName: z.string(),
  }),
});

export const config = configSchema.parse({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000'),
  apiUrl: process.env.API_URL,
  frontendUrl: process.env.FRONTEND_URL,
  
  database: {
    url: process.env.DATABASE_URL,
  },
  
  redis: {
    url: process.env.REDIS_URL,
  },
  
  jwt: {
    secret: process.env.JWT_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY,
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY,
  },
  
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL,
  },
  
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    endpoint: process.env.R2_ENDPOINT,
    cdnDomain: process.env.R2_CDN_DOMAIN,
  },
  
  elevenLabs: {
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: process.env.ELEVENLABS_VOICE_ID,
  },
  
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    prices: {
      family: process.env.STRIPE_PRICE_FAMILY,
      familyPlus: process.env.STRIPE_PRICE_FAMILY_PLUS,
      annual: process.env.STRIPE_PRICE_ANNUAL,
    },
  },
  
  email: {
    provider: process.env.EMAIL_PROVIDER as 'sendgrid' | 'resend',
    apiKey: process.env.SENDGRID_API_KEY || process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    fromName: process.env.EMAIL_FROM_NAME,
  },
});
```

---

## 13. Railway Deployment

### railway.json

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "numReplicas": 1,
    "sleepApplication": false,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Dockerfile (Alternative)

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
COPY . .
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start command
CMD ["npm", "start"]
```

### package.json Scripts

```json
{
  "name": "nanobanana-backend",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "db:migrate": "prisma migrate deploy",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:seed": "tsx scripts/seed.ts",
    "test": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "@prisma/client": "^5.10.0",
    "@aws-sdk/client-s3": "^3.500.0",
    "@aws-sdk/s3-request-presigner": "^3.500.0",
    "bcrypt": "^5.1.1",
    "bullmq": "^5.1.0",
    "cors": "^2.8.5",
    "date-fns": "^3.3.0",
    "dotenv": "^16.4.0",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "ioredis": "^5.3.2",
    "jsonwebtoken": "^9.0.2",
    "morgan": "^1.10.0",
    "multer": "^1.4.5-lts.1",
    "pdf-parse": "^1.1.1",
    "stripe": "^14.14.0",
    "uuid": "^9.0.1",
    "winston": "^3.11.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/bcrypt": "^5.0.2",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/morgan": "^1.9.9",
    "@types/multer": "^1.4.11",
    "@types/node": "^20.11.0",
    "@types/uuid": "^9.0.7",
    "prisma": "^5.10.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.0"
  }
}
```

---

## 14. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
**Focus: Core infrastructure and authentication**

| Day | Tasks | Deliverables |
|-----|-------|--------------|
| 1-2 | Project setup, Railway config, env vars | Running Express server on Railway |
| 3-4 | Prisma schema, initial migration | Database tables created |
| 5-6 | Authentication service, JWT, Redis sessions | Parent signup/login working |
| 7-8 | Child profile creation, PIN switching | Multi-child support |
| 9-10 | COPPA consent flow (credit card verification) | Stripe integration for consent |

**Deliverables:**
- [ ] Express server deployed on Railway
- [ ] PostgreSQL + Redis connected
- [ ] Parent authentication complete
- [ ] Child profiles with PIN switching
- [ ] Basic COPPA consent verification

---

### Phase 2: Core Learning (Week 3-4)
**Focus: Content processing and AI integration**

| Day | Tasks | Deliverables |
|-----|-------|--------------|
| 11-12 | R2 storage setup, presigned uploads | File upload working |
| 13-14 | Content processing pipeline (PDF/image) | Text extraction working |
| 15-16 | Gemini integration, safety filters | AI chat with safety |
| 17-18 | Chat API with lesson context | Jeffrey responds to lessons |
| 19-20 | Flashcard generation | AI-generated flashcards |

**Deliverables:**
- [ ] File uploads to R2
- [ ] PDF/image text extraction
- [ ] Gemini chat integration
- [ ] Safety filtering on all AI interactions
- [ ] AI flashcard generation

---

### Phase 3: Gamification (Week 5-6)
**Focus: XP, streaks, badges, engagement**

| Day | Tasks | Deliverables |
|-----|-------|--------------|
| 21-22 | XP engine, level calculations | XP awards on actions |
| 23-24 | Streak tracking, daily challenges | Streak system working |
| 25-26 | Badge definitions, unlock logic | Badges awarded |
| 27-28 | Leaderboard (privacy-safe) | Rankings visible |
| 29-30 | Progress tracking, parent dashboard data | Dashboard API complete |

**Deliverables:**
- [ ] Complete XP system
- [ ] Streak tracking with freeze
- [ ] 20+ badges defined
- [ ] Daily challenges
- [ ] Parent dashboard API

---

### Phase 4: Safety & Polish (Week 7-8)
**Focus: Compliance, monitoring, optimization**

| Day | Tasks | Deliverables |
|-----|-------|--------------|
| 31-32 | Safety logging, parent alerts | Incident tracking |
| 33-34 | Rate limiting, abuse prevention | Protection in place |
| 35-36 | Caching optimization | Redis caching working |
| 37-38 | Integration testing | All endpoints tested |
| 39-40 | Performance tuning, monitoring | Production ready |

**Deliverables:**
- [ ] Safety incident logging
- [ ] Parent notification system
- [ ] Rate limiting on all routes
- [ ] Comprehensive test suite
- [ ] Production monitoring

---

### Quick Start Commands

```bash
# Clone and setup
git clone https://github.com/your-org/nanobanana-backend.git
cd nanobanana-backend
npm install
cp .env.example .env.local

# Setup database
npx prisma db push
npx prisma generate
npm run db:seed

# Run development server
npm run dev

# Run tests
npm test
```

---

## Summary

This backend architecture provides:

✅ **Secure Authentication**: JWT + Redis sessions, parent/child separation, COPPA-compliant consent  
✅ **Scalable AI Integration**: Gemini with multi-layer safety, content processing pipeline  
✅ **Engaging Gamification**: XP engine, streaks, badges, daily challenges  
✅ **Child Safety First**: Input/output filtering, safety logging, parent alerts  
✅ **Cost-Effective Storage**: Cloudflare R2 with zero egress  
✅ **Production-Ready**: Railway deployment, caching, rate limiting, monitoring  

**Estimated Total Implementation Time: 8 weeks (solo developer)**
**Recommended Team Size: 1-2 backend developers**

The modular architecture allows for incremental development, starting with auth and gradually adding AI features.
