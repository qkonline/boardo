// Keeping installed copies up to date. An app on the Home Screen can stay in memory for days
// without reloading, so it would keep running an old build. The page knows its own build (a
// meta tag written at build time, see vite.config.ts) and asks the server for the current one
// (version.json, never cached); the app reloads when they differ and nothing is in progress.

const BUILD =
  typeof document === 'undefined'
    ? null
    : (document.querySelector<HTMLMetaElement>('meta[name="build"]')?.content ?? null);

/** Whether the server has a newer build than the one running. False in development or offline. */
export async function newBuildOut(): Promise<boolean> {
  if (!BUILD) return false;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const { v } = (await res.json()) as { v?: unknown };
    return typeof v === 'string' && v !== BUILD;
  } catch {
    return false;
  }
}

/** Fetch the new service worker too, then load the page again from the server. */
export async function reloadToUpdate(): Promise<void> {
  try {
    await (await navigator.serviceWorker?.getRegistration())?.update();
  } catch {
    /* the reload still gets the new page */
  }
  location.reload();
}
