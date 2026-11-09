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
