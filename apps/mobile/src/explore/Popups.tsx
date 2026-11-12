import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BonusCampaign, CheckinStatus, MeProfile } from '@yays/shared';
import { api } from '../lib/api';
import { font, useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Banner as ErrorBanner, OvalButton, TextLink } from '../ui/kit';
import { Oval } from '../ui/Oval';
import { Text } from '../ui/Text';
import { BRAND, CheckinWeek, TaskList, errText, fmtPoints, timeLeft } from './common';

/** A pop-up card over the dimmed app, from the bottom (p17, p25, p26). */
function PopCard({ onClose, children, testID }: { onClose: () => void; children: React.ReactNode; testID?: string }) {
  const t = useTheme();
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Later" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: t.ground, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden', maxHeight: '90%' }} testID={testID}>
        <ScrollView bounces={false}>{children}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/* ---------------------------------------------------------------- daily check-in (p17, p18) */

export function CheckinPopup({ first, status, onClose, onEarn }: { first: string; status: CheckinStatus; onClose: (claimed: boolean) => void; onEarn?: () => void }) {
  const t = useTheme();
  const [s, setS] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = s.claimedToday;
  const later = () => { if (!done) void api().then((a) => a.dismissPopup('checkin')).catch(() => undefined); onClose(done); };
  const claim = async () => {
    setBusy(true); setError(null);
    try { setS(await (await api()).claimCheckin()); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <PopCard onClose={later} testID="checkin-popup">
      <View style={{ backgroundColor: t.ember, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 20, gap: 4, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', width: 240, height: 220, borderRadius: 200, top: -110, right: -70, backgroundColor: t['ember-light'], opacity: 0.5 }} />
        <Image source={BRAND.coin} style={{ position: 'absolute', right: 20, top: 18, width: 76, height: 76 }} resizeMode="contain" />
        <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: '#fff' }}>Daily check-in · Day {s.dayOfWeek}</Text>
        <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 40, lineHeight: 48, color: '#fff' }}>+{s.todayPoints} INEX</Text>
        <Text style={{ fontSize: 13, color: '#fff' }}>{done ? `New balance: ${fmtPoints(s.balance)} INEX` : `Balance after claim: ${fmtPoints(s.balance + s.todayPoints)}`}</Text>
      </View>
      <View style={{ padding: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          {done ? <Oval width={44} fill={t['success-wash']}><Icon name="check" size={22} color={t['success-ink']} /></Oval> : null}
          <View style={{ flex: 1, gap: 4 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 22, color: t.ink }}>{done ? `+${s.todayPoints} INEX added` : `Welcome back, ${first}`}</Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: t['ink-soft'] }}>{done ? `That’s a ${s.streak}-day streak.` : s.streak ? `You’re on a ${s.streak}-day streak. Claim today’s INEX to keep it going.` : 'Claim today’s INEX to start a streak.'}</Text>
          </View>
        </View>
        <CheckinWeek status={s} />
        <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 16, backgroundColor: t['ember-wash'] }}>
          <Icon name="gift" size={16} color={t['ember-ink']} />
          <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: t.ink }}>
            {s.dayOfWeek < 7 ? <>Come back tomorrow for <Text style={{ fontWeight: '800' }}>+{s.tomorrowPoints}</Text>{s.dayOfWeek === 6 ? <Text style={{ fontWeight: '800' }}> (Day 7 bonus)</Text> : null}. </> : 'That completes your week. '}Missing a day restarts the streak.
          </Text>
        </View>
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
          {done ? (
            <>
              {onEarn ? <OvalButton icon="star" label="More ways to earn" variant="soft" onPress={() => { onClose(true); onEarn(); }} /> : null}
              <OvalButton icon="check" label="Done" size="lg" onPress={() => onClose(true)} />
            </>
          ) : (
            <>
              <OvalButton icon="clock" label="Later" variant="ghost" onPress={later} />
              <OvalButton icon="gift" label={`Claim +${s.todayPoints}`} size="lg" loading={busy} onPress={() => void claim()} />
            </>
          )}
        </View>
        <Text style={{ fontSize: 12, color: t['ink-soft'], textAlign: 'center' }}>This shows once a day, on any device.</Text>
      </View>
    </PopCard>
  );
}

/* ---------------------------------------------------------------- bonus campaigns (p25 Jack, p26 BTCY) */

