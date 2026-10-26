import React from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/lib/session';
import { useTheme } from './src/lib/theme';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { ChatsScreen, DevicesScreen, ProfileSetupScreen, SettingsScreen } from './src/screens/MainScreens';

export type Routes = { Welcome: undefined; SignIn: undefined; ProfileSetup: undefined; Chats: undefined; Settings: undefined; Devices: undefined };
const Stack = createNativeStackNavigator<Routes>();

function Root() {
  const s = useSession();
  const t = useTheme();
  if (s.state.status === 'loading') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ground }}><ActivityIndicator color={t.ember} /></View>;
  const needsProfile = s.state.status === 'signedIn' && s.state.me.pending.includes('profile');
  return (
    <NavigationContainer theme={{ ...(t.scheme === 'dark' ? DarkTheme : DefaultTheme), colors: { ...(t.scheme === 'dark' ? DarkTheme : DefaultTheme).colors, background: t.ground, primary: t.ember, card: t.ground, text: t.ink, border: t.line } }}>
      <StatusBar barStyle={t.scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <Stack.Navigator screenOptions={{ headerShadowVisible: false, headerTitle: '', headerBackTitle: 'Back', headerTintColor: t['ember-ink'] }}>
        {s.state.status === 'signedOut' ? (
          <>
            <Stack.Screen name="Welcome" options={{ headerShown: false }}>{({ navigation }) => <WelcomeScreen onStart={() => navigation.navigate('SignIn')} />}</Stack.Screen>
            <Stack.Screen name="SignIn">{() => <SignInScreen onDone={s.signedIn} />}</Stack.Screen>
          </>
        ) : needsProfile ? (
          <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Chats" options={{ headerShown: false }}>{({ navigation }) => <ChatsScreen openSettings={() => navigation.navigate('Settings')} />}</Stack.Screen>
            <Stack.Screen name="Settings">{({ navigation }) => <SettingsScreen openDevices={() => navigation.navigate('Devices')} />}</Stack.Screen>
            <Stack.Screen name="Devices" component={DevicesScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return <SafeAreaProvider><SessionProvider><Root /></SessionProvider></SafeAreaProvider>;
}
