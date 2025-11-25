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

// Default generation config for child-appropriate responses
export const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.7,
  topP: 0.8,
  topK: 40,
  maxOutputTokens: 400,
};

// Configuration for younger children (4-7)
export const YOUNG_CHILD_CONFIG = {
  ...DEFAULT_GENERATION_CONFIG,
  maxOutputTokens: 200, // Shorter responses
  temperature: 0.7,
};

// Configuration for older children (8-12)
export const OLDER_CHILD_CONFIG = {
  ...DEFAULT_GENERATION_CONFIG,
  maxOutputTokens: 400,
  temperature: 0.7,
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
