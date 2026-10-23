// Sending email through Resend's HTTP API. Without a key (local development) mail is only
// logged, and with DEV_MAIL set it's also kept for `/dev/mail`, so tests can read the codes.

import type { Env } from './env';
import { Refusal } from './auth';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Mail kept in local development, newest last. */
export const devOutbox: Mail[] = [];

export async function sendMail(env: Env, mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.DEV_MAIL) {
      devOutbox.push(mail);
      if (devOutbox.length > 50) devOutbox.shift();
      console.log(`Mail to ${mail.to}: ${mail.subject}`);
      return;
    }
    throw new Refusal(503, "Email isn't set up yet.");
  }
  const failed = new Refusal(502, "The email couldn't be sent. Try again in a minute.");
  // A slow answer from Resend mustn't keep a sign-in waiting for ever.
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error('Resend', e);
    throw failed;
  });
  if (!res.ok) {
    console.error('Resend', res.status, await res.text().catch(() => ''));
    throw failed;
  }
}
