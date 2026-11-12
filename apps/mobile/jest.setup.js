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

// Sign-in with Google: tests set what Google's sheet returns with __next.
jest.mock('@react-native-google-signin/google-signin', () => {
  const g = { __next: { type: 'cancelled', data: null } };
  return {
    GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(async () => true), signOut: jest.fn(async () => null), signIn: jest.fn(async () => g.__next) },
    isSuccessResponse: (r) => r.type === 'success',
    statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
    __google: g,
  };
});
// The sign-in browser: tests play Facebook with openAuth.
jest.mock('react-native-inappbrowser-reborn', () => ({ InAppBrowser: { isAvailable: jest.fn(async () => true), openAuth: jest.fn(async () => ({ type: 'cancel' })) } }));
// Firebase (Android): not set up unless a test says so.
jest.mock('@react-native-firebase/app', () => ({ getApps: jest.fn(() => []) }));
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})), getToken: jest.fn(async () => 'fcm-test-token-0123456789'), onTokenRefresh: jest.fn(() => () => {}),
  onNotificationOpenedApp: jest.fn(() => () => {}), getInitialNotification: jest.fn(async () => null),
}));
// iPhone notifications: tests answer the permission prompt and send events with __emit.
jest.mock('@react-native-community/push-notification-ios', () => {
  const handlers = {};
  const P = {
    __allow: true, __handlers: handlers, __delivered: [], __removed: [],
    requestPermissions: jest.fn(async () => (P.__allow ? { alert: true, badge: true, sound: true } : { alert: false, badge: false, sound: false })),
    checkPermissions: jest.fn((cb) => cb(P.__allow ? { alert: true, sound: true } : {})),
    addEventListener: jest.fn((type, fn) => { handlers[type] = fn; }),
    removeEventListener: jest.fn((type) => { delete handlers[type]; }),
    getInitialNotification: jest.fn(async () => null),
    getDeliveredNotifications: jest.fn((cb) => cb(P.__delivered)),
    removeDeliveredNotifications: jest.fn((ids) => { P.__removed.push(...ids); }),
    setApplicationIconBadgeNumber: jest.fn(),
    __emit: (type, arg) => handlers[type] && handlers[type](arg),
  };
  return { __esModule: true, default: P };
});
// The phone's call screen (CallKit) and VoIP pushes: tests play the person tapping Answer / End, and Apple's push.
jest.mock('react-native-callkeep', () => {
  const handlers = {};
  const CK = {
    __handlers: handlers, __initial: [], __answered: [], __ended: [], __reportedEnd: [],
    setup: jest.fn(async () => true),
    addEventListener: jest.fn((type, fn) => { handlers[type] = fn; }),
    removeEventListener: jest.fn((type) => { delete handlers[type]; }),
    getInitialEvents: jest.fn(async () => CK.__initial),
    clearInitialEvents: jest.fn(),
    answerIncomingCall: jest.fn((uuid) => { CK.__answered.push(uuid); }),
    endCall: jest.fn((uuid) => { CK.__ended.push(uuid); }),
    reportEndCallWithUUID: jest.fn((uuid) => { CK.__reportedEnd.push(uuid); }),
    __emit: (type, arg) => handlers[type] && handlers[type](arg),
  };
  return { __esModule: true, default: CK };
});
jest.mock('react-native-voip-push-notification', () => {
  const handlers = {};
  const V = {
    RNVoipPushRemoteNotificationsRegisteredEvent: 'RNVoipPushRemoteNotificationsRegisteredEvent',
    addEventListener: jest.fn((type, fn) => { handlers[type] = fn; }),
    removeEventListener: jest.fn((type) => { delete handlers[type]; }),
    registerVoipToken: jest.fn(),
    onVoipNotificationCompleted: jest.fn(),
    __emit: (type, arg) => handlers[type] && handlers[type](arg),
  };
  return { __esModule: true, default: V };
});
// Android's full-screen call notification (Notifee): records what's shown and taken away.
jest.mock('@notifee/react-native', () => {
  const N = {
    __shown: [], __cancelled: [], __bg: null, __fg: null, __initial: null,
    createChannel: jest.fn(async () => 'calls'),
    displayNotification: jest.fn(async (n) => { N.__shown.push(n); return n.id; }),
    cancelNotification: jest.fn(async (id) => { N.__cancelled.push(id); }),
    onBackgroundEvent: jest.fn((fn) => { N.__bg = fn; }),
    onForegroundEvent: jest.fn((fn) => { N.__fg = fn; return () => { N.__fg = null; }; }),
    getInitialNotification: jest.fn(async () => N.__initial),
  };
  return {
    __esModule: true, default: N,
    AndroidImportance: { HIGH: 4 }, AndroidCategory: { CALL: 'call' }, AndroidVisibility: { PUBLIC: 1 },
    EventType: { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 },
  };
});
