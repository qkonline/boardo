// Passkeys in the browser: adding one to the signed-in account on this device, and signing in
// with one (from a button, or offered quietly in the email field's suggestions where the
// browser can). The prompts are the browser's own.

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ApiError, call } from './api';

export const passkeysAvailable = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window;

/** The browser's passkey prompt was closed, or timed out: not worth an error message. */
export const cancelled = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError');

function passkeyError(e: unknown): never {
  if (e instanceof ApiError || cancelled(e)) throw e;
  if (e instanceof Error && e.name === 'InvalidStateError')
    throw new ApiError(409, 'This device already has a passkey for your account.');
  throw new ApiError(0, "This browser couldn't make or use a passkey.");
}

type RegOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];
type AuthOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

export async function addPasskey(): Promise<void> {
  const { challengeId, options } = await call<{ challengeId: string; options: RegOptions }>('/auth/passkey/add/start');
  const response = await startRegistration({ optionsJSON: options }).catch(passkeyError);
  await call('/auth/passkey/add/finish', { challengeId, response });
}

export async function passkeySignIn<T>(autofill = false): Promise<T> {
  // Offered quietly, nothing that goes wrong before the person picks one is worth an error.
  const quiet = (e: unknown): never => {
    if (!autofill) throw e;
    console.debug('Passkey suggestions', e);
    throw new DOMException('Not offered', 'AbortError');
  };
  const { challengeId, options } = await call<{ challengeId: string; options: AuthOptions }>('/auth/passkey/login/start').catch(quiet);
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill }).catch(autofill ? quiet : passkeyError);
  return call<T>('/auth/passkey/login/finish', { challengeId, response });
}

/** Whether passkeys can be offered in the email field's suggestions. */
export async function passkeyAutofill(): Promise<boolean> {
  try {
    return passkeysAvailable() && !!(await PublicKeyCredential.isConditionalMediationAvailable?.());
  } catch {
    return false;
  }
}
