/**
 * Profile and group photos: any picture the browser can open (a 12 MB phone photo, a PNG screenshot, HEIC on Safari)
 * becomes a square, centred, at most 640 px image of a few hundred KB before it is uploaded. Avatars always show
 * as a circle, so the square crop is what people see anyway, and uploads stay small and quick.
 */
export const PHOTO_ACCEPT = 'image/*';
const SIDE = 640;
const MAX_INPUT = 25 * 1024 * 1024;

export class PhotoError extends Error {}

async function decode(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Honour the camera's rotation (EXIF), so phone photos aren't sideways.
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { img: b, w: b.width, h: b.height, done: () => b.close() };
    } catch { /* fall back to an <img> below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch { URL.revokeObjectURL(url); throw new PhotoError('That file can’t be opened as a photo. Try a JPG or PNG.'); }
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, q));

/** The part of the photo to keep, as fractions of its width and height (from the crop step). */
export interface PhotoCrop { x: number; y: number; w: number; h: number }

/** Square, ≤640 px (centred, or the part chosen in the crop step); WebP where the browser can write it, otherwise JPEG. */
export async function preparePhoto(file: File | Blob, area?: PhotoCrop): Promise<Blob> {
  if (file.type && !file.type.startsWith('image/')) throw new PhotoError('Choose a photo (JPG, PNG, WebP or HEIC).');
  if (file.size > MAX_INPUT) throw new PhotoError('That photo is larger than 25 MB.');
  const { img, w, h, done } = await decode(file);
  try {
    if (!w || !h) throw new PhotoError('That photo looks empty. Try another one.');
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const crop = area ? Math.max(1, Math.round(Math.min(area.w * w, area.h * h))) : Math.min(w, h), side = Math.min(SIDE, crop);
    const sx = area ? clamp(area.x) * w : (w - crop) / 2, sy = area ? clamp(area.y) * h : (h - crop) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoError('This browser can’t prepare photos. Try another browser.');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background rather than black
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(img, Math.min(sx, w - crop), Math.min(sy, h - crop), crop, crop, 0, 0, side, side);
    const webp = await toBlob(canvas, 'image/webp', 0.86);
    const out = webp && webp.type === 'image/webp' ? webp : await toBlob(canvas, 'image/jpeg', 0.88);
    if (!out) throw new PhotoError('The photo couldn’t be prepared. Try another one.');
    return out;
  } finally { done(); }
}
