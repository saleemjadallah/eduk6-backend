// IEP Goal Writer Service - AI-generated SMART goals and accommodations
// Creates legally-compliant IEP goals based on present levels of performance
import { genAI } from '../../config/gemini.js';
import { config } from '../../config/index.js';
import { prisma } from '../../config/database.js';
import { TokenOperation, IEPGoalSession, DisabilityCategory, IEPSubjectArea, Prisma } from '@prisma/client';
import { quotaService } from './quotaService.js';
import { logger } from '../../utils/logger.js';

// ============================================
// TYPES
// ============================================

export interface SMARTGoal {
  id: string;
  goalStatement: string;           // Full SMART goal statement
  baseline: string;                // Current performance level
  target: string;                  // Target performance level
  measurementMethod: string;       // How progress will be measured
  frequency: string;               // How often measurement occurs
  accuracyCriteria: string;        // e.g., "80% accuracy"
  trials: string;                  // e.g., "3 consecutive sessions"
  timeframe: string;               // e.g., "By the end of the IEP period"
  shortTermObjectives?: string[];  // Optional benchmarks
}

export interface AccommodationCategory {
  category: 'presentation' | 'response' | 'setting' | 'timing';
  title: string;
  accommodations: Array<{
    accommodation: string;
    rationale: string;
    implementationTips?: string;
  }>;
}

export interface ProgressMonitoringPlan {
  tool: string;                    // Assessment tool to use
  frequency: string;               // How often to monitor
  dataCollection: string;          // How to collect data
  decisionRules: string;           // When to adjust instruction
}

export interface GenerateIEPGoalsInput {
  gradeLevel: string;
  disabilityCategory: DisabilityCategory;
  subjectArea: IEPSubjectArea;
  presentLevels: string;           // Current performance description
  strengths?: string;              // Student strengths
  challenges?: string;             // Areas of difficulty
  previousGoals?: string;          // Previous IEP goals (for continuity)
  additionalContext?: string;      // Extra info from teacher
}

export interface GeneratedIEPContent {
  goals: SMARTGoal[];
  accommodations: AccommodationCategory[];
  progressMonitoring: ProgressMonitoringPlan[];
  tokensUsed: number;
}

export interface CreateIEPSessionInput extends GenerateIEPGoalsInput {
  studentIdentifier?: string;      // Optional reference (e.g., "Student A")
  goalStartDate?: Date;
  goalEndDate?: Date;
}

export interface UpdateIEPSessionInput {
  studentIdentifier?: string;
  gradeLevel?: string;
  presentLevels?: string;
  strengths?: string;
  challenges?: string;
  selectedGoals?: unknown;
  goalStartDate?: Date;
  goalEndDate?: Date;
}

// Human-readable labels for enums (IDEA 13 disability categories)
export const DISABILITY_LABELS: Record<DisabilityCategory, string> = {
  SPECIFIC_LEARNING_DISABILITY: 'Specific Learning Disability (SLD)',
  SPEECH_LANGUAGE_IMPAIRMENT: 'Speech or Language Impairment',
  OTHER_HEALTH_IMPAIRMENT: 'Other Health Impairment (OHI/ADHD)',
  AUTISM_SPECTRUM: 'Autism Spectrum Disorder',
  EMOTIONAL_DISTURBANCE: 'Emotional Disturbance',
  INTELLECTUAL_DISABILITY: 'Intellectual Disability',
  DEVELOPMENTAL_DELAY: 'Developmental Delay (ages 3-9)',
  MULTIPLE_DISABILITIES: 'Multiple Disabilities',
  HEARING_IMPAIRMENT: 'Hearing Impairment (including Deafness)',
  VISUAL_IMPAIRMENT: 'Visual Impairment (including Blindness)',
  ORTHOPEDIC_IMPAIRMENT: 'Orthopedic Impairment',
  TRAUMATIC_BRAIN_INJURY: 'Traumatic Brain Injury',
  DEAF_BLINDNESS: 'Deaf-Blindness',
};

