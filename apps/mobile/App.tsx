import React from 'react';
import { ActivityIndicator, StatusBar, Text, View } from 'react-native';
import { OvalButton } from './src/ui/kit';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/lib/session';
import { useTheme } from './src/lib/theme';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { DevicesScreen, ProfileSetupScreen, SettingsScreen } from './src/screens/MainScreens';
import { ChatListScreen, ChatScreen, NewChatScreen } from './src/screens/ChatScreens';
import { ChatProvider } from './src/lib/chat';

export type Routes = { Welcome: undefined; SignIn: undefined; ProfileSetup: undefined; Chats: undefined; NewChat: undefined; Chat: { id: string }; Settings: undefined; Devices: undefined };
const Stack = createNativeStackNavigator<Routes>();

function Root() {
  const s = useSession();
  const t = useTheme();
  if (s.state.status === 'loading') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ground }}><ActivityIndicator color={t.ember} /></View>;
  if (s.state.status === 'signedIn' && !s.state.me.id) {
    // First launch after sign-in with no network and nothing saved yet.
    return <OfflineStart retry={s.reload} />;
  }
  const needsProfile = s.state.status === 'signedIn' && s.state.me.pending.includes('profile');
  const me = s.state.status === 'signedIn' ? s.state.me : null;
  const tree = (
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
            <Stack.Screen name="Chats" options={{ headerShown: false }}>{({ navigation }) => <ChatListScreen me={me!} openChat={(id) => navigation.navigate('Chat', { id })} openNewChat={() => navigation.navigate('NewChat')} openSettings={() => navigation.navigate('Settings')} />}</Stack.Screen>
            <Stack.Screen name="NewChat">{({ navigation }) => <NewChatScreen onOpened={(id) => navigation.replace('Chat', { id })} />}</Stack.Screen>
            <Stack.Screen name="Chat" options={{ headerShown: false }}>{({ navigation, route }) => <ChatScreen id={route.params.id} onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Chats'))} />}</Stack.Screen>
            <Stack.Screen name="Settings">{({ navigation }) => <SettingsScreen openDevices={() => navigation.navigate('Devices')} />}</Stack.Screen>
            <Stack.Screen name="Devices" component={DevicesScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
  // The chat engine runs while signed in with a finished profile (and an id: not the offline placeholder).
  return me?.id && !needsProfile ? <ChatProvider me={me.id}>{tree}</ChatProvider> : tree;
}

function OfflineStart({ retry }: { retry: () => Promise<void> }) {
  const t = useTheme();
  const [busy, setBusy] = React.useState(false);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, backgroundColor: t.ground }}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: t.ink, textAlign: 'center' }}>You're offline</Text>
      <Text style={{ fontSize: 15, color: t['ink-soft'], textAlign: 'center' }}>Connect to the internet to load your chats.</Text>
      <OvalButton icon="refresh" label="Try again" loading={busy} onPress={() => { setBusy(true); void retry().finally(() => setBusy(false)); }} />
    </View>
  );
}

export default function App() {
  return <SafeAreaProvider><SessionProvider><Root /></SessionProvider></SafeAreaProvider>;
}
