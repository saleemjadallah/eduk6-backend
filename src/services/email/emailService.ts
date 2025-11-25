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
    subject: 'Welcome to NanoBanana! Your Learning Adventure Begins',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to NanoBanana!</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <tr>
      <td style="background: linear-gradient(135deg, #FFD93D 0%, #FF6B6B 100%); border-radius: 20px 20px 0 0; padding: 40px; text-align: center;">
        <h1 style="color: #1a1a2e; margin: 0; font-size: 32px;">Welcome to NanoBanana!</h1>
        <p style="color: #1a1a2e; margin-top: 10px; font-size: 18px;">Where Learning is an Adventure!</p>
      </td>
    </tr>
    <tr>
      <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 20px 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <h2 style="color: #1a1a2e; margin-top: 0;">Hi ${parentName}!</h2>

        <p style="color: #4a4a4a; line-height: 1.6; font-size: 16px;">
          Thank you for joining NanoBanana! We're thrilled to have you and your family as part of our learning community.
        </p>

        <div style="background-color: #f0f9ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 24px 0; border-radius: 8px;">
          <h3 style="color: #1e40af; margin-top: 0;">Meet Jeffrey, Your Child's AI Tutor!</h3>
          <p style="color: #4a4a4a; margin-bottom: 0;">
            Jeffrey is a friendly, patient AI tutor who adapts to each child's learning style. He makes education fun with interactive lessons, games, and personalized encouragement!
          </p>
        </div>

        <h3 style="color: #1a1a2e;">Getting Started:</h3>
        <ol style="color: #4a4a4a; line-height: 1.8;">
          <li><strong>Add your children</strong> - Set up profiles for each child</li>
          <li><strong>Upload lesson content</strong> - PDFs, images, or YouTube videos</li>
          <li><strong>Watch them learn!</strong> - Jeffrey will guide them through interactive lessons</li>
        </ol>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${config.frontendUrl}/dashboard" style="background: linear-gradient(135deg, #FFD93D 0%, #FF6B6B 100%); color: #1a1a2e; text-decoration: none; padding: 14px 32px; border-radius: 30px; font-weight: bold; font-size: 16px; display: inline-block;">
            Start Learning Now
          </a>
        </div>

        <p style="color: #4a4a4a; font-size: 14px; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-bottom: 0;">
          Questions? Reply to this email - we're here to help!<br>
          <span style="color: #9ca3af;">- The NanoBanana Team</span>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
    text: `
Welcome to NanoBanana!

Hi ${parentName}!

Thank you for joining NanoBanana! We're thrilled to have you and your family as part of our learning community.

Meet Jeffrey, Your Child's AI Tutor!
Jeffrey is a friendly, patient AI tutor who adapts to each child's learning style. He makes education fun with interactive lessons, games, and personalized encouragement!

Getting Started:
1. Add your children - Set up profiles for each child
2. Upload lesson content - PDFs, images, or YouTube videos
3. Watch them learn! - Jeffrey will guide them through interactive lessons

Start learning at: ${config.frontendUrl}/dashboard

Questions? Reply to this email - we're here to help!
- The NanoBanana Team
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
      },
      reset_password: {
        title: 'Reset Your Password',
        message: 'You requested to reset your password. Use the code below to proceed.',
        action: 'password reset',
      },
      login: {
        title: 'Login Verification',
        message: 'Use the code below to complete your login.',
        action: 'login verification',
      },
    };

    const { title, message, action } = purposes[purpose];

    return {
      subject: `${title} - NanoBanana`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <tr>
      <td style="background: linear-gradient(135deg, #FFD93D 0%, #FF6B6B 100%); border-radius: 20px 20px 0 0; padding: 30px; text-align: center;">
        <h1 style="color: #1a1a2e; margin: 0; font-size: 28px;">${title}</h1>
      </td>
    </tr>
    <tr>
      <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 20px 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <p style="color: #4a4a4a; line-height: 1.6; font-size: 16px; text-align: center;">
          ${message}
        </p>

        <div style="background-color: #f0f9ff; border-radius: 12px; padding: 30px; margin: 24px 0; text-align: center;">
          <p style="color: #6b7280; margin: 0 0 10px 0; font-size: 14px;">Your verification code:</p>
          <div style="font-size: 42px; font-weight: bold; letter-spacing: 8px; color: #1e40af; font-family: monospace;">
            ${otp}
          </div>
        </div>

        <p style="color: #6b7280; font-size: 14px; text-align: center;">
          This code expires in <strong>10 minutes</strong>.
        </p>

        <div style="background-color: #fef3c7; border-radius: 8px; padding: 16px; margin-top: 24px;">
          <p style="color: #92400e; margin: 0; font-size: 14px;">
            <strong>Security tip:</strong> Never share this code with anyone. NanoBanana will never ask for your code via phone or text.
          </p>
        </div>

        <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
          If you didn't request this ${action}, please ignore this email or contact support if you have concerns.
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

Security tip: Never share this code with anyone. NanoBanana will never ask for your code via phone or text.

If you didn't request this ${action}, please ignore this email or contact support if you have concerns.
      `,
    };
  },

  /**
   * Child added notification email
   */
  childAdded: (parentName: string, childName: string) => ({
    subject: `${childName}'s Profile is Ready! - NanoBanana`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Child Profile Created</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <tr>
      <td style="background: linear-gradient(135deg, #34D399 0%, #3B82F6 100%); border-radius: 20px 20px 0 0; padding: 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">${childName}'s Profile is Ready!</h1>
      </td>
    </tr>
    <tr>
      <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 20px 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <p style="color: #4a4a4a; line-height: 1.6; font-size: 16px;">
          Hi ${parentName},
        </p>

        <p style="color: #4a4a4a; line-height: 1.6; font-size: 16px;">
          Great news! <strong>${childName}</strong>'s learning profile has been created and they're ready to start their educational adventure with Jeffrey!
        </p>

        <div style="background-color: #ecfdf5; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
          <p style="color: #065f46; margin: 0; font-size: 16px;">
            Jeffrey is excited to meet ${childName} and help them explore fun lessons!
          </p>
        </div>

        <h3 style="color: #1a1a2e;">Next Steps:</h3>
        <ul style="color: #4a4a4a; line-height: 1.8;">
          <li>Upload your first lesson for ${childName}</li>
          <li>Let ${childName} chat with Jeffrey</li>
          <li>Track their progress in your parent dashboard</li>
        </ul>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${config.frontendUrl}/dashboard/children" style="background: linear-gradient(135deg, #34D399 0%, #3B82F6 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 30px; font-weight: bold; font-size: 16px; display: inline-block;">
            View ${childName}'s Profile
          </a>
        </div>
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
    subject: `${childName}'s Weekly Learning Report - NanoBanana`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Progress Report</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <tr>
      <td style="background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%); border-radius: 20px 20px 0 0; padding: 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">${childName}'s Weekly Report</h1>
        <p style="color: rgba(255,255,255,0.9); margin-top: 5px;">Great progress this week!</p>
      </td>
    </tr>
    <tr>
      <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 20px 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <p style="color: #4a4a4a; line-height: 1.6; font-size: 16px;">
          Hi ${parentName},
        </p>

        <p style="color: #4a4a4a; line-height: 1.6; font-size: 16px;">
          Here's what ${childName} accomplished this week with Jeffrey:
        </p>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
          <tr>
            <td style="background-color: #fef3c7; border-radius: 12px; padding: 20px; text-align: center; width: 48%;">
              <div style="font-size: 32px; font-weight: bold; color: #d97706;">${stats.lessonsCompleted}</div>
              <div style="color: #92400e; font-size: 14px;">Lessons Completed</div>
            </td>
            <td style="width: 4%;"></td>
            <td style="background-color: #dbeafe; border-radius: 12px; padding: 20px; text-align: center; width: 48%;">
              <div style="font-size: 32px; font-weight: bold; color: #2563eb;">${stats.timeSpent}</div>
              <div style="color: #1e40af; font-size: 14px;">Learning Time</div>
            </td>
          </tr>
          <tr><td colspan="3" style="height: 12px;"></td></tr>
          <tr>
            <td style="background-color: #dcfce7; border-radius: 12px; padding: 20px; text-align: center; width: 48%;">
              <div style="font-size: 32px; font-weight: bold; color: #16a34a;">${stats.xpEarned}</div>
              <div style="color: #166534; font-size: 14px;">XP Earned</div>
            </td>
            <td style="width: 4%;"></td>
            <td style="background-color: #fce7f3; border-radius: 12px; padding: 20px; text-align: center; width: 48%;">
              <div style="font-size: 32px; font-weight: bold; color: #db2777;">${stats.streak}</div>
              <div style="color: #9d174d; font-size: 14px;">Day Streak</div>
            </td>
          </tr>
        </table>

        ${stats.badgesEarned.length > 0 ? `
        <div style="background-color: #f0fdf4; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <h3 style="color: #166534; margin-top: 0;">New Badges Earned!</h3>
          <p style="color: #4a4a4a; margin-bottom: 0;">
            ${stats.badgesEarned.join(', ')}
          </p>
        </div>
        ` : ''}

        <div style="text-align: center; margin: 32px 0;">
          <a href="${config.frontendUrl}/dashboard/progress" style="background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 30px; font-weight: bold; font-size: 16px; display: inline-block;">
            View Full Report
          </a>
        </div>

        <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
          Keep up the great work! Every lesson brings ${childName} closer to their learning goals.
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

View full report at: ${config.frontendUrl}/dashboard/progress

Keep up the great work! Every lesson brings ${childName} closer to their learning goals.
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
        from: `NanoBanana <${config.email.fromEmail}>`,
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
        from: `NanoBanana <${config.email.fromEmail}>`,
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
        from: `NanoBanana <${config.email.fromEmail}>`,
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
        from: `NanoBanana <${config.email.fromEmail}>`,
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
};
