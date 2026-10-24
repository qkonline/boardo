import { describe, expect, it } from 'vitest';
import { isPushEndpoint } from './push';
import { b64url, fromB64url, vapidAuthorization } from './vapid';

async function keys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = b64url((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const { d } = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { pair, env: { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: d!, VAPID_SUBJECT: 'https://example.com/' } };
}

describe('vapidAuthorization', () => {
  it('signs a JWT for the push service that verifies with the public key', async () => {
    const { pair, env } = await keys();
    const now = 1_790_000_000_000;
    const auth = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', env, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(auth)!;
    expect(m).not.toBeNull();
    const [, h, c, sig, k] = m;
    expect(k).toBe(env.VAPID_PUBLIC_KEY);
    expect(JSON.parse(new TextDecoder().decode(fromB64url(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 3600,
      sub: 'https://example.com/',
    });
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      fromB64url(sig),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });
});

describe('push addresses', () => {
  it('takes only the browsers\' own push services', () => {
    expect(isPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isPushEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false);
    expect(isPushEndpoint('https://push.apple.com.evil.example/x')).toBe(false);
  });
});
