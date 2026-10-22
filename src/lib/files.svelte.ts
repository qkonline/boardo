// Attachments on this device: files waiting to upload (added offline, or on their way), and
// short-lived links to the ones already on a board. Uploads are kept in IndexedDB until they
// reach the board, so a file added offline goes once there's a connection (R9.6).

import { API, ApiError, call, getToken } from './api';
import * as db from './db';
import { type Upload } from './db';

const TYPES = /\.(jpe?g|png|gif|webp|pdf|docx?|xlsx?|pptx?)$/i;
export const ACCEPT =
  '.jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/jpeg,image/png,image/gif,image/webp,application/pdf';

export const isImageName = (n: string) => /\.(jpe?g|png|gif|webp)$/i.test(n);

/** A small JPEG of an image, at most 480 px on its longer side, for cards and lists. */
async function thumbnail(blob: Blob): Promise<Blob | null> {
  try {
    const img = await createImageBitmap(blob);
    const scale = Math.min(1, 480 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    img.close();
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  } catch {
    return null;
  }
}

function put(url: string, body: Blob, onProgress?: (p: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('authorization', `Bearer ${getToken()}`);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let data: { error?: string } = {};
      try {
        data = JSON.parse(x.responseText);
      } catch {
        /* empty */
      }
      if (x.status >= 200 && x.status < 300) resolve(data);
      else reject(new ApiError(x.status, data.error ?? "The file couldn't be stored. Try again."));
    };
    x.onerror = () => reject(new ApiError(0, "You're offline. The file will upload once you're connected."));
    x.send(body);
  });
}

export class Files {
  /** Files on their way, newest last. */
  queue = $state.raw<Upload[]>([]);
  progress = $state<Record<string, number>>({});
  /** Links to files on boards, by file id, until they expire. */
  links = $state.raw<Record<string, { url: string; thumb?: string; exp: number }>>({});
  private pumping = false;
  private asking = new Set<string>();

  constructor(private say: (text: string) => void) {}

  async load(): Promise<void> {
    this.queue = await db.getUploads();
  }

  /** Check the files, keep them on the device, and start uploading. */
  async add(board: string, card: string, files: File[], maxMB: number): Promise<void> {
    for (const f of files) {
      if (!TYPES.test(f.name)) {
        this.say(`${f.name} can't be attached. Images, PDFs and Word, Excel or PowerPoint files only.`);
        continue;
      }
      if (f.size > maxMB * 1024 * 1024) {
        this.say(`${f.name} is over ${maxMB} MB, the limit in this board.`);
        continue;
      }
      if (!f.size) continue;
      const u: Upload = {
        id: crypto.randomUUID(),
        board,
        card,
        name: f.name,
        type: f.type,
        blob: f,
        thumb: isImageName(f.name) ? await thumbnail(f) : null,
        at: Date.now(),
      };
      await db.putUpload(u);
      this.queue = [...this.queue, u];
    }
    void this.pump();
  }

  /** Send what's waiting, one at a time. Stops at the first network failure (tried again later). */
  async pump(): Promise<void> {
    if (this.pumping || !getToken()) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const u = this.queue[0];
        try {
          const q = new URLSearchParams({ board: u.board, card: u.card, name: u.name });
          const res = (await put(`${API}/files?${q}`, u.blob, (p) => (this.progress = { ...this.progress, [u.id]: p }))) as {
            file: { id: string };
          };
          if (u.thumb)
            await put(`${API}/files?${new URLSearchParams({ board: u.board, thumb: res.file.id })}`, u.thumb).catch(() => {});
        } catch (e) {
          if ((e as ApiError).status === 0) break;
          this.say(`${u.name}: ${(e as Error).message}`);
        }
        await db.deleteUpload(u.id);
        this.queue = this.queue.filter((x) => x.id !== u.id);
        const { [u.id]: _, ...rest } = this.progress;
        this.progress = rest;
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Make sure there are fresh links for these files. */
  async ensure(board: string, ids: string[]): Promise<void> {
    const soon = Date.now() + 5 * 60_000;
    const need = ids.filter((id) => !this.asking.has(id) && !(this.links[id]?.exp > soon));
    if (!need.length) return;
    for (const id of need) this.asking.add(id);
    try {
      const res = await call<{ links: Files['links'] }>('/files/links', { board, files: need });
      this.links = { ...this.links, ...res.links };
    } catch {
      /* offline: shown without previews */
    } finally {
      for (const id of need) this.asking.delete(id);
    }
  }

  /** Thumbnails made here for files still waiting, as object URLs. */
  localPreview(u: Upload): string | null {
    return u.thumb ? URL.createObjectURL(u.thumb) : null;
  }

  async remove(board: string, file: string): Promise<void> {
    await call('/files/delete', { board, file });
  }

  async cancel(id: string): Promise<void> {
    await db.deleteUpload(id);
    this.queue = this.queue.filter((x) => x.id !== id);
  }

  clear(): void {
    this.queue = [];
    this.links = {};
  }
}
