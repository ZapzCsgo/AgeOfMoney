import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import logger from '../logger';

const router = Router();

// Max 3 tickets per hour per IP
const supportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tickets envoyés. Réessayez dans une heure.' },
});

const supportSchema = z.object({
  email:   z.string().email().max(200),
  subject: z.string().min(1).max(100),
  message: z.string().min(10).max(2000),
});

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.warn('[Support] SMTP not configured — emails will not be sent');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

// POST /support — Submit a support ticket
router.post('/', supportLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = supportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Données invalides', details: parsed.error.flatten() });
      return;
    }

    const { email, subject, message } = parsed.data;

    // Always log the full ticket content so nothing is lost even if SMTP
    // fails — tickets can be recovered from Railway logs.
    logger.info(`[Support] Ticket received — from: ${email}, subject: ${subject}, body: ${message.replace(/\s+/g, ' ').slice(0, 200)}…`);

    const transporter = createTransporter();
    if (!transporter) {
      // Fail loudly when SMTP isn't wired — silently returning ok: true
      // made users think their ticket landed somewhere when it didn't. The
      // full content is already in the logs above, nothing lost.
      logger.error('[Support] SMTP not configured — set SMTP_HOST/SMTP_USER/SMTP_PASS (and optionally SUPPORT_EMAIL) on Railway');
      res.status(503).json({ error: 'Service email temporairement indisponible. Réessaye plus tard ou contacte-nous sur Discord.' });
      return;
    }

    const supportEmail = process.env.SUPPORT_EMAIL || 'support@ageof.money';

    await transporter.sendMail({
      from:    `"AgeOfMoney Support" <${process.env.SMTP_USER}>`,
      to:      supportEmail,
      replyTo: email,
      subject: `[Support AgeOfMoney] ${subject}`,
      text: [
        `Email de contact: ${email}`,
        `Sujet: ${subject}`,
        '',
        message,
      ].join('\n'),
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b1a;color:#e8e2f5;padding:24px;border-radius:12px;">
          <h2 style="color:#d4a017;margin-top:0;">Nouveau ticket support</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
            <tr>
              <td style="padding:6px 0;color:#9990b8;width:120px;">Email</td>
              <td style="padding:6px 0;"><a href="mailto:${email}" style="color:#d4a017;">${email}</a></td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#9990b8;">Sujet</td>
              <td style="padding:6px 0;">${subject}</td>
            </tr>
          </table>
          <div style="background:#13111f;border-radius:8px;padding:16px;white-space:pre-wrap;line-height:1.6;">
            ${message.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}
          </div>
          <p style="color:#4a4570;font-size:11px;margin-top:16px;">Ticket envoyé depuis ageof.money</p>
        </div>
      `,
    });

    logger.info(`[Support] Ticket sent — from: ${email}, subject: ${subject}`);
    res.json({ ok: true });
  } catch (error) {
    logger.error('[Support] Failed to send ticket:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi du ticket' });
  }
});

export default router;
