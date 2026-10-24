// Alerts on this device for updates in the bell, as Elastic's: the browser subscribes to push
// with Boardo's public key and the API keeps its address for the person signed in here. A
// board sends an empty push when there's something new; the service worker (src/sw.js) asks
// the API what it is and shows it.

import { call } from './api';

const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/**
 * What this device can do: 'unsupported' (no push here), 'install' (an iPhone or iPad, where
 * only the Home Screen app can have alerts), 'blocked' (turned down in the browser's settings),
 * or 'off' and 'on'.
 */
export type AlertState = 'unsupported' | 'install' | 'blocked' | 'off' | 'on';

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  return (await navigator.serviceWorker?.getRegistration().catch(() => undefined)) ?? null;
}

export async function alertState(): Promise<AlertState> {
  if (typeof window === 'undefined' || !KEY) return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return ios() && !installed() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const sub = await (await registration())?.pushManager.getSubscription().catch(() => null);
  if (!sub || Notification.permission !== 'granted') return 'off';
  try {
    return (await call<{ on: boolean }>('/push/status', { endpoint: sub.endpoint })).on ? 'on' : 'off';
  } catch {
    return 'on';
  }
}

/** Ask for permission (it must follow a tap), subscribe, and tell the API. */
export async function alertsOn(): Promise<AlertState> {
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'blocked' : 'off';
  const reg = await registration();
  if (!reg) throw new Error("Alerts need Boardo's offline copy, which isn't ready yet. Reload and try again.");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY!) }));
  await call('/push/subscribe', { endpoint: sub.endpoint });
  return 'on';
}

export async function alertsOff(): Promise<AlertState> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub) {
    await call('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}
