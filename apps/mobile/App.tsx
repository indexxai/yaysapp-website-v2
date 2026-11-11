import React from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { Text } from './src/ui/Text';
import { OvalButton } from './src/ui/kit';
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/lib/session';
import { useTheme } from './src/lib/theme';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { DevicesScreen, ProfileSetupScreen, SettingsScreen } from './src/screens/MainScreens';
import { ArchivedScreen, ChatListScreen, ChatScreen, ForwardScreen, MessageInfoScreen, NewChatScreen } from './src/screens/ChatScreens';
import { ChatProvider, useChatState } from './src/lib/chat';
import { ComingScreen, MeScreen } from './src/screens/TabScreens';
import { AddMembersScreen, ChatInfoScreen, NewGroupScreen } from './src/chat/InfoScreens';
import { NewPollScreen } from './src/chat/PollParts';
import { SearchScreen } from './src/chat/ListParts';
import { TabBar, type TabName } from './src/ui/TabBar';
import { CallLayer, CallsProvider } from './src/calls/Calls';
import { CallsScreen } from './src/calls/CallsTab';
import { useClearBadgeOnOpen, usePushNotifications, type PushData } from './src/lib/push';
import type { MeProfile } from '@yays/shared';

export type Routes = { Welcome: undefined; SignIn: undefined; ProfileSetup: undefined; Tabs: undefined; NewChat: undefined; Chat: { id: string }; Forward: { conversationId: string; messageId: string }; MessageInfo: { conversationId: string; messageId: string }; NewGroup: undefined; Search: undefined; Archived: undefined; ChatInfo: { id: string }; AddMembers: { id: string }; NewPoll: { conversationId: string }; Profile: undefined; Devices: undefined };
const Stack = createNativeStackNavigator<Routes>();
/** For the call screens, which sit above the navigator: "Message" on a ringing call opens its chat. */
const navRef = createNavigationContainerRef<Routes>();
const openChatFromCall = (id: string, tries = 0) => {
  if (navRef.isReady()) navRef.navigate('Chat', { id });
  else if (tries < 25) setTimeout(() => openChatFromCall(id, tries + 1), 200); // a tap that launched the app: wait for the screens
};
/** A tapped notification: its chat. A ringing call needs nothing here: opening the app shows the ring. */
const openFromPush = (d: PushData) => { if (d.type === 'message' && d.conversationId) openChatFromCall(d.conversationId); };
function Notifications() {
  usePushNotifications(openFromPush);
  useClearBadgeOnOpen();
  return null;
}
const Tab = createBottomTabNavigator<Record<TabName, undefined>>();
type Nav = NativeStackNavigationProp<Routes>;

