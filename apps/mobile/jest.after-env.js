const { configure } = require('@testing-library/react-native');
// First renders on a cold test run take a few seconds while files are transformed.
configure({ asyncUtilTimeout: 8000 });
