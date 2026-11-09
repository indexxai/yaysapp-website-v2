import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { Oval } from './Oval';
import { Text } from './Text';

export type TabName = 'Chats' | 'Calls' | 'Circles' | 'Explore' | 'Me';
export const TABS: Array<{ name: TabName; icon: IconName }> = [
  { name: 'Chats', icon: 'chats' }, { name: 'Calls', icon: 'phone' }, { name: 'Circles', icon: 'people' }, { name: 'Explore', icon: 'compass' }, { name: 'Me', icon: 'person-circle' },
];

/** The design's bottom bar: five ovals with labels; the current one filled in ember; counts on the others. */
export function TabBar({ state, navigation, badges }: BottomTabBarProps & { badges: Partial<Record<TabName, { n: number; label: string }>> }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { backgroundColor: t.ground, borderTopColor: t.line, paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((r, i) => {
        const tab = TABS.find((x) => x.name === r.name)!;
        const on = state.index === i;
        const badge = badges[tab.name];
        const press = () => {
          const e = navigation.emit({ type: 'tabPress', target: r.key, canPreventDefault: true });
          if (!on && !e.defaultPrevented) navigation.navigate(r.name);
        };
        return (
          <Pressable key={r.key} onPress={press} accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`tab-${tab.name}`}
            accessibilityLabel={badge?.n && !on ? `${tab.name}, ${badge.label}` : tab.name} style={styles.tab} hitSlop={4}>
            <Oval width={40} fill={on ? t.ember : t.surface}><Icon name={tab.icon} size={20} color={on ? t['on-ember'] : t['ink-soft']} /></Oval>
            <Text style={[styles.label, { color: on ? t['ember-ink'] : t['ink-soft'] }]} numberOfLines={1}>{tab.name}</Text>
            {badge?.n && !on ? (
              <View style={[styles.badge, { backgroundColor: t.ember, borderColor: t.ground }]}>
                <Text style={styles.badgeText}>{badge.n > 99 ? '99+' : badge.n}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: 8, paddingHorizontal: 4, borderTopWidth: 1 },
  tab: { flex: 1, alignItems: 'center', gap: 4 },
  label: { fontFamily: 'Outfit', fontWeight: '700', fontSize: 11, lineHeight: 14 },
  badge: { position: 'absolute', top: -6, left: '50%', marginLeft: 8, minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontFamily: 'Outfit', fontWeight: '800', fontSize: 11, lineHeight: 13 },
});
