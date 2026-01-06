/**
 * Script to generate blog post images using Gemini AI
 * Run with: npx tsx scripts/generateBlogImages.ts
 */

import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not found in environment');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Output directory for generated images
const OUTPUT_DIR = path.join(__dirname, '../../frontend/public/images/blog');

// Blog post image prompts with alt text references
const BLOG_IMAGE_PROMPTS = [
  {
    name: 'summer-learning-loss',
    altText: 'Child reading book outdoors in summer sunshine while enjoying vacation',
    prompt: `Create a warm, inviting illustration of a child enjoying reading outdoors during summer vacation.

SCENE COMPOSITION: A child (around 8-10 years old) sits comfortably under a tree in a sunny backyard or park, completely absorbed in reading a colorful book. Dappled sunlight filters through the leaves, creating beautiful light patterns. The scene radiates relaxation and the joy of summer reading.

THE CHILD: The child looks genuinely happy and engaged with their book - not bored or forced. They might be lying on their stomach on a blanket, or sitting with their back against the tree trunk. Their posture is relaxed but attentive. Any ethnicity, dressed in casual summer clothes (t-shirt, shorts).

SUMMER ATMOSPHERE: Lush green grass, blue sky visible through tree branches, perhaps a butterfly or bird nearby. A picnic blanket or beach towel beneath them. Maybe a glass of lemonade or water bottle nearby. The warmth of summer should be palpable.

LIGHTING: Warm, golden summer sunlight creates a dreamy, nostalgic atmosphere. Soft shadows and beautiful light-through-leaves effects. The overall feeling is peaceful, warm, and inviting.

COLOR PALETTE: Warm greens, golden yellows, sky blues, and soft earth tones. The colors should feel like summer - bright but not harsh, warm and inviting.

STYLE: Warm, illustrated children's book style with soft edges and inviting colors. Professional quality suitable for a blog header image. The mood should convey that learning can happen naturally during summer fun.`,
  },
  {
    name: 'neurodiverse-learners',
    altText: 'Young child smiling while learning on tablet, representing personalized learning for neurodiverse children',
    prompt: `Create an uplifting illustration of a child experiencing the joy of personalized learning on a tablet device.

SCENE COMPOSITION: A child (around 7-9 years old) sits comfortably, holding a tablet that displays colorful, engaging educational content. Their face is lit up with genuine delight and the satisfaction of understanding - that "aha!" moment when learning clicks. The scene emphasizes that learning can be joyful when it's tailored to how each child thinks.

THE CHILD: The child's expression shows pure joy and confidence - a wide smile, bright eyes, perhaps a slight bounce of excitement. Their body language suggests comfort and engagement, not stress. They should appear relaxed and happy. Could be any ethnicity. Perhaps they have headphones on (suggesting audio learning options) or are using a stylus (suggesting interactive learning).

THE TABLET: The screen shows colorful, visually engaging content - not text, but shapes, colors, interactive elements that suggest personalized, adaptive learning. Perhaps progress indicators showing success, or colorful educational games.

ENVIRONMENT: A comfortable learning space - could be a cozy corner with cushions, a bedroom desk with warm lighting, or a quiet spot with sensory-friendly elements (soft textures, calming colors). The space feels safe and accommodating.

LIGHTING: Soft, warm lighting that creates a comfortable atmosphere. The tablet provides a gentle glow on the child's happy face. No harsh fluorescent lighting - this is learning on their terms.

VISUAL METAPHOR: Subtle elements could suggest the "different paths" idea - perhaps gentle swirling lines or pathways of light around the tablet, suggesting information flowing in ways that work for this child.

STYLE: Warm, inclusive illustration style with soft colors and gentle shapes. The image should feel reassuring to parents of neurodiverse children - showing that their child can experience learning joy too.`,
  },
  {
    name: 'teacher-time-crisis',
    altText: 'Exhausted teacher working late at night on lesson plans with coffee and papers scattered on desk',
    prompt: `Create an evocative illustration capturing the reality of teacher burnout - a dedicated educator working late into the night on lesson planning.

SCENE COMPOSITION: A teacher (late 20s to 40s, any gender/ethnicity) sits at a desk late at night, surrounded by the evidence of endless work. The scene should evoke empathy and recognition - this is the reality many teachers face. The mood is tired but determined.

THE TEACHER: They look exhausted but persevering - perhaps rubbing their eyes, or resting their chin on their hand while staring at a laptop screen. Their posture shows fatigue. They're still in work clothes but perhaps loosened a tie or kicked off shoes. Reading glasses might be pushed up on their forehead.

THE WORKSPACE: A home desk or kitchen table covered with the tools of lesson planning:
- A laptop glowing in the dim room (the main light source)
- A coffee mug (cold, perhaps with a visible ring)
- Stacks of papers and worksheets
- Open textbooks and curriculum guides
- Sticky notes and highlighters
- Perhaps a tablet showing more work
- A clock on the wall showing late hour (10:47 PM reference from the blog)

LIGHTING: The laptop screen provides the primary light, creating dramatic shadows. Perhaps a small desk lamp adds warm light. The rest of the room is dark, emphasizing the late hour. The contrast between the glowing screen and the darkness creates an intimate, slightly melancholy atmosphere.

ATMOSPHERE: The scene should feel relatable to teachers - capturing the dedication and sacrifice without being depressing. There's dignity in the hard work, even as it's clearly unsustainable.

BACKGROUND: A home environment - perhaps family photos visible in the shadows (representing what they're missing), a window showing darkness outside, maybe a pet sleeping nearby. Signs of life interrupted by work.

STYLE: Warm but somewhat moody illustration style, like editorial illustration for a magazine feature about education. The colors should be muted - warm oranges and yellows from the light sources against cool blue-grays of night. Professional quality suitable for a blog about teacher burnout.`,
  },
  {
    name: 'reluctant-learner',
    altText: 'Parent and child working together on learning activity with encouraging expressions',
    prompt: `Create a heartwarming illustration of a parent and child sharing a positive learning moment together, showing the transformation from struggle to connection.

SCENE COMPOSITION: A parent and child (around 8-10 years old) sit together at a table or on a couch, engaged in a learning activity. The key emotional note is connection and breakthrough - the parent is supportive (not frustrated), and the child shows signs of growing confidence rather than resistance.

THE RELATIONSHIP: The parent's body language is open and encouraging - leaning in with interest, perhaps a gentle hand on the child's shoulder or back. They're at the child's level, not towering over them. Their expression shows patience, warmth, and pride. The child is engaged, perhaps pointing at something, asking a question, or showing the beginning of a smile as understanding dawns.

THE ACTIVITY: They could be looking at a tablet together, working with learning materials, or engaged in a hands-on activity. The learning feels collaborative, not forced. Maybe they're using building blocks for math, or looking at something on screen that the child chose.

ENVIRONMENT: A warm, comfortable home setting - soft lighting, comfortable furniture. The space feels safe and relaxed. There are no visible worksheets or intimidating textbooks - the learning is integrated naturally.

EMOTIONAL TONE: This image should capture the moment when learning stops being a battle and becomes a shared journey. The child is beginning to open up. The parent is patient and present. Hope is visible.

LIGHTING: Warm, soft lighting that creates an intimate atmosphere. Perhaps evening light from a window, or warm lamp light. The lighting should feel like home.

COLOR PALETTE: Warm, nurturing colors - soft oranges, warm yellows, gentle greens. Nothing harsh or clinical. The overall palette should feel safe and encouraging.

STYLE: Warm, emotionally resonant illustration style similar to touching moments in animated films. The focus is on the emotional connection between parent and child. Professional quality that would resonate with parents who've experienced homework battles.`,
  },
  {
    name: 'educational-screen-time',
    altText: 'Child engaged in educational learning on tablet with parent nearby',
    prompt: `Create a reassuring illustration showing healthy, balanced educational screen time - a child engaged with a tablet while a parent is present and involved.

SCENE COMPOSITION: A child (around 6-9 years old) uses a tablet for learning while a parent is nearby, creating a scene of supervised, purposeful screen time. The mood is positive and guilt-free - this is screen time done right.

THE CHILD: Engaged and happy, interacting with educational content on the tablet. Their posture is good (not hunched), and they're in a well-lit space. They might be touching the screen, answering questions, or showing something to the parent with excitement.

THE PARENT: Present but not hovering. They might be on the same couch reading a book, doing something nearby while keeping an eye on their child, or actively engaged in what the child is showing them. Their expression is relaxed and approving - no guilt or worry visible.

THE SCREEN: The tablet shows colorful, engaging educational content - shapes, interactive elements, progress indicators. The content clearly looks educational and age-appropriate, not passive video watching.

ENVIRONMENT: A bright, well-lit living room or family space. Natural daylight comes through windows. The setting is clearly daytime (not a child alone with a screen at night). Perhaps there are books visible nearby, outdoor toys, other non-screen activities - suggesting balance.

BALANCE ELEMENTS: The scene should subtly communicate "screen time as part of a balanced life" - maybe a soccer ball in the corner, art supplies visible, or a window showing a sunny day they'll go out to enjoy later.

LIGHTING: Bright, natural daylight that makes the scene feel healthy and balanced. The tablet screen isn't the only light source - this is purposeful daytime learning, not mindless nighttime scrolling.

COLOR PALETTE: Fresh, bright colors - natural greens, sunny yellows, clear blues. The palette should feel healthy and balanced, like a breath of fresh air.

STYLE: Fresh, modern illustration style that feels reassuring to parents. The image should say "screen time can be good for kids when done thoughtfully." Professional quality suitable for a parenting blog.`,
  },
  {
    name: 'child-safety-ai-learning',
    altText: 'Parent and child using AI-powered educational app safely on tablet',
    prompt: `Create a reassuring illustration conveying safety and trust in AI-powered educational technology - a parent and child confidently using a learning app together.

SCENE COMPOSITION: A parent and child (around 6-8 years old) use a tablet together, with visual elements suggesting safety, security, and trust. The mood is confident and secure - parents can trust this technology with their children.

THE FAMILY MOMENT: The parent and child sit close together, both engaged with the tablet. The parent looks relaxed and confident, not worried. The child is happy and focused on learning. Their closeness suggests the parent is involved and aware of what their child is doing.

SAFETY VISUALIZATION: Subtle visual elements suggest protection and security:
- A soft, gentle glow or shield-like aura around the tablet
- Perhaps small, friendly icons suggesting safety (gentle lock symbol, shield, checkmark)
- The overall lighting feels protective and warm
- The tablet content looks clearly age-appropriate and educational

THE TABLET CONTENT: Colorful, engaging educational content with friendly characters or elements. Perhaps a friendly AI character (like a gentle robot or animal guide) is visible on screen, representing the AI tutor. The interface looks modern, clean, and trustworthy.

ENVIRONMENT: A bright, safe home environment - comfortable living room or study space. The space feels secure and family-oriented. Perhaps family photos in the background, comfortable furniture, warm lighting.

TRUST ELEMENTS: The parent's confident body language is key - they're not anxiously monitoring, but comfortably participating. This technology is a trusted part of their family's learning.

LIGHTING: Warm, embracing light that creates a sense of safety and comfort. The tablet might emit a soft, friendly glow. Overall lighting suggests protection and warmth.

COLOR PALETTE: Trustworthy colors - soft blues (trust), gentle greens (safety), warm golds (quality), white (cleanliness/purity). The palette should feel secure and professional.

STYLE: Clean, trustworthy illustration style that builds confidence with parents. The image should say "your child is safe here" while also showing engaging learning. Professional quality suitable for a blog about AI safety.`,
  },
  {
    name: 'early-childhood-learning',
    altText: 'Young child exploring and learning through play with natural curiosity',
    prompt: `Create a joyful, wonder-filled illustration of a young child (ages 4-6) discovering the magic of learning through natural play and curiosity.

SCENE COMPOSITION: A young child is fully absorbed in a moment of discovery and wonder - perhaps examining something closely, building something, or exploring with all their senses. The scene captures the natural learning that happens through play.

THE CHILD: A young child (4-6 years old) with an expression of pure wonder and curiosity - wide eyes, perhaps an open mouth of amazement, complete focus on what they're discovering. Their body language shows total engagement - maybe crouching down to look at something, reaching toward an object with fascination, or holding something up to examine it.

THE DISCOVERY: The child could be:
- Examining a flower or insect with fascination
- Building with colorful blocks and discovering patterns
- Playing with water and discovering how it moves
- Looking at a picture book with wonder
- Exploring natural materials (leaves, stones, shells)
The specific activity should show learning happening naturally, not through instruction.

ENVIRONMENT: A bright, stimulating but not overwhelming space - could be:
- A sunny garden or outdoor space
- A cozy playroom with soft natural light
- A kitchen where cooking becomes science
The space has interesting things to discover but isn't cluttered. It feels safe for exploration.

WONDER ELEMENTS: Subtle magical touches that represent the child's sense of wonder:
- Soft sparkles or light particles around their discovery
- Warm, glowing light on their face
- A sense that ordinary things are extraordinary through their eyes

LIGHTING: Soft, warm, golden light that creates a sense of magic and wonder. The lighting should feel like a perfect childhood memory - warm and safe and full of possibility.

COLOR PALETTE: Bright but soft colors - sunny yellows, sky blues, gentle greens, warm oranges. The palette should feel joyful, innocent, and full of possibility. Colors a young child would love.

STYLE: Warm, whimsical illustration style reminiscent of beloved children's picture books. Soft edges, expressive characters, magical atmosphere. The image should make adults smile and remember the wonder of childhood discovery. Professional quality suitable for a blog about early childhood learning.`,
  },
];

