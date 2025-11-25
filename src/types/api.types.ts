// API Request/Response Types
import { AgeGroup, Subject, SourceType, MessageRole, QuizType } from '@prisma/client';

// ============================================
// COMMON
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ============================================
// AUTH
// ============================================

export interface SignupRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  country?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  parent: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  children: Array<{
    id: string;
    displayName: string;
    avatarUrl?: string;
    ageGroup: AgeGroup;
  }>;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  token: string;
  refreshToken: string;
}

// ============================================
// CHILD
// ============================================

export interface CreateChildRequest {
  displayName: string;
  dateOfBirth: string;
  pin: string;
  gradeLevel?: number;
  curriculumType?: string;
}

export interface SwitchToChildRequest {
  pin: string;
}

export interface SwitchToChildResponse {
  childToken: string;
  child: {
    id: string;
    displayName: string;
    avatarUrl?: string;
    ageGroup: AgeGroup;
  };
}

// ============================================
// LESSONS
// ============================================

export interface CreateLessonRequest {
  title?: string;
  subject?: Subject;
  sourceType: SourceType;
  youtubeUrl?: string;
}

export interface LessonResponse {
  id: string;
  title: string;
  summary?: string;
  subject?: Subject;
  gradeLevel?: string;
  sourceType: SourceType;
  processingStatus: string;
  chapters?: Array<{
    title: string;
    content: string;
    startPage?: number;
  }>;
  keyConcepts: string[];
  vocabulary?: Array<{
    term: string;
    definition: string;
    example?: string;
  }>;
  suggestedQuestions: string[];
  percentComplete: number;
  createdAt: string;
}

export interface UpdateProgressRequest {
  percentComplete: number;
  timeSpentSeconds: number;
}

// ============================================
// CHAT
// ============================================

export interface ChatMessageRequest {
  content: string;
}

export interface ChatMessageResponse {
  userMessage: {
    id: string;
    role: MessageRole;
    content: string;
    createdAt: string;
  };
  assistantMessage: {
    id: string;
    role: MessageRole;
    content: string;
    audioUrl?: string;
    createdAt: string;
  };
  xpAwarded: number;
  safetyStatus: 'safe' | 'filtered' | 'blocked';
}

// ============================================
// FLASHCARDS
// ============================================

export interface CreateDeckRequest {
  title: string;
  description?: string;
  subject?: Subject;
  lessonId?: string;
}

export interface CreateFlashcardRequest {
  front: string;
  back: string;
  imageUrl?: string;
}

export interface FlashcardReviewRequest {
  quality: 0 | 1 | 2 | 3 | 4 | 5; // SM-2 quality rating
}

export interface FlashcardReviewResponse {
  nextReview: string;
  xpAwarded: number;
}

// ============================================
// QUIZZES
// ============================================

export interface GenerateQuizRequest {
  lessonId: string;
  type?: QuizType;
  count?: number;
}

export interface QuizAttemptRequest {
  answers: Array<{
    questionId: string;
    answer: string;
  }>;
}

export interface QuizAttemptResponse {
  score: number;
  correctAnswers: Array<{
    questionId: string;
    correctAnswer: string;
    userAnswer: string;
    isCorrect: boolean;
  }>;
  xpAwarded: number;
  perfectBonus?: number;
}

// ============================================
// GAMIFICATION
// ============================================

export interface ProgressResponse {
  xp: number;
  level: number;
  xpToNextLevel: number;
  streak: {
    current: number;
    longest: number;
    freezeAvailable: boolean;
  };
  badges: Array<{
    code: string;
    name: string;
    icon: string;
    earnedAt: string;
  }>;
  dailyChallenge?: {
    description: string;
    progress: number;
    target: number;
    xpReward: number;
  };
  recentAchievements: Array<{
    type: 'badge' | 'level_up' | 'streak';
    name: string;
    earnedAt: string;
  }>;
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  avatar?: string;
  xp: number;
}

export interface LeaderboardResponse {
  rankings: LeaderboardEntry[];
  userRank: number;
}

// ============================================
// TEXT SELECTION
// ============================================

export interface TextSelectionRequest {
  lessonId: string;
  selectedText: string;
  context?: string;
  userQuestion?: string;
}

export interface AskJeffreyResponse {
  answer: string;
  voiceUrl?: string;
  xpAwarded: number;
}

export interface CreateFlashcardFromSelectionResponse {
  flashcard: {
    id: string;
    front: string;
    back: string;
  };
  deckId: string;
  xpAwarded: number;
}

// ============================================
// UPLOADS
// ============================================

export interface PresignedUploadRequest {
  childId: string;
  contentType: 'lesson' | 'profile';
  filename: string;
  mimeType: string;
  fileSize: number;
  lessonId?: string;
}

export interface PresignedUploadResponse {
  uploadUrl: string;
  publicUrl: string;
  storagePath: string;
  expiresAt: string;
}

// ============================================
// PARENT DASHBOARD
// ============================================

export interface ChildDashboardSummary {
  id: string;
  displayName: string;
  avatarUrl?: string;
  todayProgress: {
    lessonsCompleted: number;
    questionsAnswered: number;
    studyTimeMinutes: number;
  };
  weekProgress: {
    lessonsCompleted: number;
    questionsAnswered: number;
    studyTimeMinutes: number;
  };
  currentStreak: number;
  level: number;
}

export interface ParentDashboardResponse {
  children: ChildDashboardSummary[];
  familyStats: {
    totalLessons: number;
    totalStudyTime: number;
    activeDays: number;
  };
}

export interface ChildReportResponse {
  summary: {
    lessonsCompleted: number;
    questionsAnswered: number;
    flashcardsReviewed: number;
    averageScore: number;
  };
  studyTimeByDay: Array<{
    date: string;
    minutes: number;
  }>;
  subjectProgress: Array<{
    subject: Subject;
    lessonsCompleted: number;
    masteryLevel: number;
  }>;
  strengths: string[];
  areasForImprovement: string[];
}
