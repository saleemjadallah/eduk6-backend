// Google Gemini AI configuration
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { config } from './index.js';

// Initialize Gemini client
export const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

// Child-safe safety settings - STRICTEST possible
// These settings ensure content is appropriate for children ages 4-12
export const CHILD_SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE
  },
];

// Teacher content generation safety settings - MORE PERMISSIVE
// Teachers are professionals creating educational content for students
// This allows religious education (Islamic studies, Quran, Bible, etc.),
// historical content, and other legitimate educational topics
export const TEACHER_CONTENT_SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
  },
];

// Thinking levels for Gemini 3 Pro
// Controls reasoning depth and latency tradeoffs
export type ThinkingLevel = 'LOW' | 'HIGH';

// Default generation config for child-appropriate responses
export const DEFAULT_GENERATION_CONFIG = {
  temperature: 1.0, // Gemini 3 recommends keeping at 1.0 to avoid looping
  topP: 0.8,
  topK: 40,
  maxOutputTokens: 400,
};

// Configuration for younger children (4-7) - uses LOW thinking for faster responses
export const YOUNG_CHILD_CONFIG = {
  ...DEFAULT_GENERATION_CONFIG,
  maxOutputTokens: 200, // Shorter responses for younger kids
  temperature: 1.0,
};

// Configuration for older children (8-12) - can use HIGH thinking for deeper explanations
export const OLDER_CHILD_CONFIG = {
  ...DEFAULT_GENERATION_CONFIG,
  maxOutputTokens: 600, // Longer responses for older kids
  temperature: 1.0,
};

// Gemini 3 Flash specific config for content analysis (uses thinking for better reasoning)
export const GEMINI_3_PRO_ANALYSIS_CONFIG = {
  temperature: 0.3, // Lower for more consistent analysis output
  maxOutputTokens: 65536, // Max for Gemini 3 Flash - model only uses what it needs
  responseMimeType: 'application/json',
};

// Gemini 3 Pro config for chat (Ollie) - balanced for conversational use
export const GEMINI_3_PRO_CHAT_CONFIG = {
  temperature: 1.0,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 1000,
};

// Model instances
export const getFlashModel = () => genAI.getGenerativeModel({
  model: config.gemini.models.flash,
  safetySettings: CHILD_SAFETY_SETTINGS,
});

export const getProModel = () => genAI.getGenerativeModel({
  model: config.gemini.models.pro,
  safetySettings: CHILD_SAFETY_SETTINGS,
});

// Gemini 3 Pro model for advanced reasoning tasks
export const getGemini3ProModel = () => genAI.getGenerativeModel({
  model: config.gemini.models.pro, // gemini-3-pro-preview
  safetySettings: CHILD_SAFETY_SETTINGS,
});
