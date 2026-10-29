// Attachments (R4.14 to R4.19). Files go to R2 under `<board>/<file id>` (and `.thumb` for an
// image's thumbnail, made on the device). Only images, PDFs, CSV and Office documents are
// taken, and a file's type is decided by its first bytes as well as its name, so a renamed file
// of another kind is refused (CSV has no signature: it must read as text). A board's files are
// served only through short-lived signed links, which a member gets from `/files/links`;
// anything that isn't an image always downloads. Profile photos are the exception: they're at
// `users/<user id>/<photo id>`, served without a link to anyone given the address, which is
// long, random and new with each photo (servePhoto()).

import { BOARD_FILE, MAX_UPLOAD_MB, newId } from '../../shared/model';
import { b64url, Refusal, same, sessionUser } from './auth';
import { boardStub, roleIn } from './boards';
import { isId } from './checks';
import type { Env } from './env';

export type FileKind = 'jpg' | 'png' | 'gif' | 'webp' | 'pdf' | 'ooxml' | 'ole' | 'text';

const TYPES: Record<string, { kind: FileKind; mime: string }> = {
  jpg: { kind: 'jpg', mime: 'image/jpeg' },
  jpeg: { kind: 'jpg', mime: 'image/jpeg' },
  png: { kind: 'png', mime: 'image/png' },
  gif: { kind: 'gif', mime: 'image/gif' },
  webp: { kind: 'webp', mime: 'image/webp' },
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  docx: { kind: 'ooxml', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { kind: 'ooxml', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pptx: { kind: 'ooxml', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  doc: { kind: 'ole', mime: 'application/msword' },
  xls: { kind: 'ole', mime: 'application/vnd.ms-excel' },
  ppt: { kind: 'ole', mime: 'application/vnd.ms-powerpoint' },
  csv: { kind: 'text', mime: 'text/csv' },
};

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

/** What the first bytes say a file is, or null if it's none of the kinds taken. */
export function sniff(b: Uint8Array): FileKind | null {
  if (starts(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts(b, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) {
    // A zip: Office documents open with their parts list or one of their folders.
    const nameLen = b[26] | (b[27] << 8);
    const name = new TextDecoder().decode(b.slice(30, 30 + Math.min(nameLen, 64)));
    if (/^(\[Content_Types\]\.xml|_rels\/|docProps\/|word\/|xl\/|ppt\/)/.test(name)) return 'ooxml';
  }
  return null;
}

/**
 * Whether a file's first bytes read as text: none of the kinds above, and no control characters
 * but tabs and line breaks. Any encoding passes (Excel on Windows saves CSV in Windows-1252).
 */
export function plainText(b: Uint8Array): boolean {
  if (sniff(b)) return false;
  for (const x of b) if (x < 0x20 && x !== 0x09 && x !== 0x0a && x !== 0x0d && x !== 0x0c) return false;
  return true;
}

/** The type a file's name claims, if it's one that's taken. */
export function typeOf(name: string): { kind: FileKind; mime: string } | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && TYPES[ext]) || null;
}

export const isImage = (mime: string) => mime.startsWith('image/');

function cleanName(v: string | null): string | null {
  if (!v) return null;
  const n = v.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim();
  return n && n.length <= 200 ? n : null;
}

/** Read the start of a stream (at least `n` bytes, or all of it) and hand back the whole. */
async function peek(body: ReadableStream<Uint8Array>, n: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  let ended = false;
  while (got < n) {
    const { value, done } = await reader.read();
    if (done) {
      ended = true;
      break;
    }
    chunks.push(value);
    got += value.length;
  }
  const head = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    head.set(c, o);
    o += c.length;
  }
  const rest = new ReadableStream<Uint8Array>({
    start(ctl) {
      ctl.enqueue(head);
      if (ended) ctl.close();
    },
    async pull(ctl) {
      const { value, done } = await reader.read();
      if (done) ctl.close();
      else ctl.enqueue(value);
    },
    cancel(r) {
      return reader.cancel(r);
    },
  });
  return { head, stream: rest };
}

async function userOf(env: Env, req: Request): Promise<string> {
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
  const id = await sessionUser(env, token);
  if (!id) throw new Refusal(401, 'Signed out');
  return id;
}

/**
 * `PUT /files?board=&card=&name=` with the file as the body, or `&thumb=<file id>` for an
 * image's thumbnail. Answers with the file record.
 */
export async function upload(req: Request, env: Env): Promise<unknown> {
  const userId = await userOf(env, req);
  const url = new URL(req.url);
  const board = url.searchParams.get('board');
  const role = await roleIn(env, board, userId);
  if (!role) throw new Refusal(404, "That board isn't there any more.");
  const stub = boardStub(env, board!);
  const size = Number(req.headers.get('content-length'));
  if (!req.body || !Number.isInteger(size) || size <= 0) throw new Refusal(411, 'That file is empty.');

  // The board's background image (admins): an image only, stored like a card's file.
  if (url.searchParams.get('background')) {
    if (role !== 'admin') throw new Refusal(403, 'Only admins can change the background.');
    if (size > 15 * 1024 * 1024) throw new Refusal(413, 'Pick an image of up to 15 MB.');
    const { head, stream } = await peek(req.body, 16);
    const k = sniff(head);
    if (k !== 'jpg' && k !== 'png' && k !== 'webp') throw new Refusal(415, 'Pick a JPG, PNG or WebP image.');
    const mime = TYPES[k].mime;
    const id = newId();
    await env.FILES.put(`${board}/${id}`, stream.pipeThrough(new FixedLengthStream(size)), { httpMetadata: { contentType: mime } });
    const file = { id, cardId: BOARD_FILE, name: `background.${k}`, mime, size, by: userId, at: Date.now(), thumb: false };
    const kept = await thenRecord(env, `${board}/${id}`, () => stub.addBackground(file));
    if (!kept.file) {
      await env.FILES.delete(`${board}/${id}`);
      throw new Refusal(507, FULL);
    }
    return { file: kept.file };
  }

  const thumbOf = url.searchParams.get('thumb');
  if (thumbOf) {
    if (!isId(thumbOf) || size > 2 * 1024 * 1024) throw new Refusal(400, "That thumbnail can't be used.");
    const { head, stream } = await peek(req.body, 16);
    const k = sniff(head);
    if (k !== 'jpg' && k !== 'png' && k !== 'webp') throw new Refusal(415, "That thumbnail can't be used.");
    const f = await stub.fileInfo(thumbOf);
    if (!f || f.by !== userId) throw new Refusal(404, 'That file was removed.');
    await env.FILES.put(`${board}/${thumbOf}.thumb`, stream.pipeThrough(new FixedLengthStream(size)), {
      httpMetadata: { contentType: TYPES[k === 'jpg' ? 'jpg' : k].mime },
    });
    return { file: await stub.markThumb(thumbOf) };
  }

  const card = url.searchParams.get('card');
  const name = cleanName(url.searchParams.get('name'));
  if (!isId(card) || !name) throw new Refusal(400, 'Pick a file to attach.');
  const claimed = typeOf(name);
  if (!claimed)
    throw new Refusal(415, 'Only images (JPG, PNG, WebP, GIF), PDFs, CSV and Word, Excel or PowerPoint files can be attached.');
  const limit = Math.min(await stub.maxUploadMB(), MAX_UPLOAD_MB);
  if (size > limit * 1024 * 1024) throw new Refusal(413, `Files can be up to ${limit} MB in this board.`);
  const { head, stream } = await peek(req.body, claimed.kind === 'text' ? 4096 : 64);
  if (claimed.kind === 'text' ? !plainText(head) : sniff(head) !== claimed.kind)
    throw new Refusal(415, `That file isn't really a ${name.split('.').pop()!.toUpperCase()} file, so it can't be attached.`);
  if (!(await stub.cardOpen(card))) throw new Refusal(404, 'That card was archived or removed.');
  const id = newId();
  await env.FILES.put(`${board}/${id}`, stream.pipeThrough(new FixedLengthStream(size)), {
    httpMetadata: { contentType: claimed.mime },
  });
  const { file, full } = await thenRecord(env, `${board}/${id}`, () =>
    stub.addFile(userId, { id, cardId: card, name, mime: claimed.mime, size, by: userId, at: Date.now(), thumb: false }),
  );
  if (!file) {
    await env.FILES.delete(`${board}/${id}`);
    if (full) throw new Refusal(507, FULL);
    throw new Refusal(404, 'That card was archived or removed.');
  }
  return { file };
}

const FULL = 'This board is full. Delete some archived cards or files first.';

/**
 * Bytes just stored whose record comes next: if making the record fails, the bytes go too,
 * so nothing is left in R2 that no record points at.
 */
async function thenRecord<T>(env: Env, key: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    await env.FILES.delete(key).catch(() => {});
    throw e;
  }
}

// ---------- signed links ----------

const LINK_MS = 60 * 60_000;

async function hmac(env: Env, msg: string): Promise<string> {
  if (!env.FILE_SIGNING_KEY) throw new Refusal(503, "Files aren't set up yet.");
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.FILE_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

/** Links to files in a board, each good for an hour: `{ id: { url, thumb? } }`. */
export async function links(env: Env, userId: string, body: { board?: unknown; files?: unknown }, base: string) {
  const role = await roleIn(env, body.board, userId);
  if (!role) throw new Refusal(404, "That board isn't there any more.");
  if (!Array.isArray(body.files) || body.files.length > 200 || !body.files.every(isId)) throw new Refusal(400, 'Bad request');
  const board = body.board as string;
  const exp = Date.now() + LINK_MS;
  const files = await boardStub(env, board).filesById(body.files as string[]);
  const out: Record<string, { url: string; thumb?: string; exp: number }> = {};
  for (const f of files) {
    const sign = async (thumb: boolean) =>
      `${base}/files/${board}/${f.id}${thumb ? '/thumb' : ''}?exp=${exp}&sig=${await hmac(env, `${board}/${f.id}/${thumb ? 1 : 0}/${exp}`)}`;
    out[f.id] = { url: await sign(false), ...(f.thumb ? { thumb: await sign(true) } : {}), exp };
  }
  return { links: out };
}

/**
 * `GET /files/<board>/<id>[/thumb]?exp=&sig=`: a signed link, opened. `pathname`: the request's
 * path without the /api prefix it has on the app's own address.
 */
export async function serve(req: Request, env: Env, pathname = new URL(req.url).pathname): Promise<Response> {
  const url = new URL(req.url);
  const [, , board, id, part] = pathname.split('/');
  const thumb = part === 'thumb';
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig') ?? '';
  const denied = () => new Response('This link has expired. Open the card again to get a new one.', { status: 403 });
  if (!isId(board) || !isId(id) || (part && !thumb) || !Number.isFinite(exp) || exp < Date.now()) return denied();
  if (!same(await hmac(env, `${board}/${id}/${thumb ? 1 : 0}/${exp}`), sig)) return denied();
  const f = await boardStub(env, board).fileInfo(id);
  if (!f) return new Response('That file was removed.', { status: 404 });
  const obj = await env.FILES.get(`${board}/${id}${thumb ? '.thumb' : ''}`);
  if (!obj) return new Response('That file was removed.', { status: 404 });
  const headers = new Headers({
    'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    'content-length': String(obj.size),
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=3600',
    'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  const inline = thumb || isImage(f.mime);
  headers.set(
    'content-disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  );
  return new Response(obj.body, { headers });
}

/** Remove a file: whoever added it, or an admin. */
export async function remove(env: Env, userId: string, body: { board?: unknown; file?: unknown }) {
  const role = await roleIn(env, body.board, userId);
  if (!role) throw new Refusal(404, "That board isn't there any more.");
  if (!isId(body.file)) throw new Refusal(400, 'Pick a file.');
  const board = body.board as string;
  const f = await boardStub(env, board).removeFile(userId, role, body.file);
  if (f === 'denied') throw new Refusal(403, 'Only whoever added a file, or an admin, can remove it.');
  if (!f) return;
  await env.FILES.delete([`${board}/${f.id}`, `${board}/${f.id}.thumb`]);
}


// ---------- profile photos ----------

/**
 * `PUT /me/photo` with the image as the body (made square and small on the device). Stored at
 * `users/<user id>/<photo id>` and shown to the people in the person's boards; the id is long
 * and random, so only someone given the address can load it.
 */
export async function putPhoto(req: Request, env: Env): Promise<{ photo: string }> {
  const userId = await userOf(env, req);
  const size = Number(req.headers.get('content-length'));
  if (!req.body || !Number.isInteger(size) || size <= 0) throw new Refusal(411, 'That photo is empty.');
  if (size > 5 * 1024 * 1024) throw new Refusal(413, 'Pick a photo of up to 5 MB.');
  const { head, stream } = await peek(req.body, 16);
  const k = sniff(head);
  if (k !== 'jpg' && k !== 'png' && k !== 'webp') throw new Refusal(415, 'Pick a JPG, PNG or WebP photo.');
  const id = newId(24);
  await env.FILES.put(`users/${userId}/${id}`, stream.pipeThrough(new FixedLengthStream(size)), {
    httpMetadata: { contentType: TYPES[k].mime },
  });
  const old = await thenRecord(env, `users/${userId}/${id}`, async () => {
    const old = await env.DB.prepare('SELECT photo FROM users WHERE id = ?').bind(userId).first<{ photo: string | null }>();
    await env.DB.prepare('UPDATE users SET photo = ? WHERE id = ?').bind(id, userId).run();
    return old;
  });
  if (old?.photo) await env.FILES.delete(`users/${userId}/${old.photo}`);
  return { photo: id };
}

export async function removePhoto(env: Env, userId: string): Promise<void> {
  const old = await env.DB.prepare('SELECT photo FROM users WHERE id = ?').bind(userId).first<{ photo: string | null }>();
  await env.DB.prepare('UPDATE users SET photo = NULL WHERE id = ?').bind(userId).run();
  if (old?.photo) await env.FILES.delete(`users/${userId}/${old.photo}`);
}

/** `GET /photos/<user id>/<photo id>`: a profile photo. Its address never changes, so it's cached long. */
export async function servePhoto(req: Request, env: Env, pathname = new URL(req.url).pathname): Promise<Response> {
  const [, , userId, id] = pathname.split('/');
  if (!isId(userId) || !isId(id)) return new Response(null, { status: 404 });
  const obj = await env.FILES.get(`users/${userId}/${id}`);
  if (!obj) return new Response(null, { status: 404 });
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
