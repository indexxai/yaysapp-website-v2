module.exports = {
  /** Fonts in assets/fonts are added to the iOS and Android projects by `npx react-native-asset`. */
  assets: ['./assets/fonts'],
  // iPhone notifications use Apple's push service directly (@react-native-community/push-notification-ios), so the
  // Firebase packages are linked on Android only: on iOS they'd need the whole project built as frameworks.
  dependencies: {
    '@react-native-firebase/app': { platforms: { ios: null } },
    '@react-native-firebase/messaging': { platforms: { ios: null } },
  },
};
