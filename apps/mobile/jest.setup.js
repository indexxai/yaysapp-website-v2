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
jest.mock('react-native-image-crop-picker', () => ({ openPicker: jest.fn() }));
jest.mock('@react-native-clipboard/clipboard', () => require('@react-native-clipboard/clipboard/jest/clipboard-mock.js'));
