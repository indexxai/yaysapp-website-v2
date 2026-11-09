/// <reference types="node" />
import React from 'react';
import * as zlib from 'zlib';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ImagePicker from 'react-native-image-crop-picker';
import { pick } from '@react-native-documents/picker';
import * as Recorder from 'react-native-audio-recorder-player';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { API } from './helpers';
import { call, say, user, type U } from './people';

const store = (Keychain as unknown as { __store: Map<string, string> }).__store;
const rec = (Recorder as unknown as { __rec: { listener: ((e: { currentPosition: number; currentMetering?: number }) => void) | null; __next: string } }).__rec;

/** A real PNG (solid colour), as a data: URL the app reads like a file on the phone. */
function png(w: number, h: number): string {
  const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([232, 128, 40]).flat())]);
  const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
const dataUrl = (mime: string, text: string) => `data:${mime};base64,${Buffer.from(text).toString('base64')}`;

function launchAs(u: U) {
  store.set('yays.tokens', JSON.stringify(u.tokens));
  (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API;
  resetApiForTests();
  return render(<App />);
}
/** A chat with one message from b (empty chats aren't listed). */
const direct = async (a: U, b: U) => {
  const id = (await call('/v1/conversations/direct', { userId: b.id }, a.tokens.accessToken)).id as string;
  await say(b, id, 'Hi');
  return id;
};
type Msg = { text: string; attachment?: { kind: string; name: string; url: string; durationMs?: number; waveform?: number[]; width?: number } };
const messages = async (u: U, conv: string) => (await call(`/v1/conversations/${conv}/messages?limit=50`, undefined, u.tokens.accessToken)).items as Msg[];
const openChat = async (name: string) => fireEvent.press(await screen.findByLabelText(new RegExp(`^Chat with ${name}`)));

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); });

describe('Photos, voice notes and files on mobile, against the real API', () => {
  it('a photo from the library with a caption: uploads, shows, opens full screen; the other person gets it', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    const path = png(300, 200);
    (ImagePicker.openPicker as jest.Mock).mockResolvedValueOnce([{ path, mime: 'image/png', width: 300, height: 200, size: 0, filename: 'beach.png' }]);
    launchAs(ali);
    await openChat('Sara');
    fireEvent.changeText(await screen.findByLabelText('Message'), 'At the beach');
    fireEvent.press(screen.getByLabelText('Attach'));
    fireEvent.press(within(await screen.findByTestId('attach-sheet')).getByLabelText('Photos and videos'));
    await waitFor(async () => {
      const got = (await messages(sara, conv)).find((m) => m.attachment?.kind === 'image');
      expect(got).toMatchObject({ text: 'At the beach', attachment: { name: 'beach.png', width: 300 } });
    }, { timeout: 15000 });
    // Sent: the bubble shows the photo from the server, and the caption.
    await waitFor(() => expect(within(screen.getByTestId('msg-mine')).getByTestId('tick-sent')).toBeTruthy(), { timeout: 10000 });
    expect(screen.getByText('At the beach')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Photo: At the beach'));
    expect(await screen.findByTestId('media-viewer')).toBeTruthy();
    fireEvent.press(within(screen.getByTestId('media-viewer')).getByLabelText('Close'));
    await waitFor(() => expect(screen.queryByTestId('media-viewer')).toBeNull());
  });

  it('a voice note: record, see the timer, send; it arrives with its length and waveform', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    launchAs(ali);
    await openChat('Sara');
    fireEvent.press(await screen.findByLabelText('Voice'));
    expect(await screen.findByTestId('recording-bar')).toBeTruthy();
    // 2.4 seconds of talking, getting louder.
    for (let ms = 100; ms <= 2400; ms += 100) act(() => rec.listener?.({ currentPosition: ms, currentMetering: -50 + (ms / 2400) * 45 }));
    expect(screen.getByLabelText('Recording, 0:02')).toBeTruthy();
    rec.__next = dataUrl('audio/mp4', 'not really audio, but the right size of thing');
    fireEvent.press(screen.getByLabelText('Send voice message'));
    await waitFor(async () => {
      const got = (await messages(sara, conv)).find((m) => m.attachment?.kind === 'voice');
      expect(got?.attachment).toMatchObject({ durationMs: 2400 });
      expect(got!.attachment!.waveform).toHaveLength(48);
    }, { timeout: 15000 });
    expect(await screen.findByLabelText('Play voice message')).toBeTruthy();
  });

  it('a too-short voice note is not sent; cancel throws a recording away', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    launchAs(ali);
    await openChat('Sara');
    fireEvent.press(await screen.findByLabelText('Voice'));
    await screen.findByTestId('recording-bar');
    act(() => rec.listener?.({ currentPosition: 300 }));
    rec.__next = dataUrl('audio/mp4', 'short');
    fireEvent.press(screen.getByLabelText('Send voice message'));
    expect(await screen.findByText(/at least a second/)).toBeTruthy();
    fireEvent.press(await screen.findByLabelText('Voice'));
    await screen.findByTestId('recording-bar');
    act(() => rec.listener?.({ currentPosition: 3000 }));
    fireEvent.press(screen.getByLabelText('Cancel recording'));
    await waitFor(() => expect(screen.queryByTestId('recording-bar')).toBeNull());
    expect((await messages(sara, conv)).filter((m) => m.attachment)).toHaveLength(0);
  });

  it('a document: picked, sent as a file, shown with its name and size', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    const body = 'Lunch menu: rice, daal, salad. '.repeat(40);
    (pick as jest.Mock).mockResolvedValueOnce([{ uri: dataUrl('application/pdf', body), name: 'menu.pdf', type: 'application/pdf', size: body.length }]);
    launchAs(ali);
    await openChat('Sara');
    fireEvent.press(await screen.findByLabelText('Attach'));
    fireEvent.press(within(await screen.findByTestId('attach-sheet')).getByLabelText('Document'));
    await waitFor(async () => expect((await messages(sara, conv)).find((m) => m.attachment?.kind === 'file')?.attachment?.name).toBe('menu.pdf'), { timeout: 15000 });
    expect(await screen.findByLabelText(/^File menu\.pdf, \d[\d.]* KB\. Open$/)).toBeTruthy();
  });
});