async function generateImage(prompt: string): Promise<Buffer | null> {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp-image-generation',
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
    });

    const enhancedPrompt = `${prompt}

UNIVERSAL REQUIREMENTS FOR THIS IMAGE:
- The image must be completely safe and appropriate for children of all ages
- Do NOT include any readable text, words, letters, or numbers in the image
- All characters should appear friendly, warm, and welcoming
- Include diverse representation where multiple people are shown
- The final image should be high-resolution and suitable for professional blog use
- Render with consistent lighting and color grading throughout the scene
- Aspect ratio should be landscape (16:9 or similar) suitable for blog headers`;

    console.log(`  Generating with prompt: "${prompt.substring(0, 60)}..."`);

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: enhancedPrompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['image', 'text'],
      },
    } as any);

    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts;

    if (!parts) {
      console.error('  No response parts');
      return null;
    }

    for (const part of parts) {
      if ((part as any).inlineData) {
        const inlineData = (part as any).inlineData;
        const buffer = Buffer.from(inlineData.data, 'base64');
        return buffer;
      }
    }

    console.error('  No image data in response');
    return null;
  } catch (error) {
    console.error('  Generation error:', error);
    return null;
  }
}

async function main() {
  console.log('Blog Post Image Generator\n');
  console.log(`Output directory: ${OUTPUT_DIR}\n`);

  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log('Created output directory\n');
  }

  const results: { name: string; altText: string; success: boolean; path?: string }[] = [];

  for (let i = 0; i < BLOG_IMAGE_PROMPTS.length; i++) {
    const { name, altText, prompt } = BLOG_IMAGE_PROMPTS[i];
    console.log(`[${i + 1}/${BLOG_IMAGE_PROMPTS.length}] Generating: ${name}`);
    console.log(`  Alt text: "${altText}"`);

    const imageBuffer = await generateImage(prompt);

    if (imageBuffer) {
      const outputPath = path.join(OUTPUT_DIR, `${name}.jpg`);
      fs.writeFileSync(outputPath, imageBuffer);
      console.log(`  Saved: ${outputPath}\n`);
      results.push({ name, altText, success: true, path: outputPath });
    } else {
      console.log(`  Failed to generate: ${name}\n`);
      results.push({ name, altText, success: false });
    }

    // Add delay between requests to avoid rate limiting
    if (i < BLOG_IMAGE_PROMPTS.length - 1) {
      console.log('  Waiting 5 seconds before next request...\n');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  // Summary
  console.log('\nGeneration Summary:');
  console.log('='.repeat(60));
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);

  if (successful > 0) {
    console.log('\nGenerated images:');
    results
      .filter((r) => r.success)
      .forEach((r) => {
        console.log(`  ${r.name}.jpg`);
        console.log(`    Alt: "${r.altText}"`);
      });
  }

  if (failed > 0) {
    console.log('\nFailed images:');
    results
      .filter((r) => !r.success)
      .forEach((r) => console.log(`  - ${r.name}`));
  }

  console.log('\nDone!');
}

main().catch(console.error);
