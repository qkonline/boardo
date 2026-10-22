// Calls to the Worker. Everything is a POST with a JSON body; the session token goes as a
// Bearer header. A refusal carries a short reason the app can show as it is.

export const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** No connection, or the server couldn't be reached. */
  get offline(): boolean {
    return this.status === 0;
  }
}

let token: string | null = null;
export const setToken = (t: string | null) => (token = t);
export const getToken = () => token;

/** Called when any request finds the session gone. */
let onSignedOut: (() => void) | null = null;
export const whenSignedOut = (fn: () => void) => (onSignedOut = fn);

export async function call<T = unknown>(path: string, body: object = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "You're offline. Try again once you're connected.");
  }
  if (res.status === 204) return undefined as T;
  let data: { error?: string } = {};
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    if (res.status === 401 && token) onSignedOut?.();
    throw new ApiError(res.status, data.error ?? 'Something went wrong. Try again.');
  }
  return data as T;
}
