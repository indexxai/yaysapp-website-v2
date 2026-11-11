import { PermissionsAndroid, Platform } from 'react-native';
import { AudioSession } from '@livekit/react-native';
import { ConnectionState, Room, RoomEvent, Track, type LocalVideoTrack } from 'livekit-client';
import type { CallJoin, CallView } from '@yays/shared';
import { api } from '../lib/api';
import { config } from '../lib/config';

// ---------------------------------------------------------------------------------------------------------------
// The media side of one call: a LiveKit room plus what this phone sends and where its sound goes. Lives outside
// React, so moving between screens never drops the call. The server's view of the call (who is ringing, who
// joined, when it ended) comes from the chat engine; this is only the audio and video.
// ---------------------------------------------------------------------------------------------------------------
export class CallSession {
  readonly room: Room;
  readonly callId: string;
  first: CallView;
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' = 'connecting';
  mic = true;
  cam = false;
  /** Sound from the loudspeaker (video calls start this way) or the earpiece (voice calls). */
  speaker: boolean;
  frontCamera = true;
  minimized = false;
  error: string | null = null;
  /** Bumped on every change, for useSyncExternalStore. */
  version = 0;
  private listeners = new Set<() => void>();
  private closed = false;
  /** The person chose the speaker or earpiece themselves; turning the camera on no longer changes it. */
  private speakerChosen = false;

  constructor(join: CallJoin, private readonly wantVideo: boolean) {
    this.callId = join.call.id;
    this.first = join.call;
    this.speaker = wantVideo;
    this.room = new Room({ adaptiveStream: { pixelDensity: 'screen' }, dynacast: true });
    const bump = () => this.changed();
    for (const ev of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.ConnectionQualityChanged, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished]) this.room.on(ev, bump);
    this.room.on(RoomEvent.ConnectionStateChanged, (s: ConnectionState) => {
      this.state = s === ConnectionState.Connected ? 'connected' : s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting ? 'reconnecting' : s === ConnectionState.Disconnected ? 'disconnected' : 'connecting';
      this.changed();
    });
    this.room.on(RoomEvent.MediaDevicesError, (e: Error) => { this.error = deviceError(e); this.changed(); });
    void this.connect(join);
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  changed() { this.version++; for (const l of this.listeners) l(); }

  private async connect(join: CallJoin) {
    try { await AudioSession.startAudioSession(); } catch { /* the call still works with the default audio setup */ }
    try {
      await this.room.connect(reachable(join.url), join.token);
    } catch {
      if (this.closed) return;
      this.error = 'Could not connect the call. Check your connection and try again.';
      this.state = 'disconnected'; this.changed();
      return;
    }
    if (this.closed) { void this.room.disconnect(); return; }
    try { await this.room.localParticipant.setMicrophoneEnabled(true); } catch (e) { this.mic = false; this.error = deviceError(e); }
    if (this.wantVideo) { try { await this.room.localParticipant.setCameraEnabled(true, { facingMode: 'user' }); this.cam = true; } catch (e) { this.error = deviceError(e); } }
    await this.route();
    this.changed();
  }

  /** Sends the sound to the loudspeaker or the earpiece. Android lists 'speaker' and 'earpiece'; iOS 'force_speaker' and 'default'. */
  private async route() {
    try {
      const outs = await AudioSession.getAudioOutputs();
      // A headset or Bluetooth plugged in wins over the earpiece.
      const quiet = outs.find((o) => o === 'bluetooth' || o === 'headset') ?? (outs.includes('earpiece') ? 'earpiece' : 'default');
      const loud = outs.includes('speaker') ? 'speaker' : 'force_speaker';
      await AudioSession.selectAudioOutput(this.speaker ? loud : quiet);
    } catch { /* not every phone reports its outputs; the system picks */ }
  }
  async toggleSpeaker() { this.speaker = !this.speaker; this.speakerChosen = true; await this.route(); this.changed(); }
  async toggleMic() {
    try { await this.room.localParticipant.setMicrophoneEnabled(!this.mic); this.mic = !this.mic; this.error = null; } catch (e) { this.error = deviceError(e); }
    this.changed();
  }
  async toggleCam() {
    const on = !this.cam;
    if (on && !(await askPermissions(true))) { this.error = deviceError({ name: 'NotAllowedError' }); this.changed(); return; }
    try {
      await this.room.localParticipant.setCameraEnabled(on, { facingMode: this.frontCamera ? 'user' : 'environment' });
      this.cam = on; this.error = null;
      // Looking at the screen, not holding the phone to your ear: use the speaker unless you picked otherwise.
      if (on && !this.speakerChosen && !this.speaker) { this.speaker = true; await this.route(); }
    } catch (e) { this.error = deviceError(e); }
    this.changed();
  }
  async flipCamera() {
    const track = this.room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    if (!track) return;
    try { await track.restartTrack({ facingMode: this.frontCamera ? 'environment' : 'user' }); this.frontCamera = !this.frontCamera; } catch { this.error = 'Could not switch the camera.'; }
    this.changed();
  }
  setMinimized(v: boolean) { this.minimized = v; this.changed(); }
  /** Hangs up: tells the server first so the others stop waiting, then closes the media. */
  async hangUp() {
    await api().then((c) => c.leaveCall(this.callId)).catch(() => undefined);
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    void this.room.disconnect();
    void AudioSession.stopAudioSession().catch(() => undefined);
  }
}

/**
 * In development the API says LiveKit is on localhost, which is the phone itself to an Android emulator. Use the
 * host the app already reaches the API on (10.0.2.2 there), keeping LiveKit's port.
 */
export function reachable(url: string): string {
  if (!__DEV__) return url;
  try {
    const lk = new URL(url), apiHost = new URL(config.apiUrl).hostname;
    if ((lk.hostname === 'localhost' || lk.hostname === '127.0.0.1') && apiHost !== 'localhost' && apiHost !== '127.0.0.1') return url.replace(lk.hostname, apiHost);
  } catch { /* not a URL we can read: use it as it is */ }
  return url;
}

/** Android asks at run time; iOS asks by itself the first time the microphone or camera starts. */
export async function askPermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const want = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
  try {
    const r = await PermissionsAndroid.requestMultiple(want);
    return r[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
  } catch { return false; }
}

function deviceError(e: unknown) {
  const n = (e as Error)?.name;
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') return 'YaysApp can’t use your microphone or camera. Allow them in Settings, then try again.';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'No microphone or camera found.';
  if (n === 'NotReadableError') return 'Your microphone or camera is being used by another app.';
  return 'Could not use your microphone or camera.';
}