/** Chats, Calls, Circles, Explore and Me, with the bar from the design. */
function Tabs({ me }: { me: MeProfile }) {
  const nav = useNavigation<Nav>();
  const s = useChatState();
  const unread = s.order.filter((id) => { const c = s.conversations[id]; return c && (c.unread > 0 || c.markedUnread) && !c.archived && !(c.mutedUntil && Date.parse(c.mutedUntil) > Date.now()); }).length;
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(p) => <TabBar {...p} badges={{ Chats: { n: unread, label: `${unread} unread chat${unread === 1 ? '' : 's'}` }, Calls: { n: s.missedCalls, label: `${s.missedCalls} missed call${s.missedCalls === 1 ? '' : 's'}` } }} />}>
      <Tab.Screen name="Chats">{() => <ChatListScreen me={me} openChat={(id) => nav.navigate('Chat', { id })} openNewChat={() => nav.navigate('NewChat')} openNewGroup={() => nav.navigate('NewGroup')} openSearch={() => nav.navigate('Search')} openArchived={() => nav.navigate('Archived')} />}</Tab.Screen>
      <Tab.Screen name="Calls">{() => <CallsScreen openChat={(id) => nav.navigate('Chat', { id })} />}</Tab.Screen>
      <Tab.Screen name="Circles">{() => <ComingScreen title="Circles" art="hype" icon="people" lines={['Communities for the things you love: posts, events and people near you.', 'Circles already work on YaysApp for the web.']} />}</Tab.Screen>
      <Tab.Screen name="Explore">{() => <ComingScreen title="Explore" art="explorer" icon="compass" lines={['Jack’s AI, daily check-in, INEX rewards, your wallet and the Indexx products.', 'All of it already works on YaysApp for the web.']} />}</Tab.Screen>
      <Tab.Screen name="Me">{() => <MeScreen me={me} open={(r) => nav.navigate(r)} />}</Tab.Screen>
    </Tab.Navigator>
  );
}

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
    <NavigationContainer ref={navRef} theme={{ ...(t.scheme === 'dark' ? DarkTheme : DefaultTheme), colors: { ...(t.scheme === 'dark' ? DarkTheme : DefaultTheme).colors, background: t.ground, primary: t.ember, card: t.ground, text: t.ink, border: t.line } }}>
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
            <Stack.Screen name="Tabs" options={{ headerShown: false }}>{() => <Tabs me={me!} />}</Stack.Screen>
            <Stack.Screen name="NewChat">{({ navigation }) => <NewChatScreen onOpened={(id) => navigation.replace('Chat', { id })} />}</Stack.Screen>
            <Stack.Screen name="Chat" options={{ headerShown: false }}>{({ navigation, route }) => <ChatScreen id={route.params.id} onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs'))}
              openForward={(conversationId, messageId) => navigation.navigate('Forward', { conversationId, messageId })} openInfo={(conversationId, messageId) => navigation.navigate('MessageInfo', { conversationId, messageId })}
              openChatInfo={() => navigation.navigate('ChatInfo', { id: route.params.id })} openNewPoll={() => navigation.navigate('NewPoll', { conversationId: route.params.id })} />}</Stack.Screen>
            <Stack.Screen name="Search">{({ navigation }) => <SearchScreen openChat={(id) => navigation.replace('Chat', { id })} />}</Stack.Screen>
            <Stack.Screen name="Archived">{({ navigation }) => <ArchivedScreen me={me!} openChat={(id) => navigation.navigate('Chat', { id })} />}</Stack.Screen>
            <Stack.Screen name="NewGroup">{({ navigation }) => <NewGroupScreen onCreated={(id) => navigation.replace('Chat', { id })} />}</Stack.Screen>
            <Stack.Screen name="ChatInfo">{({ navigation, route }) => <ChatInfoScreen id={route.params.id} openChat={(id) => navigation.push('Chat', { id })} openAddMembers={() => navigation.navigate('AddMembers', { id: route.params.id })} onLeft={() => navigation.popToTop()} />}</Stack.Screen>
            <Stack.Screen name="AddMembers">{({ navigation, route }) => <AddMembersScreen id={route.params.id} onDone={() => navigation.goBack()} />}</Stack.Screen>
            <Stack.Screen name="NewPoll">{({ navigation, route }) => <NewPollScreen conversationId={route.params.conversationId} onDone={() => navigation.goBack()} />}</Stack.Screen>
            <Stack.Screen name="Forward">{({ navigation, route }) => <ForwardScreen {...route.params} onDone={(to) => (to ? navigation.replace('Chat', { id: to }) : navigation.goBack())} />}</Stack.Screen>
            <Stack.Screen name="MessageInfo">{({ route }) => <MessageInfoScreen {...route.params} />}</Stack.Screen>
            <Stack.Screen name="Profile">{({ navigation }) => <SettingsScreen openDevices={() => navigation.navigate('Devices')} />}</Stack.Screen>
            <Stack.Screen name="Devices" component={DevicesScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
  // The chat engine runs while signed in with a finished profile (and an id: not the offline placeholder).
  // Calls ride on the chat engine's connection: rings and updates arrive with the messages.
  return me?.id && !needsProfile ? <ChatProvider me={me.id}><CallsProvider><Notifications /><View style={{ flex: 1 }}>{tree}<CallLayer openChat={openChatFromCall} /></View></CallsProvider></ChatProvider> : tree;
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
