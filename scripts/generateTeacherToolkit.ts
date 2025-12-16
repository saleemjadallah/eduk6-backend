/**
 * Generate AI Teaching Toolkit Lead Magnet for Teachers
 * Creates a professional PDF with AI-powered teaching strategies
 */

import * as dotenv from 'dotenv';
dotenv.config();

const PRESENTON_API_URL = 'https://api.presenton.ai/api/v1/ppt/presentation/generate';
const PRESENTON_API_KEY = process.env.PRESENTON_API_KEY;

interface PresentonRequest {
  content: string;
  instructions?: string;
  tone: 'default' | 'casual' | 'professional' | 'funny' | 'educational' | 'sales_pitch';
  verbosity: 'concise' | 'standard' | 'text-heavy';
  web_search: boolean;
  image_type: 'stock' | 'ai-generated';
  theme?: string;
  n_slides: number;
  language: string;
  template: string;
  include_table_of_contents: boolean;
  include_title_slide: boolean;
  export_as: 'pptx' | 'pdf';
}

interface PresentonResponse {
  presentation_id: string;
  path: string;
  edit_path: string;
  credits_consumed: number;
}

// Comprehensive AI Teaching Toolkit content
const TEACHER_TOOLKIT_CONTENT = `
# The AI Teaching Toolkit: Save Hours on Lesson Prep

## Introduction: Welcome to AI-Powered Teaching

The education landscape is evolving, and AI tools are here to amplify your teaching—not replace it. This toolkit will help you:
- Save 5-10 hours per week on lesson preparation
- Create engaging, differentiated content in minutes
- Generate assessments that actually measure understanding
- Provide personalized feedback at scale
- Focus more time on what matters: inspiring students

**Important**: AI is your assistant, not your replacement. Your expertise, intuition, and relationship with students remain irreplaceable.

---

## Chapter 1: AI Prompt Engineering for Teachers

### The CLEAR Framework for Effective Prompts

**C - Context**: Set the scene
- Grade level and subject
- Student background/abilities
- Prior knowledge assumed

**L - Learning Objective**: State your goal
- What should students know/do after?
- Bloom's taxonomy level
- Standards alignment

**E - Examples**: Show what you want
- Provide sample formats
- Include tone/style preferences
- Share existing materials as reference

**A - Audience**: Describe your students
- Age-appropriate language
- Cultural considerations
- Special needs accommodations

**R - Requirements**: Specify constraints
- Length/duration
- Format requirements
- Vocabulary limits

### Prompt Templates Library

**Lesson Plan Generator**
"Create a [duration] lesson plan for [grade level] [subject] on [topic]. Include:
- Learning objectives aligned to [standard]
- Warm-up activity (5 min)
- Direct instruction with examples
- Guided practice activity
- Independent practice
- Assessment/exit ticket
- Differentiation for [struggling/advanced] learners
Students have already learned [prior knowledge]."

**Quiz Generator**
"Generate a [number]-question quiz on [topic] for [grade level] students. Include:
- [X] multiple choice questions
- [X] short answer questions
- [X] application/scenario questions
Mix difficulty: 40% recall, 40% understanding, 20% application.
Provide answer key with explanations."

**Rubric Creator**
"Create a [points]-point rubric for [assignment type] assessing:
- [Criteria 1]
- [Criteria 2]
- [Criteria 3]
Include descriptors for each level (Exceeds/Meets/Approaching/Beginning).
Make language student-friendly for [grade level]."

**Differentiation Assistant**
"Adapt this [lesson/text/activity] for:
- Students reading 2 grades below level
- English Language Learners (intermediate proficiency)
- Advanced learners who need extension
- Students with [specific accommodation]
Maintain the same learning objective."

**Parent Communication**
"Write a [positive/concern] email to parents about [situation].
Tone: Professional but warm
Include: Specific observations, next steps, invitation for partnership
Grade level context: [grade]"

---

## Chapter 2: Lesson Planning with AI

### The 15-Minute Lesson Plan Method

**Step 1: Brain Dump (2 min)**
Tell AI everything about what you want to teach:
- Topic and subtopics
- Common misconceptions
- Real-world connections
- Activities you've done before that worked

**Step 2: Generate Draft (3 min)**
Use your prompt to generate initial plan

**Step 3: Customize (5 min)**
- Adjust timing for your class
- Add your favorite activities
- Include inside jokes/class themes
- Modify for specific students

**Step 4: Create Materials (5 min)**
- Generate worksheet/slides
- Create exit ticket
- Prepare differentiated versions

### Sample Workflow: 5th Grade Fractions

**Input Prompt:**
"Create an engaging 45-minute lesson on adding fractions with unlike denominators for 5th graders. They understand equivalent fractions but struggle with finding common denominators. Include a real-world pizza party scenario. I want hands-on manipulatives and partner work. End with a 3-question exit ticket."

**What AI Generates:**
- Detailed lesson plan with timing
- Pizza party word problems
- Partner activity instructions
- Exit ticket with answer key
- Extension problems for fast finishers

**Your 5-Minute Customization:**
- Swap pizza for tacos (class favorite)
- Add specific student pairs
- Include your fraction tiles location
- Adjust timing based on your block schedule

---

## Chapter 3: Assessment & Feedback at Scale

### Generating Quality Assessments

**Formative Assessment Ideas**
Ask AI for:
- "5 quick check-in questions I can ask verbally"
- "A 3-2-1 exit ticket template for [topic]"
- "Think-pair-share prompts for [concept]"
- "5 common misconceptions to look for"

**Summative Assessment Creation**
- Generate question banks (50+ questions)
- Request varied question types
- Ask for questions at different DOK levels
- Get distractor analysis for multiple choice

### AI-Assisted Grading Strategies

**For Written Responses:**
1. Create a detailed rubric first
2. Grade 5 samples yourself to calibrate
3. Use AI to identify patterns/common errors
4. Let AI draft feedback, you personalize

**For Math/Science:**
1. Generate step-by-step solutions
2. Identify where errors typically occur
3. Create error analysis categories
4. Generate targeted practice for common mistakes

**Feedback Templates**
Ask AI to create feedback banks:
- "10 ways to praise specific math problem-solving"
- "Constructive feedback for underdeveloped paragraphs"
- "Encouraging comments for struggling readers"
- "Extension suggestions for advanced work"

### The Feedback Formula

**For every piece of feedback, include:**
1. Specific praise (what they did well)
2. One growth area (concrete, actionable)
3. Next step (what to try next time)

**AI Prompt:**
"Generate feedback for a [grade] student's [assignment type] that scored [level]. The strength was [X]. The growth area is [Y]. Make it encouraging and specific."

---

## Chapter 4: Creating Engaging Content

### Generating Explanations Students Actually Understand

**The Analogy Generator**
"Explain [complex concept] to [grade level] students using an analogy involving [student interest: video games/sports/social media/cooking]"

**The Story Method**
"Turn [concept] into a short story with characters that [grade level] students would relate to. Include the key vocabulary: [terms]"

**The Visual Description**
"Describe step-by-step how to visualize [concept]. What should students draw/imagine at each stage?"

### Differentiated Materials in Minutes

**Reading Levels**
"Rewrite this passage at a [Lexile/grade] reading level while maintaining all key information."

**Scaffolded Notes**
"Create three versions of notes on [topic]:
1. Full notes (struggling learners)
2. Partial notes with blanks (grade level)
3. Outline only (advanced learners)"

**Multiple Representations**
"Explain [concept] in 5 different ways:
1. Visual/diagram
2. Real-world example
3. Step-by-step procedure
4. Analogy
5. Student-friendly definition"

### Interactive Activities

**Discussion Generators**
- Socratic seminar questions
- Debate prompts (argue both sides)
- Would you rather (content-based)
- Two truths and a lie (with content)

**Game Creation**
"Create a [Jeopardy/Kahoot/review game] on [topic] with [number] questions. Include categories: [list]. Mix difficulty levels."

---

## Chapter 5: Time-Saving Workflows

### The Sunday Planning Session (1 Hour)

**First 20 Minutes: Week Overview**
- List topics for each day
- Identify assessment points
- Note any special accommodations needed

**Next 30 Minutes: Batch Generation**
Generate all week's materials at once:
- Monday-Friday warm-ups
- Exit tickets for each day
- One differentiated activity
- Parent newsletter blurb

**Final 10 Minutes: Customize & Save**
- Personal touches
- Save to organized folders
- Print what's needed

### Daily Time-Savers

**Morning (5 min):**
- Generate discussion question of the day
- Create quick warm-up problem

**Prep Period (15 min):**
- Adjust tomorrow's lesson based on today
- Generate targeted practice for struggling students
- Create extension for early finishers

**End of Day (5 min):**
- Quick reflection prompt for tomorrow
- Generate parent communication if needed

### Organization System

**Folder Structure:**
- /Subject/Unit/Lesson Plans
- /Subject/Unit/Assessments
- /Subject/Unit/Differentiated Materials
- /Subject/Unit/AI Prompts That Worked

**Prompt Library:**
Save your best prompts! Create a document with:
- Prompt text
- What it generates
- How you customized it
- When to use it

---

## Chapter 6: Differentiation & Inclusion

### Supporting Diverse Learners

**English Language Learners**
- "Simplify vocabulary while maintaining rigor"
- "Add visual supports for key terms"
- "Create sentence frames for responses"
- "Generate bilingual vocabulary list"

**Students with IEPs**
- "Break this into smaller chunks"
- "Add more white space and structure"
- "Create check-in points throughout"
- "Generate extended time version"

**Gifted & Advanced**
- "Add complexity without just more work"
- "Create open-ended extension"
- "Generate research rabbit holes"
- "Design choice board options"

### Universal Design Prompts

"Make this lesson more accessible by:
- Adding multiple means of representation
- Providing multiple means of engagement
- Offering multiple means of expression
Maintain [grade level] rigor throughout."

---

## Chapter 7: Classroom Integration

### Introducing AI to Students

**Age-Appropriate Discussions**
- Elementary: "AI is like a very smart helper that learns from examples"
- Middle: "AI finds patterns in lots of information to help with tasks"
- High: Discuss capabilities, limitations, and ethics

**Teaching AI Literacy**
- How to prompt effectively
- Verifying AI information
- Understanding AI limitations
- Ethical use and plagiarism

### Student Use Guidelines

**When Students CAN Use AI:**
- Brainstorming ideas
- Getting explanations in different ways
- Checking their understanding
- Generating practice problems

**When Students CANNOT Use AI:**
- Final submissions without disclosure
- Assessments (unless specified)
- Copying without understanding
- Replacing their own thinking

### The Human Element

Remember: AI assists, YOU teach.

**Things AI Cannot Do:**
- Know your students personally
- Read the room
- Provide emotional support
- Make judgment calls
- Build relationships
- Inspire passion
- Model perseverance

**Your Superpowers:**
- Knowing when a student is struggling
- Adjusting on the fly
- Celebrating growth
- Creating community
- Igniting curiosity
- Being the reason a student loves learning

---

## Quick Reference: Prompt Cheat Sheet

### Lesson Planning
"Create a [time] lesson on [topic] for [grade]. Include [components]. Assume students know [prior knowledge]."

### Assessment
"Generate [number] questions on [topic] at [difficulty]. Include [types]. Provide answer key."

### Differentiation
"Adapt [material] for [learner type]. Maintain [objective]. Modify [specific element]."

### Feedback
"Write feedback for [work type] that [performed at level]. Praise [strength]. Address [growth area]."

### Communication
"Draft [communication type] about [topic] for [audience]. Tone: [description]."

### Engagement
"Create [activity type] for [topic] that involves [element]. Time: [duration]."

---

## Conclusion: Your AI Teaching Journey

**Start Small:**
1. Pick ONE task to try with AI this week
2. Save prompts that work
3. Share successes with colleagues
4. Iterate and improve

**Build Your Toolkit:**
- Collect your best prompts
- Note what works for your students
- Create templates for repeated tasks
- Build a personal prompt library

**Stay Human:**
AI handles the routine so you can focus on the remarkable—the moments of connection, inspiration, and breakthrough that only a teacher can create.

---

**About Orbit Learn**
Orbit Learn's AI-powered platform helps teachers create lessons, quizzes, flashcards, and assessments in minutes. Our tools are designed by educators, for educators.

Start your free account at orbitlearn.app/teacher
`;

