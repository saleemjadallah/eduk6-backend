// Substitute Teacher Plan Service - AI-generated emergency sub plans
// Creates comprehensive, self-contained plans for substitute teachers
import { genAI } from '../../config/gemini.js';
import { config } from '../../config/index.js';
import { prisma } from '../../config/database.js';
import { TokenOperation, SubstitutePlan } from '@prisma/client';
import { quotaService } from './quotaService.js';
import { logger } from '../../utils/logger.js';

// ============================================
// TYPES
// ============================================

export interface ScheduleBlock {
  startTime: string;      // e.g., "8:00 AM"
  endTime: string;        // e.g., "8:45 AM"
  activity: string;       // e.g., "Morning Meeting"
  description: string;    // Brief description for sub
  lessonId?: string;      // Reference to source lesson if applicable
}

export interface ActivityDetail {
  name: string;
  duration: number;                    // minutes
  objectives: string[];
  materials: string[];
  stepByStep: string[];                // Detailed instructions for sub
  assessmentTips?: string;             // How to know if students understand
  commonIssues?: string[];             // What might go wrong and how to handle
  differentiationNotes?: string;       // Notes for different learners
}

export interface MaterialItem {
  item: string;
  location: string;                    // Where to find it
  quantity?: string;
  alternatives?: string[];             // If item is unavailable
}

export interface ClassroomInfo {
  attentionSignal?: string;            // e.g., "Clap pattern: 1-2-3"
  bathroomPolicy?: string;
  transitionProcedures?: string;
  seatingChartLocation?: string;
  lineUpProcedure?: string;
  dismissalProcedure?: string;
}

export interface StudentNote {
  type: 'helper' | 'medical' | 'behavior' | 'accommodation';
  description: string;                 // No student names for privacy
}

export interface BackupActivity {
  name: string;
  duration: number;                    // minutes
  materials: string[];
  instructions: string[];
  whenToUse: string;                   // e.g., "If projector not working"
}

export interface EmergencyInfo {
  officePhone?: string;
  nurseLocation?: string;
  nearestTeacher?: string;
  fireDrillProcedure?: string;
  lockdownProcedure?: string;
}

// Uploaded file content for enhanced generation
export interface UploadedContent {
  text: string;                        // Extracted text from file
  title?: string;                      // File/document title
  sourceType?: 'pdf' | 'ppt' | 'image' | 'text';
  summary?: string;                    // Optional summary
}

export interface GenerateSubPlanInput {
  lessonIds?: string[];                // IDs of TeacherContent to base plan on (optional)
  date: Date;                          // Date the sub plan is for
  title: string;                       // Required title
  gradeLevel?: string;
  subject?: string;                    // Subject area
  timePeriod?: 'morning' | 'afternoon' | 'full_day';  // Time period for the plan
  // Schedule info - optional, AI generates if not provided
  schedule?: Array<{
    startTime: string;
    endTime: string;
    activity: string;                  // Brief name
  }>;
  // Optional classroom details
  classroomInfo?: Partial<ClassroomInfo>;
  classroomNotes?: string;             // Free-form classroom notes
  studentNotes?: StudentNote[];        // Privacy-safe notes
  emergencyInfo?: Partial<EmergencyInfo>;
  emergencyProcedures?: string;        // Free-form emergency info
  helpfulStudents?: string;            // Names of helpful students
  // Preferences
  includeBackupActivities?: boolean;
  additionalNotes?: string;            // Extra context from teacher
  // Uploaded file content
  uploadedContent?: UploadedContent;   // Content from uploaded PDF/PPT/image
}

export interface GeneratedSubPlan {
  title: string;
  schedule: ScheduleBlock[];
  activities: ActivityDetail[];
  materials: MaterialItem[];
  backupActivities: BackupActivity[];
  tokensUsed: number;
}

export interface CreateSubPlanInput extends GenerateSubPlanInput {
  // Title is required in base interface, can override here if needed
}

export interface UpdateSubPlanInput {
  title?: string;
  date?: Date;
  gradeLevel?: string;
  schedule?: unknown;
  classroomInfo?: unknown;
  activities?: unknown;
  materials?: unknown;
  emergencyInfo?: unknown;
  studentNotes?: unknown;
  backupActivities?: unknown;
}

// ============================================
// SERVICE
// ============================================

