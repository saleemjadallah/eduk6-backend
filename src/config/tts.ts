// Google Cloud Text-to-Speech Configuration
// Handles both local (file-based) and production (env var JSON) credentials
import textToSpeech from '@google-cloud/text-to-speech';
import { logger } from '../utils/logger.js';

let ttsClient: textToSpeech.TextToSpeechClient | null = null;

/**
 * Get or create the TTS client with proper credentials
 * - In production: Uses GOOGLE_CREDENTIALS_JSON env var (base64 encoded JSON)
 * - In development: Uses GOOGLE_APPLICATION_CREDENTIALS file path
 */
export function getTTSClient(): textToSpeech.TextToSpeechClient {
  if (ttsClient) {
    return ttsClient;
  }

  // Check for base64-encoded credentials in env var (production)
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;

  if (credentialsJson) {
    try {
      // Decode base64 and parse JSON
      const decodedCredentials = Buffer.from(credentialsJson, 'base64').toString('utf-8');
      const credentials = JSON.parse(decodedCredentials);

      ttsClient = new textToSpeech.TextToSpeechClient({
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key,
        },
        projectId: credentials.project_id,
      });

      logger.info('TTS client initialized with GOOGLE_CREDENTIALS_JSON');
      return ttsClient;
    } catch (error) {
      logger.error('Failed to parse GOOGLE_CREDENTIALS_JSON', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Invalid GOOGLE_CREDENTIALS_JSON format');
    }
  }

  // Fall back to default credentials (GOOGLE_APPLICATION_CREDENTIALS file)
  // This works in local development
  ttsClient = new textToSpeech.TextToSpeechClient();
  logger.info('TTS client initialized with default credentials');
  return ttsClient;
}
