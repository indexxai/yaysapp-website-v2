import { Platform } from 'react-native';
// Development default: the API on this computer. Android emulators reach the host as 10.0.2.2.
const devUrl = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
export const config = {
  /** Read when the API client is created, so tests can point the app at another server. */
  get apiUrl() { return (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL ?? (__DEV__ ? devUrl : 'https://api.yays.app'); },
  appVersion: '2.0.0',
  /**
   * Google sign-in (Google Cloud console › Credentials › OAuth client IDs). web: the "Web application" client, the
   * one the API checks (GOOGLE_CLIENT_IDS); Android also needs an "Android" client for com.indexx.yaysapp with the
   * app's SHA-1. ios: the "iOS" client (its reversed id goes in Info.plist). Empty: development sign-in instead.
   */
  google: { webClientId: '', iosClientId: '' },
  /** The app's own links (yaysapp://): Facebook sign-in comes back this way. Same as the API's APP_SCHEME. */
  scheme: 'yaysapp',
  /** The web app, for links people share (group invites). */
  get webUrl() { return __DEV__ ? 'http://localhost:3000' : 'https://yaysapp.com'; },
};