export const subPlanService = {
  /**
   * Generate a comprehensive substitute teacher plan from lessons
   * Uses Gemini 3 Flash for fast, high-quality plan generation
   */
  async generateSubPlan(
    teacherId: string,
    input: GenerateSubPlanInput
  ): Promise<GeneratedSubPlan> {
    // Check quota
    const estimatedTokens = 4000; // ~40 credits per sub plan
    await quotaService.enforceQuota(teacherId, TokenOperation.SUB_PLAN_GENERATION, estimatedTokens);

    logger.info('Generating substitute plan', {
      teacherId,
      lessonCount: input.lessonIds?.length || 0,
      date: input.date
    });

    // Fetch the lesson content if lessonIds provided
    let lessonSummaries: Array<{
      id: string;
      title: string;
      subject: string;
      gradeLevel: string;
      summary: string;
      objectives: string[];
      sections: string[];
      hasActivities: boolean;
    }> = [];

    if (input.lessonIds && input.lessonIds.length > 0) {
      const lessons = await prisma.teacherContent.findMany({
        where: {
          id: { in: input.lessonIds },
          teacherId,
        },
        select: {
          id: true,
          title: true,
          subject: true,
          gradeLevel: true,
          lessonContent: true,
          description: true,
        },
      });

      // Build lesson summaries for the prompt
      lessonSummaries = lessons.map(lesson => {
        const content = lesson.lessonContent as {
          title?: string;
          summary?: string;
          sections?: Array<{ title: string; content: string; activities?: unknown[] }>;
          objectives?: string[];
          vocabulary?: Array<{ term: string; definition: string }>;
        } | null;

        return {
          id: lesson.id,
          title: lesson.title,
          subject: lesson.subject || 'General',
          gradeLevel: lesson.gradeLevel || input.gradeLevel || 'Elementary',
          summary: content?.summary || lesson.description || '',
          objectives: content?.objectives || [],
          sections: content?.sections?.map(s => s.title) || [],
          hasActivities: content?.sections?.some(s => s.activities && s.activities.length > 0) || false,
        };
      });
    }

    const prompt = buildSubPlanPrompt({
      lessons: lessonSummaries,
      schedule: input.schedule,
      gradeLevel: input.gradeLevel,
      subject: input.subject,
      timePeriod: input.timePeriod,
      classroomInfo: input.classroomInfo,
      classroomNotes: input.classroomNotes,
      emergencyProcedures: input.emergencyProcedures,
      helpfulStudents: input.helpfulStudents,
      includeBackupActivities: input.includeBackupActivities !== false,
      additionalNotes: input.additionalNotes,
      uploadedContent: input.uploadedContent,
    });

    // Use Gemini 3 Flash for sub plan generation
    // Gemini Flash supports up to 1M tokens input, 65k output
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      generationConfig: {
        temperature: 0.6, // Balanced creativity and reliability
        maxOutputTokens: 65000, // Allow detailed plans with lots of material
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const tokensUsed = result.response.usageMetadata?.totalTokenCount || estimatedTokens;

    try {
      const parsed = JSON.parse(extractJSON(responseText)) as {
        title: string;
        schedule: ScheduleBlock[];
        activities: ActivityDetail[];
        materials: MaterialItem[];
        backupActivities: BackupActivity[];
      };

      // Record usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.SUB_PLAN_GENERATION,
        tokensUsed,
        modelUsed: config.gemini.models.flash,
        resourceType: 'sub_plan',
      });

      return {
        ...parsed,
        tokensUsed,
      };
    } catch (error) {
      logger.error('Failed to parse generated sub plan', {
        error: error instanceof Error ? error.message : 'Unknown error',
        responseText: responseText.substring(0, 500),
      });
      throw new Error('Failed to generate substitute plan');
    }
  },

  /**
   * Create a new substitute plan (generates content immediately)
   */
  async createSubPlan(
    teacherId: string,
    input: CreateSubPlanInput
  ): Promise<SubstitutePlan> {
    // Generate the plan content
    const generated = await this.generateSubPlan(teacherId, input);

    // Format the date for the title
    const dateStr = new Date(input.date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    // Create the database record
    const subPlan = await prisma.substitutePlan.create({
      data: {
        teacherId,
        title: input.title || generated.title || `Sub Plan - ${dateStr}`,
        date: new Date(input.date),
        gradeLevel: input.gradeLevel,
        schedule: (generated.schedule || []) as unknown as object,
        classroomInfo: input.classroomInfo ? (input.classroomInfo as unknown as object) : undefined,
        activities: (generated.activities || []) as unknown as object,
        materials: (generated.materials || []) as unknown as object,
        emergencyInfo: input.emergencyInfo ? (input.emergencyInfo as unknown as object) : undefined,
        studentNotes: input.studentNotes ? (input.studentNotes as unknown as object) : undefined,
        backupActivities: (generated.backupActivities || []) as unknown as object,
        lessonIds: input.lessonIds || [],
        tokensUsed: generated.tokensUsed,
        modelUsed: config.gemini.models.flash,
      },
    });

    logger.info('Substitute plan created', {
      teacherId,
      subPlanId: subPlan.id,
      lessonCount: input.lessonIds?.length || 0,
    });

    return subPlan;
  },

  /**
   * Get substitute plan by ID
   */
  async getSubPlan(
    subPlanId: string,
    teacherId: string
  ): Promise<SubstitutePlan | null> {
    return prisma.substitutePlan.findFirst({
      where: { id: subPlanId, teacherId },
    });
  },

  /**
   * List substitute plans for a teacher
   */
  async listSubPlans(
    teacherId: string,
    options: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<{ subPlans: SubstitutePlan[]; total: number }> {
    const { limit = 20, offset = 0, startDate, endDate } = options;

    const where: {
      teacherId: string;
      date?: { gte?: Date; lte?: Date };
    } = { teacherId };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    const [subPlans, total] = await Promise.all([
      prisma.substitutePlan.findMany({
        where,
        orderBy: { date: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.substitutePlan.count({ where }),
    ]);

    return { subPlans, total };
  },

  /**
   * Update a substitute plan
   */
  async updateSubPlan(
    subPlanId: string,
    teacherId: string,
    input: UpdateSubPlanInput
  ): Promise<SubstitutePlan> {
    const existing = await prisma.substitutePlan.findFirst({
      where: { id: subPlanId, teacherId },
    });

    if (!existing) {
      throw new Error('Substitute plan not found');
    }

    // Build update data, handling JSON fields properly
    const updateData: Record<string, unknown> = {};
    if (input.title !== undefined) updateData.title = input.title;
    if (input.date !== undefined) updateData.date = new Date(input.date);
    if (input.gradeLevel !== undefined) updateData.gradeLevel = input.gradeLevel;
    if (input.schedule !== undefined) updateData.schedule = input.schedule as object;
    if (input.classroomInfo !== undefined) updateData.classroomInfo = input.classroomInfo as object | null;
    if (input.activities !== undefined) updateData.activities = input.activities as object;
    if (input.materials !== undefined) updateData.materials = input.materials as object | null;
    if (input.emergencyInfo !== undefined) updateData.emergencyInfo = input.emergencyInfo as object | null;
    if (input.studentNotes !== undefined) updateData.studentNotes = input.studentNotes as object | null;
    if (input.backupActivities !== undefined) updateData.backupActivities = input.backupActivities as object | null;

    return prisma.substitutePlan.update({
      where: { id: subPlanId },
      data: updateData,
    });
  },

  /**
   * Delete a substitute plan
   */
  async deleteSubPlan(
    subPlanId: string,
    teacherId: string
  ): Promise<void> {
    const existing = await prisma.substitutePlan.findFirst({
      where: { id: subPlanId, teacherId },
    });

    if (!existing) {
      throw new Error('Substitute plan not found');
    }

    await prisma.substitutePlan.delete({
      where: { id: subPlanId },
    });

    logger.info('Substitute plan deleted', { teacherId, subPlanId });
  },

  /**
   * Duplicate a substitute plan for a new date
   */
  async duplicateSubPlan(
    subPlanId: string,
    teacherId: string,
    newDate: Date
  ): Promise<SubstitutePlan> {
    const existing = await prisma.substitutePlan.findFirst({
      where: { id: subPlanId, teacherId },
    });

    if (!existing) {
      throw new Error('Substitute plan not found');
    }

    const dateStr = new Date(newDate).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    return prisma.substitutePlan.create({
      data: {
        teacherId,
        title: `Sub Plan - ${dateStr}`,
        date: new Date(newDate),
        gradeLevel: existing.gradeLevel,
        schedule: existing.schedule ?? {},
        classroomInfo: existing.classroomInfo ?? undefined,
        activities: existing.activities ?? {},
        materials: existing.materials ?? undefined,
        emergencyInfo: existing.emergencyInfo ?? undefined,
        studentNotes: existing.studentNotes ?? undefined,
        backupActivities: existing.backupActivities ?? undefined,
        lessonIds: existing.lessonIds,
        tokensUsed: 0, // No new tokens used for duplicate
        modelUsed: existing.modelUsed,
      },
    });
  },

  /**
   * Regenerate activities for an existing sub plan
   */
  async regenerateActivities(
    subPlanId: string,
    teacherId: string
  ): Promise<SubstitutePlan> {
    const existing = await prisma.substitutePlan.findFirst({
      where: { id: subPlanId, teacherId },
    });

    if (!existing) {
      throw new Error('Substitute plan not found');
    }

    // Cast the schedule from JSON
    const existingSchedule = existing.schedule as unknown as ScheduleBlock[];

    // Regenerate the plan content
    const generated = await this.generateSubPlan(teacherId, {
      lessonIds: existing.lessonIds,
      date: existing.date,
      title: existing.title,
      gradeLevel: existing.gradeLevel || undefined,
      schedule: existingSchedule.map(s => ({
        startTime: s.startTime,
        endTime: s.endTime,
        activity: s.activity,
      })),
      classroomInfo: existing.classroomInfo as Partial<ClassroomInfo> | undefined,
      includeBackupActivities: true,
    });

    // Update with new content
    return prisma.substitutePlan.update({
      where: { id: subPlanId },
      data: {
        activities: generated.activities as unknown as object,
        materials: generated.materials as unknown as object,
        backupActivities: generated.backupActivities as unknown as object,
        tokensUsed: existing.tokensUsed + generated.tokensUsed,
      },
    });
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractJSON(text: string): string {
  // Try to parse as-is first
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Continue to extraction logic
  }

  // Try to extract JSON from markdown code blocks
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

  // Try to find JSON object
  const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    return jsonObjectMatch[0];
  }

  return text;
}

interface SubPlanPromptParams {
  lessons: Array<{
    id: string;
    title: string;
    subject: string;
    gradeLevel: string;
    summary: string;
    objectives: string[];
    sections: string[];
    hasActivities: boolean;
  }>;
  schedule?: Array<{
    startTime: string;
    endTime: string;
    activity: string;
  }>;
  gradeLevel?: string;
  subject?: string;
  timePeriod?: 'morning' | 'afternoon' | 'full_day';
  classroomInfo?: Partial<ClassroomInfo>;
  classroomNotes?: string;
  emergencyProcedures?: string;
  helpfulStudents?: string;
  includeBackupActivities: boolean;
  additionalNotes?: string;
  uploadedContent?: UploadedContent;
}

function buildSubPlanPrompt(params: SubPlanPromptParams): string {
  const {
    lessons,
    schedule,
    gradeLevel,
    subject,
    timePeriod,
    classroomInfo,
    classroomNotes,
    emergencyProcedures,
    helpfulStudents,
    includeBackupActivities,
    additionalNotes,
    uploadedContent
  } = params;

  // Build uploaded content section if provided
  let uploadedContentText = '';
  if (uploadedContent?.text) {
    // Truncate to first 60000 characters (~15k tokens) - Gemini Flash handles up to 1M input tokens
    const truncatedText = uploadedContent.text.length > 60000
      ? uploadedContent.text.substring(0, 60000) + '\n...[content truncated]'
      : uploadedContent.text;

    uploadedContentText = `
UPLOADED LESSON MATERIAL (${uploadedContent.sourceType?.toUpperCase() || 'FILE'}):
${uploadedContent.title ? `Title: ${uploadedContent.title}` : ''}
${uploadedContent.summary ? `Summary: ${uploadedContent.summary}` : ''}

CONTENT:
${truncatedText}

Use this uploaded content to create specific, detailed activities that match the lesson material.
---
`;
  }

  // Build lesson details if provided
  const lessonDetails = lessons.length > 0
    ? lessons.map(lesson => `
LESSON: ${lesson.title}
Subject: ${lesson.subject}
Grade: ${lesson.gradeLevel}
Summary: ${lesson.summary}
${lesson.objectives.length > 0 ? `Objectives: ${lesson.objectives.join(', ')}` : ''}
${lesson.sections.length > 0 ? `Sections: ${lesson.sections.join(', ')}` : ''}
`).join('\n---\n')
    : uploadedContent?.text
      ? '' // We have uploaded content, don't show the fallback message
      : 'No specific lessons provided - create age-appropriate activities for the subject and grade level.';

  // Build schedule text if provided, or instruct AI to generate
  const scheduleText = schedule && schedule.length > 0
    ? schedule.map(s => `${s.startTime} - ${s.endTime}: ${s.activity}`).join('\n')
    : `No schedule provided - generate an appropriate ${timePeriod || 'full_day'} schedule for ${gradeLevel || 'elementary'} students.`;

  // Build classroom info text
  let classroomText = '';
  if (classroomInfo || classroomNotes) {
    classroomText = 'CLASSROOM INFO:\n';
    if (classroomInfo?.attentionSignal) classroomText += `- Attention Signal: ${classroomInfo.attentionSignal}\n`;
    if (classroomInfo?.bathroomPolicy) classroomText += `- Bathroom Policy: ${classroomInfo.bathroomPolicy}\n`;
    if (classroomInfo?.transitionProcedures) classroomText += `- Transitions: ${classroomInfo.transitionProcedures}\n`;
    if (classroomInfo?.lineUpProcedure) classroomText += `- Line Up: ${classroomInfo.lineUpProcedure}\n`;
    if (classroomNotes) classroomText += `- Additional Notes: ${classroomNotes}\n`;
  }

  // Build emergency info text
  let emergencyText = '';
  if (emergencyProcedures) {
    emergencyText = `EMERGENCY PROCEDURES:\n${emergencyProcedures}\n`;
  }

  // Build helpful students text
  let helpfulText = '';
  if (helpfulStudents) {
    helpfulText = `HELPFUL STUDENTS:\n${helpfulStudents}\n`;
  }

  const effectiveGrade = gradeLevel || lessons[0]?.gradeLevel || 'Elementary';
  const effectiveSubject = subject || lessons[0]?.subject || 'General';

  return `You are an expert at creating comprehensive substitute teacher plans. Your goal is to create a plan so detailed and clear that ANY substitute teacher can successfully run the classroom.

GRADE LEVEL: ${effectiveGrade}
SUBJECT: ${effectiveSubject}
TIME PERIOD: ${timePeriod || 'full_day'}

${uploadedContentText}${lessons.length > 0 ? `LESSONS TO BASE THE PLAN ON:\n${lessonDetails}` : lessonDetails}

SCHEDULE FRAMEWORK:
${scheduleText}

${classroomText}
${emergencyText}
${helpfulText}

${additionalNotes ? `ADDITIONAL NOTES FROM TEACHER:\n${additionalNotes}\n` : ''}

Create a COMPREHENSIVE substitute teacher plan with:

1. **SCHEDULE** - Enhanced version of the schedule with more detail for each block
2. **ACTIVITIES** - Detailed step-by-step instructions for each activity that a substitute can follow
3. **MATERIALS** - Complete list of materials with locations and alternatives
${includeBackupActivities ? '4. **BACKUP ACTIVITIES** - Low-tech alternatives if technology fails' : ''}

IMPORTANT GUIDELINES:
- Write instructions as if the substitute has NEVER been in this classroom before
- Include specific times for each step within activities
- Provide word-for-word scripts for important instructions
- Anticipate questions students might ask and provide answers
- Include classroom management tips specific to each activity
- Be specific about where materials are located
- Include what "finished early" students should do

Return JSON with this structure:
{
  "title": "Engaging title for the sub plan",
  "schedule": [
    {
      "startTime": "8:00 AM",
      "endTime": "8:30 AM",
      "activity": "Morning Meeting",
      "description": "Brief overview for the sub"
    }
  ],
  "activities": [
    {
      "name": "Activity Name",
      "duration": 30,
      "objectives": ["What students should learn/do"],
      "materials": ["Item 1", "Item 2"],
      "stepByStep": [
        "8:00 - Greet students at the door as they enter",
        "8:02 - Say: 'Good morning everyone! My name is [Sub Name] and I'll be your teacher today.'",
        "8:05 - Take attendance using the roster on the desk",
        "..."
      ],
      "assessmentTips": "How to know if students understand",
      "commonIssues": ["Issue 1 and how to handle it"],
      "differentiationNotes": "Notes for students who need extra support or challenge"
    }
  ],
  "materials": [
    {
      "item": "Math workbooks",
      "location": "Blue bin on back shelf",
      "quantity": "Class set of 25",
      "alternatives": ["Printed worksheets in substitute folder"]
    }
  ],
  "backupActivities": [
    {
      "name": "Silent Reading",
      "duration": 20,
      "materials": ["Classroom library books"],
      "instructions": ["Step 1...", "Step 2..."],
      "whenToUse": "If technology is not working or you need a calm-down activity"
    }
  ]
}

Make the instructions extremely detailed and practical. The sub should feel confident they can handle anything that comes up.`;
}

export default subPlanService;
