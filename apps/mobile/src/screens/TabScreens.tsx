import React, { type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MeProfile } from '@yays/shared';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar } from '../ui/kit';
import { LineArt, type ArtName } from '../ui/LineArt';
import { Oval } from '../ui/Oval';
import { Text } from '../ui/Text';

/** A tab's page: big title, the art behind, content that scrolls. */
export function TabPage({ title, art, right, children, testID }: { title: string; art: ArtName; right?: ReactNode; children: ReactNode; testID?: string }) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.surface }} testID={testID}>
      <LineArt name={art} />
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.h1, { color: t.ink }]}>{title}</Text>
        {right}
      </View>
      <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, sub, onPress, danger, testID }: { icon: IconName; label: string; sub?: string; onPress: () => void; danger?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.sunken : 'transparent' }]}>
      <Oval width={40} fill={danger ? t['danger-wash'] : t['ember-wash']}><Icon name={icon} size={18} color={danger ? t['danger-ink'] : t['ember-ink']} /></Oval>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: danger ? t['danger-ink'] : t.ink }}>{label}</Text>
        {sub ? <Text style={{ fontSize: 13, color: t['ink-soft'] }} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {!danger ? <Icon name="chevron-right" size={18} color={t['ink-faint']} /> : null}
    </Pressable>
  );
}

/** Me: who you are, then your settings. */
export function MeScreen({ me, open }: { me: MeProfile; open: (screen: 'Profile' | 'Devices' | 'Indexx' | 'Help') => void }) {
  const t = useTheme();
  const s = useSession();
  const logOut = () => Alert.alert('Log out of YaysApp?', 'You can sign in again any time with your phone or email.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: () => void s.signOut() }]);
  return (
    <TabPage title="Me" art="snap" testID="me-screen">
      <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={() => open('Profile')} style={[styles.card, styles.meCard, { backgroundColor: t.raised }]}>
        <Avatar name={me.displayName} photoUrl={me.photoUrl} size={64} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: 'Outfit', fontWeight: '800', fontSize: 20, color: t.ink }} numberOfLines={1}>{me.displayName}</Text>
          {me.username ? <Text style={{ color: t['ink-soft'], fontSize: 14 }}>@{me.username}</Text> : null}
          <Text style={{ color: t['ink-soft'], fontSize: 13 }} numberOfLines={1}>{[me.phone, me.email].filter(Boolean).join(' · ')}</Text>
        </View>
        <Icon name="edit" size={18} color={t['ember-ink']} />
      </Pressable>
      <View style={[styles.card, { backgroundColor: t.raised, padding: 0, overflow: 'hidden' }]}>
        <Row icon="person-circle" label="Profile" sub="Name, photo, username, about" onPress={() => open('Profile')} />
        <Row icon="devices" label="Linked devices" sub="Phones and browsers signed in" onPress={() => open('Devices')} />
        <Row icon="link" label="Indexx account" sub="BTCY, EMMM, ShoperPal, Wall Street and the wallet" onPress={() => open('Indexx')} />
        <Row icon="help" label="Help and support" sub="AI answers, then a person" onPress={() => open('Help')} />
        <Row icon="logout" label="Log out" onPress={logOut} danger />
      </View>
    </TabPage>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
  h1: { fontFamily: 'Outfit', fontWeight: '800', fontSize: 30, lineHeight: 36, letterSpacing: -0.5 },
  body: { paddingHorizontal: 12, paddingBottom: 24, gap: 12 },
  card: { borderRadius: 24, padding: 16, gap: 10 },
  cardTitle: { fontFamily: 'Outfit', fontWeight: '800', fontSize: 18 },
  meCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
});