async function generateTeacherToolkit() {
  if (!PRESENTON_API_KEY) {
    console.error('PRESENTON_API_KEY is not set');
    process.exit(1);
  }

  console.log('🎓 Generating AI Teaching Toolkit for Teachers...\n');

  const requestBody: PresentonRequest = {
    content: TEACHER_TOOLKIT_CONTENT,
    instructions: `Create a professional, visually engaging teaching resource guide.
    Design considerations:
    - Clean, modern design appropriate for professional educators
    - Use warm, inviting colors (think: productive classroom)
    - Include relevant stock images of teachers, classrooms, technology
    - Clear section headers and easy-to-scan layouts
    - Code/prompt examples should be clearly formatted
    - Include visual hierarchy for quick reference
    - Make it feel like a premium professional development resource
    - Add icons for different sections
    - Include callout boxes for key tips`,
    tone: 'professional',
    verbosity: 'standard',
    web_search: false,
    image_type: 'stock',
    theme: 'professional-dark',
    n_slides: 30,
    language: 'English',
    template: 'general',
    include_table_of_contents: true,
    include_title_slide: true,
    export_as: 'pdf',
  };

  console.log('📤 Sending request to Presenton API...');
  console.log(`   Slides: ${requestBody.n_slides}`);
  console.log(`   Format: ${requestBody.export_as}`);
  console.log(`   Theme: ${requestBody.theme}\n`);

  try {
    const response = await fetch(PRESENTON_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PRESENTON_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error: ${response.status}`);
      console.error(errorText);
      process.exit(1);
    }

    const result = await response.json() as PresentonResponse;
    console.log('✅ Presentation generated successfully!\n');
    console.log(`   Presentation ID: ${result.presentation_id}`);
    console.log(`   Credits Used: ${result.credits_consumed}`);
    console.log(`\n📥 Download URL: ${result.path}`);
    console.log(`📝 Edit URL: ${result.edit_path}`);

    // Download the PDF
    console.log('\n📥 Downloading PDF...');
    const fileResponse = await fetch(result.path);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download: ${fileResponse.status}`);
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    const fs = await import('fs');
    const path = await import('path');

    const outputDir = path.join(process.cwd(), 'public', 'downloads');

    // Create directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'Orbit-Learn-AI-Teaching-Toolkit.pdf');
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

    console.log(`\n✅ PDF saved to: ${outputPath}`);
    console.log('\n🎉 Done! Now run uploadTeacherToolkit.ts to upload to CDN.');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
generateTeacherToolkit();
