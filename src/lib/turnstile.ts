// Cloudflare Turnstile on asking for a sign-in code, when it's on: the site key is set here
// (VITE_TURNSTILE_SITE_KEY) and the Worker has the secret (worker/src/auth.ts). Its script is
// loaded only then, and only on the sign-in page.

export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

let loading: Promise<Turnstile> | null = null;

function load(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve((window as unknown as { turnstile: Turnstile }).turnstile);
    s.onerror = () => {
      loading = null;
      reject(new Error("Boardo couldn't check this browser. Reload the page and try again."));
    };
    document.head.append(s);
  });
  return loading;
}

/**
 * A check in `el` that gives an answer to send with the request (`token()`), each answer used
 * once (`reset()` after sending). Nothing when Turnstile is off.
 */
export function humanCheck(el: HTMLElement) {
  let id: string | null = null;
  let answer = '';
  let ts: Turnstile | null = null;
  if (TURNSTILE_SITE_KEY)
    void load().then((t) => {
      ts = t;
      id = t.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: 'interaction-only',
        callback: (a: string) => (answer = a),
        'expired-callback': () => (answer = ''),
        'error-callback': () => (answer = ''),
      });
    });
  return {
    on: !!TURNSTILE_SITE_KEY,
    token: () => answer,
    reset() {
      answer = '';
      if (ts && id) ts.reset(id);
    },
    stop() {
      if (ts && id) ts.remove(id);
    },
  };
}
