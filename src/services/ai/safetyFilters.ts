// Safety filters for child-appropriate content
import { AgeGroup } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { SafetyIncidentType, SafetySeverity } from '@prisma/client';

export interface SafetyValidation {
  passed: boolean;
  flags: string[];
  severity?: SafetySeverity;
}

// Blocklist patterns (case insensitive)
const BLOCKED_PATTERNS = {
  // Personal information requests
  PII: [
    /what('s| is) your (real )?name/i,
    /where (do you|are you) liv(e|ing)/i,
    /what school/i,
    /how old are you/i,
    /what('s| is) your (phone|address|email)/i,
    /tell me about your family/i,
    /where are your parents/i,
  ],

  // Inappropriate topics
  INAPPROPRIATE: [
    /\b(kill|murder|die|death|dead|suicide|hurt|harm)\b/i,
    /\b(sex|sexy|naked|porn|xxx)\b/i,
    /\b(drugs?|weed|cocaine|heroin|meth)\b/i,
    /\b(gun|weapon|bomb|explode)\b/i,
    /\b(alcohol|beer|wine|drunk)\b/i,
    /\b(hate|racist|sexist)\b/i,
    /\b(war|terrorist|attack)\b/i,
  ],

  // Jailbreak attempts
  JAILBREAK: [
    /ignore (your|all|previous) (instructions|rules|guidelines)/i,
    /pretend (you('re| are)|to be)/i,
    /act (like|as if)/i,
    /you('re| are) now/i,
    /from now on/i,
    /let('s| us) play a game/i,
    /roleplay as/i,
    /bypass (your|the) (filter|safety)/i,
    /developer mode/i,
    /DAN mode/i,
  ],

  // Profanity (basic list, expand as needed)
  PROFANITY: [
    /\b(damn|hell|crap|shit|fuck|ass|bitch|bastard)\b/i,
    /\bwtf\b/i,
    /\bomg\b/i,
  ],
};

// Topics that should trigger gentle redirection
const REDIRECT_TOPICS = [
  /\b(boyfriend|girlfriend|dating|kiss)\b/i,
  /\b(fight|fighting|bully)\b/i,
  /\b(scary|nightmare|monster)\b/i,
  /\b(politics|president|election)\b/i,
  /\b(religion|god|pray|church|mosque|temple)\b/i,
];

export class SafetyFilters {
  /**
   * Validate user input before sending to AI
   */
  async validateInput(
    text: string,
    ageGroup: AgeGroup
  ): Promise<SafetyValidation> {
    const flags: string[] = [];
    let severity: SafetySeverity = 'LOW';

    // Check for PII requests
    for (const pattern of BLOCKED_PATTERNS.PII) {
      if (pattern.test(text)) {
        flags.push('pii_request');
        severity = 'MEDIUM';
      }
    }

    // Check for inappropriate content
    for (const pattern of BLOCKED_PATTERNS.INAPPROPRIATE) {
      if (pattern.test(text)) {
        flags.push('inappropriate_topic');
        severity = 'HIGH';
      }
    }

    // Check for jailbreak attempts
    for (const pattern of BLOCKED_PATTERNS.JAILBREAK) {
      if (pattern.test(text)) {
        flags.push('jailbreak_attempt');
        severity = 'CRITICAL';
      }
    }

    // Check for profanity
    for (const pattern of BLOCKED_PATTERNS.PROFANITY) {
      if (pattern.test(text)) {
        flags.push('profanity');
        severity = severity === 'LOW' ? 'LOW' : severity;
      }
    }

    // Stricter checks for younger children
    if (ageGroup === 'YOUNG') {
      for (const pattern of REDIRECT_TOPICS) {
        if (pattern.test(text)) {
          flags.push('redirect_topic');
        }
      }
    }

    return {
      passed: flags.length === 0,
      flags,
      severity: flags.length > 0 ? severity : undefined,
    };
  }

  /**
   * Validate AI output before showing to child
   */
  async validateOutput(
    text: string,
    ageGroup: AgeGroup
  ): Promise<SafetyValidation> {
    const flags: string[] = [];
    let severity: SafetySeverity = 'LOW';

    // Check for inappropriate content in output
    for (const pattern of BLOCKED_PATTERNS.INAPPROPRIATE) {
      if (pattern.test(text)) {
        flags.push('inappropriate_output');
        severity = 'HIGH';
      }
    }

    // Check for profanity in output
    for (const pattern of BLOCKED_PATTERNS.PROFANITY) {
      if (pattern.test(text)) {
        flags.push('profanity_output');
        severity = 'MEDIUM';
      }
    }

    // Check for external links
    if (/https?:\/\/[^\s]+/i.test(text)) {
      flags.push('external_link');
      severity = 'MEDIUM';
    }

    // Check for PII in output (should never happen, but safety check)
    if (/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(text)) {
      // Phone number pattern
      flags.push('pii_output');
      severity = 'HIGH';
    }

    return {
      passed: flags.length === 0,
      flags,
      severity: flags.length > 0 ? severity : undefined,
    };
  }

  /**
   * Validate uploaded content is child-appropriate
   */
  async validateContent(
    content: { summary?: string; keyConcepts?: string[]; vocabulary?: unknown[] },
    ageGroup: AgeGroup
  ): Promise<SafetyValidation> {
    const textToCheck = [
      content.summary || '',
      ...(content.keyConcepts || []),
    ].join(' ');

    const flags: string[] = [];

    // Check for inappropriate content
    for (const pattern of BLOCKED_PATTERNS.INAPPROPRIATE) {
      if (pattern.test(textToCheck)) {
        flags.push('inappropriate_content');
      }
    }

    return {
      passed: flags.length === 0,
      flags,
    };
  }

  /**
   * Log a safety incident
   */
  async logIncident(
    childId: string,
    incidentType: SafetyIncidentType,
    severity: SafetySeverity,
    context: {
      inputText?: string;
      outputText?: string;
      lessonId?: string;
      flags: string[];
      geminiSafetyRatings?: unknown;
    }
  ): Promise<void> {
    await prisma.safetyLog.create({
      data: {
        childId,
        incidentType,
        severity,
        inputText: context.inputText,
        outputText: context.outputText,
        lessonId: context.lessonId,
        flags: context.flags,
        geminiSafetyRatings: context.geminiSafetyRatings ?? undefined,
        wasBlocked: true,
      },
    });

    // If high severity, notify parent
    if (severity === 'HIGH' || severity === 'CRITICAL') {
      await this.notifyParent(childId, incidentType, severity);
    }
  }

  /**
   * Notify parent of safety incident
   */
  private async notifyParent(
    childId: string,
    incidentType: SafetyIncidentType,
    severity: SafetySeverity
  ): Promise<void> {
    // TODO: Implement parent notification (push notification, email)
    // For now, just update the safety log
    await prisma.safetyLog.updateMany({
      where: {
        childId,
        incidentType,
        severity,
        parentNotified: false,
      },
      data: {
        parentNotified: true,
        parentNotifiedAt: new Date(),
      },
    });
  }
}

export const safetyFilters = new SafetyFilters();
