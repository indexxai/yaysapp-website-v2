/**
 * @format
 */

import {AppRegistry} from 'react-native';
import {registerGlobals} from '@livekit/react-native';
import App from './App';
import {name as appName} from './app.json';

// Calls: WebRTC for LiveKit, before anything uses it.
registerGlobals();

AppRegistry.registerComponent(appName, () => App);