export function BonusPopup({ first, bonus: b, onClose, onGo, onEarn }: { first: string; bonus: BonusCampaign; onClose: () => void; onGo: (where: 'ai' | 'btcy' | 'indexx') => void; onEarn: () => void }) {
  const t = useTheme();
  const [noMore, setNoMore] = useState(false);
  const jack = b.product === 'jack';
  const later = () => { void api().then((a) => a.dismissPopup(noMore ? 'bonuses' : b.id)).catch(() => undefined); onClose(); };
  const go = () => { if (noMore) void api().then((a) => a.dismissPopup('bonuses')).catch(() => undefined); onClose(); onGo(jack ? 'ai' : b.needsLink ? 'indexx' : 'btcy'); };
  const lead = jack
    ? `Welcome back, ${first}. Finish these ${b.tasks.length} tasks with Jack’s AI before midnight and the bonus is yours.`
    : b.needsLink ? `Welcome back, ${first}. Sign in to Indexx and these count from BTCY this week. Each task pays on its own.`
      : `Welcome back, ${first}. Do any of these in BTCY this week. Each one pays on its own.`;
  return (
    <PopCard onClose={later} testID="bonus-popup">
      <View style={{ alignItems: 'center', paddingTop: 18, backgroundColor: t['ember-wash'] }}>
        <Image source={jack ? BRAND.jackBunny : BRAND.btcyCoin} style={{ width: jack ? 150 : 110, height: jack ? 150 : 110, marginBottom: jack ? -6 : 14 }} resizeMode="contain" accessibilityLabel={jack ? 'Jack’s AI' : 'BTCY'} />
      </View>
      <View style={{ padding: 20, gap: 14 }}>
        <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: t['ember-ink'] }}>{b.eyebrow}</Text>
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 26, lineHeight: 32, color: t.ink }}>Earn {jack ? '' : 'up to '}<Text style={{ color: t['ember-ink'] }}>+{b.points}</Text> {jack ? 'bonus INEX' : 'INEX'}</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: t['ink-soft'] }}>{lead}</Text>
        <View style={{ borderRadius: 20, backgroundColor: t.raised, overflow: 'hidden' }}><TaskList tasks={b.tasks} /></View>
        <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 16, backgroundColor: t.sunken }}>
          <Icon name="clock" size={16} color={t['ink-soft']} />
          <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: t.ink }}>Ends in <Text style={{ fontWeight: '800' }}>{timeLeft(b.endsAt)}</Text>. {b.allRequired ? `INEX lands in your wallet when all ${b.tasks.length} are done.` : 'INEX lands in your wallet as each task is done.'}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
          <OvalButton icon="clock" label="Later" variant="ghost" onPress={later} />
          <OvalButton icon={jack ? 'sparkles' : 'bitcoin'} label={jack ? 'Ask Jack now' : b.needsLink ? 'Sign in to Indexx' : 'Open BTCY'} size="lg" onPress={go} />
        </View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: noMore }} accessibilityLabel="Don’t show bonus pop-ups today" onPress={() => setNoMore(!noMore)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
          <Oval width={22} fill={noMore ? t.ember : t.sunken}>{noMore ? <Icon name="check" size={13} color="#fff" /> : null}</Oval>
          <Text style={{ fontSize: 13, color: t['ink-soft'] }}>Don’t show bonus pop-ups today</Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}><TextLink label="See all ways to earn" onPress={() => { onClose(); onEarn(); }} /></View>
      </View>
    </PopCard>
  );
}

/**
 * As the app opens: at most one pop-up (daily check-in, then a bonus), each at most once a day on any device.
 * The server decides; the app asks once per launch.
 */
let askedThisLaunch = false;
export function PopupHost({ me, open }: { me: MeProfile; open: (where: 'ai' | 'btcy' | 'indexx' | 'earn') => void }) {
  const [now, setNow] = useState<{ kind: 'checkin'; checkin: CheckinStatus } | { kind: 'bonus'; bonus: BonusCampaign } | null>(null);
  useEffect(() => {
    if (askedThisLaunch) return;
    askedThisLaunch = true;
    let live = true;
    void api().then((a) => a.popupNow()).then((p) => { if (live && p.kind !== 'none') setNow(p); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (!now) return null;
  const first = me.displayName.split(/\s+/)[0] ?? '';
  const close = () => setNow(null);
  return now.kind === 'checkin'
    ? <CheckinPopup first={first} status={now.checkin} onClose={close} onEarn={() => open('earn')} />
    : <BonusPopup first={first} bonus={now.bonus} onClose={close} onGo={open} onEarn={() => open('earn')} />;
}
/** Tests launch the app many times in one run: on (ask at the next launch) or off (as if already asked). */
export const popupsForTests = (on: boolean) => { askedThisLaunch = !on; };
