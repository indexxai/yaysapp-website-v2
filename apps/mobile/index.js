/**
 * @format
 */

import {AppRegistry} from 'react-native';
import {registerGlobals} from '@livekit/react-native';
import App from './App';
import {registerBackgroundCallHandlers} from './src/calls/ringing';
import {name as appName} from './app.json';

// Calls: WebRTC for LiveKit, before anything uses it.
registerGlobals();
// Calls ringing while YaysApp is closed (Android): Firebase pushes and the Answer / Decline buttons.
registerBackgroundCallHandlers();

AppRegistry.registerComponent(appName, () => App);
