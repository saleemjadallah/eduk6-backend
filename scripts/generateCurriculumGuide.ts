/**
 * Generate Curriculum Guide Lead Magnet
 * Creates a professional PDF presentation for email capture
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

// Comprehensive curriculum guide content for parents
const CURRICULUM_GUIDE_CONTENT = `
# The Complete Parent's Guide to Understanding Your Child's Curriculum

## Introduction: Why This Guide Matters
As a parent, understanding your child's curriculum is essential for supporting their educational journey. This comprehensive guide will help you:
- Understand different curriculum types and their approaches
- Know what your child should be learning at each grade level
- Identify how to effectively support learning at home
- Recognize signs that your child may need additional help
- Make informed decisions about educational choices

---

## Chapter 1: Understanding Different Curriculum Types

### American Curriculum (Common Core)
- Focus: Critical thinking, problem-solving, real-world application
- Structure: K-12 system with standardized benchmarks
- Key Subjects: English Language Arts (ELA), Mathematics, Science, Social Studies
- Assessment: Standardized tests (state assessments), GPA-based grading
- Best For: Families seeking flexibility and college preparation in the US

### British Curriculum (National Curriculum UK)
- Focus: Broad subject exposure, deep content knowledge
- Structure: Key Stages (KS1-KS4), GCSE, A-Levels
- Key Subjects: English, Maths, Science, plus many electives
- Assessment: National tests (SATs), external examinations
- Best For: Families planning higher education in UK or Commonwealth

### IB (International Baccalaureate)
- Focus: International-mindedness, inquiry-based learning, holistic development
- Structure: PYP (3-12), MYP (11-16), DP (16-19)
- Key Subjects: 6 subject groups plus Theory of Knowledge, Extended Essay
- Assessment: Internal and external assessments, emphasis on projects
- Best For: Internationally mobile families, globally-minded education

### Indian Curriculum (CBSE/ICSE)
- CBSE: Centralized, competitive exam focus, NCERT textbooks
- ICSE: Broader curriculum, more analytical, English emphasis
- Focus: Strong academics, competitive examination preparation
- Best For: Families planning education/careers in India

---

## Chapter 2: Grade-by-Grade Learning Milestones

### Kindergarten to Grade 2 (Ages 5-8)
**Reading & Language:**
- Phonics awareness and letter recognition
- Reading simple sentences and short stories
- Writing simple sentences and short paragraphs
- Vocabulary building (sight words)

**Mathematics:**
- Counting to 100 and beyond
- Addition and subtraction within 20
- Understanding place value (ones, tens)
- Basic geometry (shapes, patterns)
- Introduction to measurement and time

**Social & Emotional Skills:**
- Following classroom routines
- Sharing and taking turns
- Expressing feelings appropriately
- Building friendships

### Grades 3-5 (Ages 8-11)
**Reading & Language:**
- Reading chapter books independently
- Understanding main ideas and themes
- Writing multi-paragraph essays
- Grammar, spelling, punctuation
- Research skills introduction

**Mathematics:**
- Multiplication and division mastery
- Fractions, decimals, percentages
- Multi-step word problems
- Data analysis (charts, graphs)
- Geometry (area, perimeter, volume)

**Science & Social Studies:**
- Scientific method introduction
- Earth science, life science, physical science
- Geography and map skills
- History and civics basics

### Grades 6-8 (Ages 11-14)
**Language Arts:**
- Analyzing literature and informational texts
- Argumentative and persuasive writing
- Research papers with citations
- Public speaking and presentations

**Mathematics:**
- Pre-algebra and algebra basics
- Ratios, proportions, percentages
- Statistics and probability
- Geometry (theorems, proofs introduction)

**Sciences:**
- Biology, chemistry, physics foundations
- Lab skills and scientific inquiry
- Earth and space science
- Environmental awareness

**Critical Skills:**
- Time management and organization
- Independent study habits
- Critical thinking and analysis
- Digital literacy

---

## Chapter 3: How to Support Learning at Home

### Create an Optimal Learning Environment
1. **Designated Study Space**: Quiet, well-lit area free from distractions
2. **Consistent Schedule**: Regular homework/study time daily
3. **Necessary Supplies**: Books, materials, technology readily available
4. **Minimize Distractions**: Limit screens, noise during study time

### Effective Homework Support Strategies
- **Guide, Don't Do**: Help them understand concepts, don't complete work for them
- **Break It Down**: Large assignments into smaller, manageable tasks
- **Check Understanding**: Ask them to explain concepts in their own words
- **Celebrate Effort**: Praise hard work, not just correct answers

### Reading at Home
- **Read Together**: Even older children benefit from shared reading
- **Discuss Books**: Ask open-ended questions about stories
- **Model Reading**: Let children see you reading for pleasure
- **Visit Libraries**: Make regular library trips a family habit

### Math Practice Tips
- **Real-World Math**: Cooking, shopping, budgeting, travel planning
- **Math Games**: Board games, card games, online math games
- **Daily Practice**: Short, consistent practice beats cramming
- **Growth Mindset**: "Math is learnable, not just innate talent"

### Science Exploration
- **Curiosity Encouraged**: Answer "why" questions, explore together
- **Kitchen Science**: Simple experiments with household items
- **Nature Walks**: Observe, collect, discuss natural phenomena
- **Documentaries**: Age-appropriate science content

---

## Chapter 4: Warning Signs - When Your Child Needs Extra Help

### Academic Warning Signs
- Consistent grades below grade-level expectations
- Avoiding homework or school work
- Taking much longer than peers to complete assignments
- Difficulty retaining information learned
- Trouble following multi-step instructions

### Reading Difficulties
- Struggles to decode words
- Reads very slowly or haltingly
- Avoids reading aloud
- Poor comprehension despite fluent reading
- Reverses letters or numbers frequently (beyond age 7)

### Math Difficulties
- Trouble with basic number sense
- Can't remember math facts despite practice
- Difficulty understanding word problems
- Confusion with mathematical symbols
- Struggles with concepts peers have mastered

### Social/Emotional Signs
- Frequent complaints about school
- Anxiety about tests or assignments
- Loss of interest in learning
- Behavioral changes
- Physical complaints (headaches, stomachaches) before school

### What To Do
1. Communicate with teachers first
2. Request academic assessment if concerns persist
3. Explore tutoring or learning support
4. Consider educational technology tools
5. Be patient and supportive - every child learns differently

---

## Chapter 5: Making the Right Curriculum Choice

### Factors to Consider
1. **Your Child's Learning Style**: Visual, auditory, kinesthetic, reading/writing
2. **Family Mobility**: Will you relocate? International curriculum may help
3. **Higher Education Goals**: Where do you see your child studying?
4. **Child's Interests**: STEM focus? Arts? Languages?
5. **School Options Available**: What's accessible in your area?

### Questions to Ask Schools
- What is your student-to-teacher ratio?
- How do you handle different learning styles?
- What assessment methods do you use?
- How do you communicate with parents?
- What extracurricular activities are offered?
- How do you support struggling students?
- What technology is integrated into learning?

### Transition Tips
- **Research Thoroughly**: Understand the new curriculum before switching
- **Timing Matters**: Beginning of school year is typically best
- **Prepare Your Child**: Discuss changes positively
- **Support the Transition**: Extra patience during adjustment period
- **Communicate**: Stay in touch with teachers about progress

---

## Chapter 6: Supplementing Your Child's Education

### When to Supplement
- Child shows exceptional interest in a subject
- Specific skills need strengthening
- During school breaks to prevent learning loss
- Preparing for standardized tests
- Exploring subjects not offered at school

### Effective Supplemental Resources
**Educational Technology:**
- Adaptive learning platforms (personalized to child's level)
- Educational apps and games
- Video lessons for visual learners
- Interactive quizzes and assessments

**Traditional Resources:**
- Workbooks aligned to curriculum standards
- Library books and audiobooks
- Educational magazines and periodicals
- Flash cards for fact memorization

**Experiential Learning:**
- Museums and science centers
- Educational camps and workshops
- Cultural events and travel
- Community service and real-world experiences

### Balancing Academics and Well-being
- **Avoid Over-scheduling**: Free play is essential for development
- **Follow Their Interests**: Passion drives deeper learning
- **Quality Over Quantity**: 20 focused minutes beats 2 distracted hours
- **Rest is Productive**: Sleep and downtime support learning

---

## Conclusion: Your Role as Your Child's First Teacher

Remember:
- Every child learns differently and at their own pace
- Your involvement significantly impacts their success
- Mistakes are learning opportunities, not failures
- Curiosity is more valuable than test scores
- Love of learning lasts a lifetime

### Next Steps
1. Review your child's current curriculum and identify any gaps
2. Set up a productive learning environment at home
3. Establish regular communication with teachers
4. Choose 1-2 areas to focus supplemental support
5. Celebrate progress, no matter how small

---

**About Orbit Learn**
Orbit Learn is an AI-powered educational platform designed to supplement your child's learning. Our adaptive lessons, interactive exercises, and personalized content help children ages 4-14 master subjects aligned to major curricula worldwide.

Visit orbitlearn.app to start your free trial today!
`;

async function generateCurriculumGuide() {
  if (!PRESENTON_API_KEY) {
    console.error('PRESENTON_API_KEY is not set');
    process.exit(1);
  }

  console.log('🎓 Generating Curriculum Guide for Parents...\n');

  const requestBody: PresentonRequest = {
    content: CURRICULUM_GUIDE_CONTENT,
    instructions: `Create a visually stunning, professional curriculum guide for parents.
    Use:
    - Clean, modern design with educational imagery
    - Clear section headers and bullet points
    - Parent-friendly language (no jargon)
    - Encouraging, supportive tone
    - Include relevant stock images of children learning, families, classrooms
    - Make it feel like a premium resource worth downloading
    - Add visual elements like icons, charts where appropriate`,
    tone: 'educational',
    verbosity: 'standard',
    web_search: false,
    image_type: 'stock',
    theme: 'professional-blue',
    n_slides: 25,
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

    const outputPath = path.join(outputDir, 'Orbit-Learn-Curriculum-Guide.pdf');
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

    console.log(`\n✅ PDF saved to: ${outputPath}`);
    console.log('\n🎉 Done! You can now use this guide for your exit-intent popup.');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
generateCurriculumGuide();
