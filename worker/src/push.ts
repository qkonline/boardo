// Sending one empty push to a browser, as Elastic does. The service worker (src/sw.js) asks the
// API what's new and shows it, so nothing about a board travels through the push service.

import { vapidAuthorization, type VapidKeys } from './vapid';

/** The browsers' own push services. Anything else is refused. */
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

export function isPushEndpoint(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 1024) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

/** 'gone': the browser dropped its subscription, so stop sending to it. */
export async function sendPush(endpoint: string, keys: VapidKeys): Promise<'ok' | 'gone' | 'failed'> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuthorization(endpoint, keys),
      ttl: '86400', // an update is still worth showing for a day if the phone is off
      urgency: 'normal',
    },
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  if (res.ok) return 'ok';
  console.warn('push failed', res.status, await res.text());
  return 'failed';
}
