import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

export async function sendEmail(subject: string, text: string, to: string, from?: string) {
  const host = process.env.EMAIL_SMTP_HOST;
  const port = process.env.EMAIL_SMTP_PORT;
  const user = process.env.EMAIL_SMTP_USER;
  const pass = process.env.EMAIL_SMTP_PASS;
  const defaultTo = process.env.EMAIL_DEFAULT_TO;
  const replyTo = process.env.EMAIL_DEFAULT_FROM;
  const isSendingRestricted = (process.env.EMAIL_SENDING_RESTRICTED || 'true') === 'true';

  if (!host || !port || !user || !pass) {
    console.warn('[sendEmail] Skipping send: SMTP configuration is missing in environment variables.');
    return;
  }


  if (!subject?.trim() || !text?.trim() || !to?.trim()) {
    console.warn('[sendEmail] Skipping send: missing subject, text, or recipient.', { subject, text, to });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: host,
    port: parseInt(port, 10),
    secure: parseInt(port, 10) === 465, // true for 465, false for other ports
    auth: {
      user: user,
      pass: pass,
    },
  });

  try {
    await transporter.sendMail({
      from: `"HK-47" <${replyTo}>`, // Use HK-47 as the sender name
      replyTo: replyTo,
      to: isSendingRestricted && defaultTo ? defaultTo : to,
      subject: subject,
      text: text,
    });
    console.log(`[sendEmail] Email sent to ${isSendingRestricted && defaultTo ? defaultTo : to}`);
  } catch (err) {
    console.error('[sendEmail] Nodemailer send failed', { err });
    throw err;
  }
}
