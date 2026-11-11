/* Native modules have no simulator here, so they get small in-memory stand-ins. */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-keychain', () => {
  const store = new Map();
  return {
    ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AfterFirstUnlockThisDeviceOnly' },
    getGenericPassword: jest.fn(async ({ service }) => (store.has(service) ? { username: 'session', password: store.get(service) } : false)),
    setGenericPassword: jest.fn(async (_u, p, { service }) => { store.set(service, p); return true; }),
    resetGenericPassword: jest.fn(async ({ service }) => store.delete(service)),
    __store: store,
  };
});
jest.mock('react-native-image-crop-picker', () => ({ openPicker: jest.fn(), openCamera: jest.fn() }));
jest.mock('react-native-video', () => {
  const React = require('react');
  const Video = React.forwardRef((props, ref) => { React.useImperativeHandle(ref, () => ({ seek: jest.fn() })); return React.createElement('Video', props); });
  return { __esModule: true, default: Video };
});
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(), keepLocalCopy: jest.fn(async ({ files }) => files.map((f) => ({ status: 'success', localUri: f.uri, sourceUri: f.uri }))),
  isErrorWithCode: () => false, errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' }, types: {},
}));
jest.mock('react-native-audio-recorder-player', () => {
  /** A recorder that tests drive: tick(ms, dB) as if time passed; stop returns the file set in __next. */
  const rec = { listener: null, __next: '' };
  class AudioRecorderPlayer {
    startRecorder = jest.fn(async () => 'file:///voice.m4a');
    addRecordBackListener = jest.fn((cb) => { rec.listener = cb; });
    removeRecordBackListener = jest.fn(() => { rec.listener = null; });
    stopRecorder = jest.fn(async () => rec.__next);
  }
  return { __esModule: true, default: AudioRecorderPlayer, __rec: rec, AudioEncoderAndroidType: { AAC: 3 }, AudioSourceAndroidType: { MIC: 1 }, AVEncoderAudioQualityIOSType: { high: 96 }, AVEncodingOption: { aac: 'aac' }, OutputFormatAndroidType: { MPEG_4: 2 } };
});
jest.mock('@react-native-clipboard/clipboard', () => require('@react-native-clipboard/clipboard/jest/clipboard-mock.js'));

// Calls: no WebRTC here. A LiveKit room that connects at once and remembers what this phone sends; tests reach the
// last room through __rooms to check it.
jest.mock('@livekit/react-native', () => {
  const React = require('react');
  const outputs = { list: ['speaker', 'earpiece'], selected: [] };
  return {
    registerGlobals: jest.fn(),
    AudioSession: {
      startAudioSession: jest.fn(async () => {}), stopAudioSession: jest.fn(async () => {}),
      getAudioOutputs: jest.fn(async () => outputs.list), selectAudioOutput: jest.fn(async (o) => { outputs.selected.push(o); }),
      configureAudio: jest.fn(async () => {}), showAudioRoutePicker: jest.fn(async () => {}),
    },
    VideoView: (props) => React.createElement('VideoView', props),
    __outputs: outputs,
  };
});
jest.mock('livekit-client', () => {
  const { EventEmitter } = require('events');
  const rooms = [];
  // Event names as LiveKit spells them: RoomEvent.ConnectionStateChanged is 'connectionStateChanged'.
  const RoomEvent = new Proxy({}, { get: (_t, k) => String(k)[0].toLowerCase() + String(k).slice(1) });
  const ConnectionState = { Connected: 'connected', Connecting: 'connecting', Reconnecting: 'reconnecting', SignalReconnecting: 'signalReconnecting', Disconnected: 'disconnected' };
  const Track = { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' } };
  class Participant {
    constructor(identity, isLocal) { this.identity = identity; this.name = identity; this.isLocal = isLocal; this.isSpeaking = false; this.connectionQuality = 'good'; this.isMicrophoneEnabled = false; this.isCameraEnabled = false; this.pubs = {}; }
    getTrackPublication(source) { return this.pubs[source]; }
  }
  class LocalParticipant extends Participant {
    constructor(room) { super('', true); this.room = room; }
    async setMicrophoneEnabled(on) { this.isMicrophoneEnabled = on; this.room.emit('localTrackPublished'); }
    async setCameraEnabled(on, opts) {
      this.isCameraEnabled = on;
      this.pubs.camera = on ? { isMuted: false, track: { kind: 'video', facingMode: opts && opts.facingMode, restartTrack: jest.fn(async function (o) { this.facingMode = o.facingMode; }) } } : undefined;
      this.room.emit('localTrackPublished');
    }
  }
  class Room extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.remoteParticipants = new Map(); this.localParticipant = new LocalParticipant(this); this.state = 'disconnected'; rooms.push(this); }
    async connect(url, token) { this.url = url; this.token = token; this.state = 'connected'; this.emit('connectionStateChanged', 'connected'); }
    async disconnect() { this.state = 'disconnected'; this.disconnected = true; this.emit('connectionStateChanged', 'disconnected'); }
    /** For tests: someone else's phone joins the room. */
    __join(identity, { video = false } = {}) {
      const p = new Participant(identity, false); p.isMicrophoneEnabled = true;
      if (video) { p.isCameraEnabled = true; p.pubs.camera = { isMuted: false, track: { kind: 'video' } }; }
      this.remoteParticipants.set(identity, p); this.emit('participantConnected', p); return p;
    }
  }
  return { Room, RoomEvent, ConnectionState, ConnectionQuality: { Excellent: 'excellent', Good: 'good', Poor: 'poor', Lost: 'lost' }, Track, __rooms: rooms };
});
