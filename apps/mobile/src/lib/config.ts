import { Platform } from 'react-native';
// Development default: the API on this computer. Android emulators reach the host as 10.0.2.2.
const devUrl = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
export const config = {
  apiUrl: (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL ?? (__DEV__ ? devUrl : 'https://api.yays.app'),
  appVersion: '2.0.0',
};