export const SUBJECT_AREA_LABELS: Record<IEPSubjectArea, string> = {
  READING_FLUENCY: 'Reading Fluency',
  READING_COMPREHENSION: 'Reading Comprehension',
  WRITTEN_EXPRESSION: 'Written Expression',
  MATH_CALCULATION: 'Math Calculation',
  MATH_PROBLEM_SOLVING: 'Math Problem Solving',
  SPEECH_ARTICULATION: 'Speech Articulation',
  EXPRESSIVE_LANGUAGE: 'Expressive Language',
  RECEPTIVE_LANGUAGE: 'Receptive Language',
  SOCIAL_SKILLS: 'Social Skills',
  BEHAVIOR_SELF_REGULATION: 'Behavior/Self-Regulation',
  EXECUTIVE_FUNCTIONING: 'Executive Functioning',
  FINE_MOTOR: 'Fine Motor Skills',
  GROSS_MOTOR: 'Gross Motor Skills',
  ADAPTIVE_LIVING_SKILLS: 'Adaptive/Daily Living Skills',
  TRANSITION_VOCATIONAL: 'Transition/Vocational Skills',
};

// ============================================
// SERVICE
// ============================================

export const iepGoalService = {
  /**
   * Generate SMART IEP goals and accommodations
   * Uses Gemini 3 Flash for legally-compliant goal generation
   */
  async generateIEPGoals(
    teacherId: string,
    input: GenerateIEPGoalsInput
  ): Promise<GeneratedIEPContent> {
    // Check quota
    const estimatedTokens = 5000; // ~50 credits per IEP session
    await quotaService.enforceQuota(teacherId, TokenOperation.IEP_GOAL_GENERATION, estimatedTokens);

    logger.info('Generating IEP goals', {
      teacherId,
      disabilityCategory: input.disabilityCategory,
      subjectArea: input.subjectArea,
    });

    const prompt = buildIEPGoalPrompt(input);

    // Use Gemini 3 Flash for IEP goal generation
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      generationConfig: {
        temperature: 0.5, // Lower temperature for more consistent, compliant goals
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const tokensUsed = result.response.usageMetadata?.totalTokenCount || estimatedTokens;

    try {
      const parsed = JSON.parse(extractJSON(responseText)) as {
        goals: SMARTGoal[];
        accommodations: AccommodationCategory[];
        progressMonitoring: ProgressMonitoringPlan[];
      };

      // Record usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.IEP_GOAL_GENERATION,
        tokensUsed,
        modelUsed: config.gemini.models.flash,
        resourceType: 'iep_goals',
      });

      return {
        ...parsed,
        tokensUsed,
      };
    } catch (error) {
      logger.error('Failed to parse generated IEP goals', {
        error: error instanceof Error ? error.message : 'Unknown error',
        responseText: responseText.substring(0, 500),
      });
      throw new Error('Failed to generate IEP goals');
    }
  },

  /**
   * Create a new IEP goal session (generates content immediately)
   */
  async createIEPSession(
    teacherId: string,
    input: CreateIEPSessionInput
  ): Promise<IEPGoalSession> {
    // Generate the IEP content
    const generated = await this.generateIEPGoals(teacherId, input);

    // Create the database record
    const session = await prisma.iEPGoalSession.create({
      data: {
        teacherId,
        studentIdentifier: input.studentIdentifier,
        gradeLevel: input.gradeLevel,
        disabilityCategory: input.disabilityCategory,
        subjectArea: input.subjectArea,
        presentLevels: input.presentLevels,
        strengths: input.strengths,
        challenges: input.challenges,
        generatedGoals: generated.goals as unknown as object,
        accommodations: generated.accommodations as unknown as object,
        progressMonitoring: generated.progressMonitoring as unknown as object,
        goalStartDate: input.goalStartDate,
        goalEndDate: input.goalEndDate,
        tokensUsed: generated.tokensUsed,
        modelUsed: config.gemini.models.flash,
      },
    });

    logger.info('IEP goal session created', {
      teacherId,
      sessionId: session.id,
      disabilityCategory: input.disabilityCategory,
      subjectArea: input.subjectArea,
    });

    return session;
  },

  /**
   * Get IEP session by ID
   */
  async getIEPSession(
    sessionId: string,
    teacherId: string
  ): Promise<IEPGoalSession | null> {
    return prisma.iEPGoalSession.findFirst({
      where: { id: sessionId, teacherId },
    });
  },

  /**
   * List IEP sessions for a teacher
   */
  async listIEPSessions(
    teacherId: string,
    options: {
      limit?: number;
      offset?: number;
      disabilityCategory?: DisabilityCategory;
      subjectArea?: IEPSubjectArea;
    } = {}
  ): Promise<{ sessions: IEPGoalSession[]; total: number }> {
    const { limit = 20, offset = 0, disabilityCategory, subjectArea } = options;

    const where: {
      teacherId: string;
      disabilityCategory?: DisabilityCategory;
      subjectArea?: IEPSubjectArea;
    } = { teacherId };

    if (disabilityCategory) where.disabilityCategory = disabilityCategory;
    if (subjectArea) where.subjectArea = subjectArea;

    const [sessions, total] = await Promise.all([
      prisma.iEPGoalSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.iEPGoalSession.count({ where }),
    ]);

    return { sessions, total };
  },

  /**
   * Update an IEP session (e.g., select goals, update dates)
   */
  async updateIEPSession(
    sessionId: string,
    teacherId: string,
    input: UpdateIEPSessionInput
  ): Promise<IEPGoalSession> {
    const existing = await prisma.iEPGoalSession.findFirst({
      where: { id: sessionId, teacherId },
    });

    if (!existing) {
      throw new Error('IEP session not found');
    }

    const updateData: Record<string, unknown> = {};
    if (input.studentIdentifier !== undefined) updateData.studentIdentifier = input.studentIdentifier;
    if (input.gradeLevel !== undefined) updateData.gradeLevel = input.gradeLevel;
    if (input.presentLevels !== undefined) updateData.presentLevels = input.presentLevels;
    if (input.strengths !== undefined) updateData.strengths = input.strengths;
    if (input.challenges !== undefined) updateData.challenges = input.challenges;
    if (input.selectedGoals !== undefined) updateData.selectedGoals = input.selectedGoals as object;
    if (input.goalStartDate !== undefined) updateData.goalStartDate = input.goalStartDate;
    if (input.goalEndDate !== undefined) updateData.goalEndDate = input.goalEndDate;

    return prisma.iEPGoalSession.update({
      where: { id: sessionId },
      data: updateData,
    });
  },

  /**
   * Delete an IEP session
   */
  async deleteIEPSession(
    sessionId: string,
    teacherId: string
  ): Promise<void> {
    const existing = await prisma.iEPGoalSession.findFirst({
      where: { id: sessionId, teacherId },
    });

    if (!existing) {
      throw new Error('IEP session not found');
    }

    await prisma.iEPGoalSession.delete({
      where: { id: sessionId },
    });

    logger.info('IEP session deleted', { teacherId, sessionId });
  },

  /**
   * Regenerate goals for an existing session
   */
  async regenerateGoals(
    sessionId: string,
    teacherId: string,
    additionalContext?: string
  ): Promise<IEPGoalSession> {
    const existing = await prisma.iEPGoalSession.findFirst({
      where: { id: sessionId, teacherId },
    });

    if (!existing) {
      throw new Error('IEP session not found');
    }

    // Regenerate the goals
    const generated = await this.generateIEPGoals(teacherId, {
      gradeLevel: existing.gradeLevel,
      disabilityCategory: existing.disabilityCategory,
      subjectArea: existing.subjectArea,
      presentLevels: existing.presentLevels,
      strengths: existing.strengths || undefined,
      challenges: existing.challenges || undefined,
      additionalContext,
    });

    // Update with new goals
    return prisma.iEPGoalSession.update({
      where: { id: sessionId },
      data: {
        generatedGoals: generated.goals as unknown as object,
        accommodations: generated.accommodations as unknown as object,
        progressMonitoring: generated.progressMonitoring as unknown as object,
        selectedGoals: Prisma.JsonNull, // Reset selections
        tokensUsed: existing.tokensUsed + generated.tokensUsed,
      },
    });
  },

  /**
   * Get available disability categories with labels
   */
  getDisabilityCategories(): Array<{ value: DisabilityCategory; label: string }> {
    return Object.entries(DISABILITY_LABELS).map(([value, label]) => ({
      value: value as DisabilityCategory,
      label,
    }));
  },

  /**
   * Get available subject areas with labels
   */
  getSubjectAreas(): Array<{ value: IEPSubjectArea; label: string }> {
    return Object.entries(SUBJECT_AREA_LABELS).map(([value, label]) => ({
      value: value as IEPSubjectArea,
      label,
    }));
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractJSON(text: string): string {
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Continue
  }

  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    const extracted = jsonBlockMatch[1].trim();
    try {
      JSON.parse(extracted);
      return extracted;
    } catch {
      // Continue
    }
  }

  const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    return jsonObjectMatch[0];
  }

  return text;
}

