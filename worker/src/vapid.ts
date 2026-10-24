// VAPID (RFC 8292): push services only accept a push signed with the key the browser
// subscribed with. The signature is an ES256 JWT, made here with WebCrypto.

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export interface VapidKeys {
  /** Uncompressed P-256 public key (65 bytes), base64url. The browser subscribes with this. */
  VAPID_PUBLIC_KEY: string;
  /** The private scalar `d`, base64url. Kept as a Worker secret. */
  VAPID_PRIVATE_KEY: string;
  /** A contact for the push services: an https URL or mailto: address. */
  VAPID_SUBJECT: string;
}

/** The Authorization header for sending a push to `endpoint`. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const pub = fromB64url(keys.VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: keys.VAPID_PRIVATE_KEY },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  // Apple rejects tokens that live longer than an hour.
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 3600, sub: keys.VAPID_SUBJECT };
  const body = `${header}.${b64url(enc.encode(JSON.stringify(claims)))}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(body));
  return `vapid t=${body}.${b64url(sig)}, k=${keys.VAPID_PUBLIC_KEY}`;
}
