// Email service using Resend
import { Resend } from 'resend';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

// Initialize Resend client
const resend = config.email.apiKey ? new Resend(config.email.apiKey) : null;

// Email templates
const templates = {
  /**
   * Welcome email for new parents
   */
  welcome: (parentName: string) => ({
    subject: 'Welcome to OrbitLearn! Your Learning Adventure Begins 🚀',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to OrbitLearn!</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f4f8;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header with Logo -->
    <tr>
      <td style="background: linear-gradient(135deg, #7C3AED 0%, #2DD4BF 100%); border-radius: 24px 24px 0 0; padding: 40px; text-align: center;">
        <img src="${config.frontendUrl}/assets/orbit-learn-logo.png" alt="OrbitLearn" style="width: 120px; height: 120px; border-radius: 20px; margin-bottom: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);">
        <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: 700;">Welcome to OrbitLearn!</h1>
        <p style="color: rgba(255,255,255,0.95); margin-top: 10px; font-size: 18px;">Where Learning is an Adventure!</p>
      </td>
    </tr>
    <tr>
      <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 24px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        <h2 style="color: #1e1b4b; margin-top: 0; font-size: 24px;">Hi ${parentName}! 👋</h2>

        <p style="color: #4b5563; line-height: 1.7; font-size: 16px;">
          Thank you for joining OrbitLearn! We're thrilled to have you and your family as part of our learning community.
        </p>

        <!-- Jeffrey Introduction Box -->
        <div style="background: linear-gradient(135deg, #EDE9FE 0%, #CCFBF1 100%); border-radius: 16px; padding: 24px; margin: 28px 0; text-align: center;">
          <img src="${config.frontendUrl}/assets/images/jeffrey-avatar.png" alt="Jeffrey" style="width: 80px; height: 80px; border-radius: 50%; border: 4px solid #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 16px;">
          <h3 style="color: #5B21B6; margin: 0 0 12px 0; font-size: 20px;">Meet Jeffrey, Your Child's AI Tutor!</h3>
          <p style="color: #4b5563; margin: 0; line-height: 1.6;">
            Jeffrey is a friendly, patient AI tutor who adapts to each child's learning style. With his lavender skin and warm smile, he makes education fun with interactive lessons and personalized encouragement from kindergarten through middle school!
          </p>
        </div>

        <h3 style="color: #1e1b4b; font-size: 18px;">Getting Started:</h3>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0;">
          <tr>
            <td style="padding: 12px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background: #7C3AED; color: white; width: 32px; height: 32px; border-radius: 50%; text-align: center; font-weight: bold; font-size: 16px; vertical-align: middle;">1</td>
                  <td style="padding-left: 16px; color: #4b5563; font-size: 15px;"><strong>Add your children</strong> - Set up profiles for each child</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background: #2DD4BF; color: white; width: 32px; height: 32px; border-radius: 50%; text-align: center; font-weight: bold; font-size: 16px; vertical-align: middle;">2</td>
                  <td style="padding-left: 16px; color: #4b5563; font-size: 15px;"><strong>Upload lesson content</strong> - PDFs, images, or YouTube videos</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background: #F59E0B; color: white; width: 32px; height: 32px; border-radius: 50%; text-align: center; font-weight: bold; font-size: 16px; vertical-align: middle;">3</td>
                  <td style="padding-left: 16px; color: #4b5563; font-size: 15px;"><strong>Watch them learn!</strong> - Jeffrey will guide them through interactive lessons</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <div style="text-align: center; margin: 36px 0;">
          <a href="${config.frontendUrl}/dashboard" style="background: linear-gradient(135deg, #7C3AED 0%, #2DD4BF 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 50px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4);">
            Start Learning Now 🚀
          </a>
        </div>

        <p style="color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb; padding-top: 24px; margin-bottom: 0; text-align: center;">
          Questions? Reply to this email - we're here to help!<br>
          <span style="color: #9ca3af;">- The OrbitLearn Team 💜</span>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
    text: `
Welcome to OrbitLearn!

Hi ${parentName}!

Thank you for joining OrbitLearn! We're thrilled to have you and your family as part of our learning community.

Meet Jeffrey, Your Child's AI Tutor!
Jeffrey is a friendly, patient AI tutor who adapts to each child's learning style. With his lavender skin and warm smile, he makes education fun with interactive lessons and personalized encouragement from kindergarten through middle school!

Getting Started:
1. Add your children - Set up profiles for each child
2. Upload lesson content - PDFs, images, or YouTube videos
3. Watch them learn! - Jeffrey will guide them through interactive lessons

Start learning at: ${config.frontendUrl}/dashboard

Questions? Reply to this email - we're here to help!
- The OrbitLearn Team
    `,
  }),

  /**
   * OTP verification email
   */
  otp: (otp: string, purpose: 'verify_email' | 'reset_password' | 'login') => {
    const purposes = {
      verify_email: {
        title: 'Verify Your Email',
        message: 'Please use the code below to verify your email address.',
        action: 'email verification',
        emoji: '✉️',
      },
      reset_password: {
        title: 'Reset Your Password',
        message: 'You requested to reset your password. Use the code below to proceed.',
        action: 'password reset',
        emoji: '🔐',
      },
      login: {
        title: 'Login Verification',
        message: 'Use the code below to complete your login.',
        action: 'login verification',
        emoji: '🔑',
      },
    };

    const { title, message, action, emoji } = purposes[purpose];

    return {
      subject: `${emoji} ${title} - OrbitLearn`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f4f8;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header with Logo -->
    <tr>
      <td style="background: linear-gradient(135deg, #7C3AED 0%, #2DD4BF 100%); border-radius: 24px 24px 0 0; padding: 30px; text-align: center;">
        <img src="${config.frontendUrl}/assets/orbit-learn-logo.png" alt="OrbitLearn" style="width: 80px; height: 80px; border-radius: 16px; margin-bottom: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
        <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700;">${title}</h1>
      </td>
    </tr>
    <tr>
      <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 24px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        <p style="color: #4b5563; line-height: 1.7; font-size: 16px; text-align: center;">
          ${message}
        </p>

        <!-- OTP Code Box -->
        <div style="background: linear-gradient(135deg, #EDE9FE 0%, #CCFBF1 100%); border-radius: 16px; padding: 32px; margin: 28px 0; text-align: center;">
          <p style="color: #6b7280; margin: 0 0 12px 0; font-size: 14px;">Your verification code:</p>
          <div style="font-size: 44px; font-weight: bold; letter-spacing: 10px; color: #5B21B6; font-family: 'Courier New', monospace; background: #ffffff; padding: 16px 24px; border-radius: 12px; display: inline-block; box-shadow: 0 2px 8px rgba(91, 33, 182, 0.15);">
            ${otp}
          </div>
        </div>

        <p style="color: #6b7280; font-size: 14px; text-align: center;">
          ⏱️ This code expires in <strong>10 minutes</strong>.
        </p>

        <!-- Security Tip -->
        <div style="background-color: #FEF3C7; border-radius: 12px; padding: 16px 20px; margin-top: 24px; border-left: 4px solid #F59E0B;">
          <p style="color: #92400E; margin: 0; font-size: 14px;">
            <strong>🔒 Security tip:</strong> Never share this code with anyone. OrbitLearn will never ask for your code via phone or text.
          </p>
        </div>

        <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 28px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
          If you didn't request this ${action}, please ignore this email or contact support if you have concerns.<br><br>
          <span style="color: #a78bfa;">- The OrbitLearn Team 💜</span>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
      text: `
${title}

${message}

Your verification code: ${otp}

This code expires in 10 minutes.

Security tip: Never share this code with anyone. OrbitLearn will never ask for your code via phone or text.

If you didn't request this ${action}, please ignore this email or contact support if you have concerns.

- The OrbitLearn Team
      `,
    };
  },

  /**
   * Child added notification email
   */
  childAdded: (parentName: string, childName: string) => ({
    subject: `🎉 ${childName}'s Profile is Ready! - OrbitLearn`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Child Profile Created</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f4f8;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header with Logo -->
    <tr>
      <td style="background: linear-gradient(135deg, #2DD4BF 0%, #7C3AED 100%); border-radius: 24px 24px 0 0; padding: 30px; text-align: center;">
        <img src="${config.frontendUrl}/assets/orbit-learn-logo.png" alt="OrbitLearn" style="width: 80px; height: 80px; border-radius: 16px; margin-bottom: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
        <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700;">🎉 ${childName}'s Profile is Ready!</h1>
      </td>
    </tr>
    <tr>
      <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 24px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        <p style="color: #4b5563; line-height: 1.7; font-size: 16px;">
          Hi ${parentName}! 👋
        </p>

        <p style="color: #4b5563; line-height: 1.7; font-size: 16px;">
          Great news! <strong>${childName}</strong>'s learning profile has been created and they're ready to start their educational adventure!
        </p>

        <!-- Jeffrey Excited Box -->
        <div style="background: linear-gradient(135deg, #CCFBF1 0%, #EDE9FE 100%); border-radius: 16px; padding: 24px; margin: 28px 0; text-align: center;">
          <img src="${config.frontendUrl}/assets/images/jeffrey-avatar.png" alt="Jeffrey" style="width: 70px; height: 70px; border-radius: 50%; border: 4px solid #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 12px;">
          <p style="color: #065f46; margin: 0; font-size: 16px; font-weight: 500;">
            Jeffrey is excited to meet <strong>${childName}</strong> and help them explore fun lessons! 🚀
          </p>
        </div>

        <h3 style="color: #1e1b4b; font-size: 18px;">Next Steps:</h3>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0;">
          <tr>
            <td style="padding: 10px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="color: #2DD4BF; font-size: 20px; vertical-align: middle; padding-right: 12px;">📚</td>
                  <td style="color: #4b5563; font-size: 15px;">Upload your first lesson for ${childName}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="color: #7C3AED; font-size: 20px; vertical-align: middle; padding-right: 12px;">💬</td>
                  <td style="color: #4b5563; font-size: 15px;">Let ${childName} chat with Jeffrey</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="color: #F59E0B; font-size: 20px; vertical-align: middle; padding-right: 12px;">📊</td>
                  <td style="color: #4b5563; font-size: 15px;">Track their progress in your parent dashboard</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${config.frontendUrl}/dashboard/children" style="background: linear-gradient(135deg, #2DD4BF 0%, #7C3AED 100%); color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 50px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 14px rgba(45, 212, 191, 0.4);">
            View ${childName}'s Profile ✨
          </a>
        </div>

        <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
          <span style="color: #a78bfa;">- The OrbitLearn Team 💜</span>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
    text: `
${childName}'s Profile is Ready!

Hi ${parentName},

Great news! ${childName}'s learning profile has been created and they're ready to start their educational adventure with Jeffrey!

Jeffrey is excited to meet ${childName} and help them explore fun lessons!

Next Steps:
- Upload your first lesson for ${childName}
- Let ${childName} chat with Jeffrey
- Track their progress in your parent dashboard

View profile at: ${config.frontendUrl}/dashboard/children

- The OrbitLearn Team
    `,
  }),

  /**
   * Weekly progress report email
   */
  weeklyProgress: (
    parentName: string,
    childName: string,
    stats: {
      lessonsCompleted: number;
      timeSpent: string;
      xpEarned: number;
      streak: number;
      badgesEarned: string[];
    }
  ) => ({
    subject: `📊 ${childName}'s Weekly Learning Report - OrbitLearn`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Progress Report</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f4f8;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header with Logo -->
    <tr>
      <td style="background: linear-gradient(135deg, #7C3AED 0%, #EC4899 100%); border-radius: 24px 24px 0 0; padding: 30px; text-align: center;">
        <img src="${config.frontendUrl}/assets/orbit-learn-logo.png" alt="OrbitLearn" style="width: 80px; height: 80px; border-radius: 16px; margin-bottom: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
        <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700;">${childName}'s Weekly Report 📊</h1>
        <p style="color: rgba(255,255,255,0.95); margin-top: 8px; font-size: 16px;">Great progress this week!</p>
      </td>
    </tr>
    <tr>
      <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 24px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        <p style="color: #4b5563; line-height: 1.7; font-size: 16px;">
          Hi ${parentName}! 👋
        </p>

        <p style="color: #4b5563; line-height: 1.7; font-size: 16px;">
          Here's what <strong>${childName}</strong> accomplished this week with Jeffrey:
        </p>

        <!-- Stats Grid -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
          <tr>
            <td style="background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border-radius: 16px; padding: 20px; text-align: center; width: 48%;">
              <div style="font-size: 36px; font-weight: bold; color: #D97706;">📚 ${stats.lessonsCompleted}</div>
              <div style="color: #92400E; font-size: 14px; font-weight: 600; margin-top: 4px;">Lessons Completed</div>
            </td>
            <td style="width: 4%;"></td>
            <td style="background: linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%); border-radius: 16px; padding: 20px; text-align: center; width: 48%;">
              <div style="font-size: 36px; font-weight: bold; color: #2563EB;">⏱️ ${stats.timeSpent}</div>
              <div style="color: #1E40AF; font-size: 14px; font-weight: 600; margin-top: 4px;">Learning Time</div>
            </td>
          </tr>
          <tr><td colspan="3" style="height: 12px;"></td></tr>
          <tr>
            <td style="background: linear-gradient(135deg, #CCFBF1 0%, #99F6E4 100%); border-radius: 16px; padding: 20px; text-align: center; width: 48%;">
              <div style="font-size: 36px; font-weight: bold; color: #0D9488;">⭐ ${stats.xpEarned}</div>
              <div style="color: #115E59; font-size: 14px; font-weight: 600; margin-top: 4px;">XP Earned</div>
            </td>
            <td style="width: 4%;"></td>
            <td style="background: linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%); border-radius: 16px; padding: 20px; text-align: center; width: 48%;">
              <div style="font-size: 36px; font-weight: bold; color: #7C3AED;">🔥 ${stats.streak}</div>
              <div style="color: #5B21B6; font-size: 14px; font-weight: 600; margin-top: 4px;">Day Streak</div>
            </td>
          </tr>
        </table>

        ${stats.badgesEarned.length > 0 ? `
        <!-- Badges Section -->
        <div style="background: linear-gradient(135deg, #CCFBF1 0%, #EDE9FE 100%); border-radius: 16px; padding: 24px; margin: 24px 0; text-align: center;">
          <h3 style="color: #065F46; margin: 0 0 12px 0; font-size: 18px;">🏆 New Badges Earned!</h3>
          <p style="color: #4b5563; margin: 0; font-size: 15px;">
            ${stats.badgesEarned.join(' • ')}
          </p>
        </div>
        ` : ''}

        <!-- Jeffrey Encouragement -->
        <div style="background-color: #F5F3FF; border-radius: 16px; padding: 20px; margin: 24px 0; text-align: center; border: 2px dashed #C4B5FD;">
          <img src="${config.frontendUrl}/assets/images/jeffrey-avatar.png" alt="Jeffrey" style="width: 50px; height: 50px; border-radius: 50%; margin-bottom: 10px;">
          <p style="color: #5B21B6; margin: 0; font-size: 15px; font-style: italic;">
            "Keep up the amazing work, ${childName}! Every lesson brings you closer to your goals!" 🌟
          </p>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${config.frontendUrl}/dashboard/progress" style="background: linear-gradient(135deg, #7C3AED 0%, #EC4899 100%); color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 50px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4);">
            View Full Report 📈
          </a>
        </div>

        <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
          Keep up the great work! Every lesson brings ${childName} closer to their learning goals.<br><br>
          <span style="color: #a78bfa;">- The OrbitLearn Team 💜</span>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
    text: `
${childName}'s Weekly Learning Report

Hi ${parentName},

Here's what ${childName} accomplished this week with Jeffrey:

- Lessons Completed: ${stats.lessonsCompleted}
- Learning Time: ${stats.timeSpent}
- XP Earned: ${stats.xpEarned}
- Day Streak: ${stats.streak}
${stats.badgesEarned.length > 0 ? `- New Badges: ${stats.badgesEarned.join(', ')}` : ''}

"Keep up the amazing work, ${childName}! Every lesson brings you closer to your goals!" - Jeffrey

View full report at: ${config.frontendUrl}/dashboard/progress

Keep up the great work! Every lesson brings ${childName} closer to their learning goals.

- The OrbitLearn Team
    `,
  }),

  /**
   * Security alert email for sensitive account changes
   */
  securityAlert: (parentName: string, alertType: string, details: string) => ({
    subject: `🔒 Security Alert: ${alertType} - OrbitLearn`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Alert</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f4f8;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header with Logo -->
    <tr>
      <td style="background: linear-gradient(135deg, #EF4444 0%, #F59E0B 100%); border-radius: 24px 24px 0 0; padding: 30px; text-align: center;">
        <img src="${config.frontendUrl}/assets/orbit-learn-logo.png" alt="OrbitLearn" style="width: 80px; height: 80px; border-radius: 16px; margin-bottom: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
        <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700;">🔒 Security Alert</h1>
      </td>
    </tr>
    <tr>
      <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 24px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        <p style="color: #4b5563; line-height: 1.7; font-size: 16px;">
          Hi ${parentName}! 👋
        </p>

        <p style="color: #4b5563; line-height: 1.7; font-size: 16px;">
          We're letting you know about a security-related change on your OrbitLearn account:
        </p>

        <!-- Alert Box -->
        <div style="background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border-radius: 16px; padding: 24px; margin: 28px 0; border-left: 4px solid #F59E0B;">
          <h3 style="color: #92400E; margin: 0 0 12px 0; font-size: 18px;">${alertType}</h3>
          <p style="color: #78350F; margin: 0; font-size: 15px;">
            ${details}
          </p>
          <p style="color: #92400E; margin-top: 16px; margin-bottom: 0; font-size: 13px;">
            <strong>Time:</strong> ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}
          </p>
        </div>

        <!-- Security Note -->
        <div style="background-color: #FEE2E2; border-radius: 12px; padding: 16px 20px; margin-top: 24px; border-left: 4px solid #EF4444;">
          <p style="color: #991B1B; margin: 0; font-size: 14px;">
            <strong>⚠️ Didn't make this change?</strong><br>
            If you didn't authorize this action, please secure your account immediately by changing your password and contacting our support team.
          </p>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${config.frontendUrl}/parent/settings" style="background: linear-gradient(135deg, #7C3AED 0%, #2DD4BF 100%); color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 50px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4);">
            Review Account Settings 🔐
          </a>
        </div>

        <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
          This is an automated security notification. If you have any questions, please contact our support team.<br><br>
          <span style="color: #a78bfa;">- The OrbitLearn Security Team 🛡️</span>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
    text: `
Security Alert: ${alertType}

Hi ${parentName},

We're letting you know about a security-related change on your OrbitLearn account:

${alertType}
${details}

Time: ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}

Didn't make this change?
If you didn't authorize this action, please secure your account immediately by changing your password and contacting our support team.

Review your account settings at: ${config.frontendUrl}/parent/settings

- The OrbitLearn Security Team
    `,
  }),
};

export const emailService = {
  /**
   * Send welcome email to new parent
   */
  async sendWelcomeEmail(email: string, parentName: string): Promise<boolean> {
    if (config.email.skipEmails || !resend) {
      logger.info(`[Email] Skipped welcome email to ${email}`);
      return true;
    }

    try {
      const template = templates.welcome(parentName);

      const { error } = await resend.emails.send({
        from: `OrbitLearn <${config.email.fromEmail}>`,
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      if (error) {
        logger.error('Failed to send welcome email', { error, email });
        return false;
      }

      logger.info(`Welcome email sent to ${email}`);
      return true;
    } catch (error) {
      logger.error('Error sending welcome email', { error, email });
      return false;
    }
  },

  /**
   * Send OTP verification email
   */
  async sendOtpEmail(
    email: string,
    otp: string,
    purpose: 'verify_email' | 'reset_password' | 'login'
  ): Promise<boolean> {
    if (config.email.skipEmails || !resend) {
      logger.info(`[Email] Skipped OTP email to ${email}, code: ${otp}`);
      return true;
    }

    try {
      const template = templates.otp(otp, purpose);

      const { error } = await resend.emails.send({
        from: `OrbitLearn <${config.email.fromEmail}>`,
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      if (error) {
        logger.error('Failed to send OTP email', { error, email, purpose });
        return false;
      }

      logger.info(`OTP email sent to ${email} for ${purpose}`);
      return true;
    } catch (error) {
      logger.error('Error sending OTP email', { error, email });
      return false;
    }
  },

  /**
   * Send child profile created notification
   */
  async sendChildAddedEmail(
    email: string,
    parentName: string,
    childName: string
  ): Promise<boolean> {
    if (config.email.skipEmails || !resend) {
      logger.info(`[Email] Skipped child added email to ${email}`);
      return true;
    }

    try {
      const template = templates.childAdded(parentName, childName);

      const { error } = await resend.emails.send({
        from: `OrbitLearn <${config.email.fromEmail}>`,
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      if (error) {
        logger.error('Failed to send child added email', { error, email });
        return false;
      }

      logger.info(`Child added email sent to ${email}`);
      return true;
    } catch (error) {
      logger.error('Error sending child added email', { error, email });
      return false;
    }
  },

  /**
   * Send weekly progress report
   */
  async sendWeeklyProgressEmail(
    email: string,
    parentName: string,
    childName: string,
    stats: {
      lessonsCompleted: number;
      timeSpent: string;
      xpEarned: number;
      streak: number;
      badgesEarned: string[];
    }
  ): Promise<boolean> {
    if (config.email.skipEmails || !resend) {
      logger.info(`[Email] Skipped weekly progress email to ${email}`);
      return true;
    }

    try {
      const template = templates.weeklyProgress(parentName, childName, stats);

      const { error } = await resend.emails.send({
        from: `OrbitLearn <${config.email.fromEmail}>`,
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      if (error) {
        logger.error('Failed to send weekly progress email', { error, email });
        return false;
      }

      logger.info(`Weekly progress email sent to ${email}`);
      return true;
    } catch (error) {
      logger.error('Error sending weekly progress email', { error, email });
      return false;
    }
  },

  /**
   * Send security alert for sensitive account changes
   */
  async sendSecurityAlert(
    email: string,
    parentName: string,
    alertType: string,
    details: string
  ): Promise<boolean> {
    if (config.email.skipEmails || !resend) {
      logger.info(`[Email] Skipped security alert to ${email}: ${alertType}`);
      return true;
    }

    try {
      const template = templates.securityAlert(parentName, alertType, details);

      const { error } = await resend.emails.send({
        from: `OrbitLearn Security <${config.email.fromEmail}>`,
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      if (error) {
        logger.error('Failed to send security alert email', { error, email, alertType });
        return false;
      }

      logger.info(`Security alert email sent to ${email}: ${alertType}`);
      return true;
    } catch (error) {
      logger.error('Error sending security alert email', { error, email });
      return false;
    }
  },
};
