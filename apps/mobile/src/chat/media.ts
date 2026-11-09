import { Platform } from 'react-native';
import ImagePicker, { type Image as PickedImage, type Video as PickedVideo } from 'react-native-image-crop-picker';
import { keepLocalCopy, pick, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { ApiError, baseMime, kindFor, type AttachmentKind, type FileToSend, type Uploader } from '@yays/shared';

/**
 * A file on the phone as the chat engine wants it: the engine only reads `size` and `type`, and hands the file to
 * the uploader, which sends the real bytes (`blob`). Phones often report no type, so the picker's type is used.
 */
export type PhoneFile = Blob & { blob: Blob };
export async function phoneFile(uri: string, mime: string): Promise<PhoneFile> {
  const blob = await (await fetch(uri)).blob();
  return { size: blob.size, type: baseMime(mime || blob.type || 'application/octet-stream'), blob } as unknown as PhoneFile;
}

/** Sends a file to its upload link with progress, like the web's (XMLHttpRequest works the same on phones). */
export const phoneUploader: Uploader = (t, file, onProgress, signal) => new Promise((resolve, reject) => {
  const x = new XMLHttpRequest();
  x.open('PUT', t.uploadUrl);
  for (const [k, v] of Object.entries(t.headers)) x.setRequestHeader(k, v);
  x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
  x.onload = () => (x.status >= 200 && x.status < 300 ? (onProgress(file.size), resolve()) : reject(new ApiError(x.status, 'internal_error', 'The upload failed. Try again.')));
  x.onerror = () => reject(new ApiError(0, 'internal_error', 'The upload failed. Check your connection and try again.'));
  x.onabort = () => reject(new Error('aborted'));
  signal.addEventListener('abort', () => x.abort());
  x.send((file as PhoneFile).blob ?? file);
});

const nameFrom = (path: string, fallback: string) => decodeURIComponent(path.split('/').pop() || fallback);
const isCancel = (e: unknown) => (e as { code?: string })?.code === 'E_PICKER_CANCELLED' || (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED);

/** What a picker gives back, ready for engine.sendFile. */
export type Picked = Omit<FileToSend, 'caption' | 'replyToId'>;

async function fromPicker(p: PickedImage | PickedVideo): Promise<Picked> {
  const mime = baseMime(p.mime);
  const kind: AttachmentKind = mime.startsWith('video/') ? 'video' : 'image';
  const file = await phoneFile(p.path, mime);
  return {
    file, kind, name: p.filename ?? nameFrom(p.path, kind === 'video' ? 'video.mp4' : 'photo.jpg'),
    width: p.width || undefined, height: p.height || undefined,
    ...(kind === 'video' && 'duration' in p && p.duration ? { durationMs: Math.round(p.duration) } : {}),
    localUrl: p.path,
  };
}

/** Photos and videos from the phone's library, up to 10 at once. Photos are made smaller (2048px, JPEG). */
export async function pickMedia(): Promise<Picked[]> {
  try {
    const got = await ImagePicker.openPicker({ multiple: true, maxFiles: 10, mediaType: 'any', compressImageMaxWidth: 2048, compressImageMaxHeight: 2048, compressImageQuality: 0.85, forceJpg: true });
    return Promise.all(got.map(fromPicker));
  } catch (e) { if (isCancel(e)) return []; throw e; }
}

/** A photo or a video from the camera. */
export async function fromCamera(video = false): Promise<Picked[]> {
  try {
    const got = await ImagePicker.openCamera({ mediaType: video ? 'video' : 'photo', compressImageMaxWidth: 2048, compressImageMaxHeight: 2048, compressImageQuality: 0.85, forceJpg: true });
    return [await fromPicker(got)];
  } catch (e) { if (isCancel(e)) return []; throw e; }
}

/** Any files (documents, PDFs…), sent as files. They're copied into the app first so they can be read. */
export async function pickFiles(): Promise<Picked[]> {
  try {
    const got = await pick({ allowMultiSelection: true });
    const copies = await keepLocalCopy({ files: got.map((f) => ({ uri: f.uri, fileName: f.name ?? 'file' })) as [{ uri: string; fileName: string }], destination: 'cachesDirectory' });
    return Promise.all(got.map(async (f, i) => {
      const c = copies[i];
      const uri = c && c.status === 'success' ? c.localUri : f.uri;
      const mime = baseMime(f.type ?? 'application/octet-stream');
      return { file: await phoneFile(uri, mime), kind: 'file' as const, name: f.name ?? nameFrom(uri, 'file'), localUrl: uri };
    }));
  } catch (e) { if (isCancel(e)) return []; throw e; }
}

/** Photos and videos are sent as what they are; anything else as a file. */
export const kindOf = (mime: string) => kindFor(mime);

/** Voice notes are AAC in an MP4 container on both iOS and Android. */
export const VOICE_MIME = 'audio/mp4';
export const voicePath = () => (Platform.OS === 'ios' ? 'voice.m4a' : undefined);