function buildIEPGoalPrompt(input: GenerateIEPGoalsInput): string {
  const disabilityLabel = DISABILITY_LABELS[input.disabilityCategory];
  const subjectLabel = SUBJECT_AREA_LABELS[input.subjectArea];

  return `You are an expert special education consultant helping write IEP (Individualized Education Program) goals that are legally compliant with IDEA (Individuals with Disabilities Education Act).

STUDENT INFORMATION:
- Grade Level: ${input.gradeLevel}
- Disability Category: ${disabilityLabel}
- Goal Area: ${subjectLabel}

PRESENT LEVELS OF PERFORMANCE:
${input.presentLevels}

${input.strengths ? `STUDENT STRENGTHS:\n${input.strengths}\n` : ''}
${input.challenges ? `AREAS OF CHALLENGE:\n${input.challenges}\n` : ''}
${input.previousGoals ? `PREVIOUS IEP GOALS (for continuity):\n${input.previousGoals}\n` : ''}
${input.additionalContext ? `ADDITIONAL CONTEXT:\n${input.additionalContext}\n` : ''}

Generate 3-5 SMART IEP goals following this format:
"By [timeframe], [student] will [measurable skill/behavior] from [baseline] to [target], as measured by [assessment method], with [accuracy/frequency] across [number] consecutive [trials/data points]."

SMART GOAL REQUIREMENTS:
- **Specific**: Clearly define the skill or behavior
- **Measurable**: Include quantifiable criteria (percentages, frequencies, scores)
- **Achievable**: Realistic given present levels (typical growth is 1-1.5 grade levels/year)
- **Relevant**: Directly address identified needs from present levels
- **Time-bound**: Include clear timeframe (typically annual)

ACCOMMODATION CATEGORIES:
1. **Presentation**: How information is presented to the student
2. **Response**: How the student demonstrates learning
3. **Setting**: Where the student learns/tests
4. **Timing/Scheduling**: When and how long

Generate accommodations that are:
- Specific to the disability category
- Practical to implement in a classroom
- Research-based and effective
- Not giving unfair advantage, but leveling the playing field

Return JSON with this structure:
{
  "goals": [
    {
      "id": "goal_1",
      "goalStatement": "Full SMART goal statement",
      "baseline": "Current performance level (from present levels)",
      "target": "Target performance level",
      "measurementMethod": "How progress will be measured (e.g., curriculum-based measurement, teacher observation, work samples)",
      "frequency": "How often measurement occurs (e.g., weekly, bi-weekly)",
      "accuracyCriteria": "Success criteria (e.g., 80% accuracy, 4 out of 5 trials)",
      "trials": "Consistency requirement (e.g., 3 consecutive sessions)",
      "timeframe": "By end of IEP period",
      "shortTermObjectives": ["Optional benchmark 1", "Optional benchmark 2"]
    }
  ],
  "accommodations": [
    {
      "category": "presentation",
      "title": "Presentation Accommodations",
      "accommodations": [
        {
          "accommodation": "Specific accommodation",
          "rationale": "Why this helps the student",
          "implementationTips": "How to implement effectively"
        }
      ]
    },
    {
      "category": "response",
      "title": "Response Accommodations",
      "accommodations": [...]
    },
    {
      "category": "setting",
      "title": "Setting Accommodations",
      "accommodations": [...]
    },
    {
      "category": "timing",
      "title": "Timing/Scheduling Accommodations",
      "accommodations": [...]
    }
  ],
  "progressMonitoring": [
    {
      "tool": "Assessment tool name (e.g., DIBELS, AIMSweb, teacher-made probes)",
      "frequency": "How often to collect data",
      "dataCollection": "Method for collecting and recording data",
      "decisionRules": "When to adjust instruction (e.g., 4 consecutive data points below aimline)"
    }
  ]
}

IMPORTANT:
- Goals must be educationally meaningful and address the student's unique needs
- Use person-first language (e.g., "student with autism" not "autistic student")
- Avoid jargon; goals should be understandable by parents
- Include both academic/skill goals and may include behavioral components if relevant
- Accommodations should be disability-specific, not generic
- Progress monitoring should be feasible for classroom teachers`;
}

export default iepGoalService;
