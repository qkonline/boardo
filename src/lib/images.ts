// Making images small before they're uploaded: a board's background (its longer side at most
// 2400 px) and a profile photo (a 512 px square, cropped from the middle).

async function draw(blob: Blob, w: number, h: number, sx = 0, sy = 0, sw?: number, sh?: number): Promise<Blob> {
  const img = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("This browser can't prepare images.");
  ctx.drawImage(img, sx, sy, sw ?? img.width, sh ?? img.height, 0, 0, w, h);
  img.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

export async function fitImage(blob: Blob, max = 2400): Promise<Blob> {
  const img = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  img.close();
  return draw(blob, w, h);
}

export async function squarePhoto(blob: Blob, size = 512): Promise<Blob> {
  const img = await createImageBitmap(blob);
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  img.close();
  return draw(blob, Math.min(size, side), Math.min(size, side), sx, sy, side, side);
}

export const isImageFile = (f: File) => /^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(f.type) || /\.(jpe?g|png|webp|gif|heic)$/i.test(f.name);
