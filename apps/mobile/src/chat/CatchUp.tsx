import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import type { AiSummary, ConversationSummary } from '@yays/shared';
import { api } from '../lib/api';
import { useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { OvalButton, TextLink } from '../ui/kit';
import { Text } from '../ui/Text';
import { Sheet } from '../circles/common';
import { BRAND, errText } from '../explore/common';

/**
 * "Catch up" in a chat (p03, p04): asks once per chat before Jack's AI reads it, then shows a short summary above the
 * messages. Same rules as the web: the last 200 messages' text, names and times; nothing else, and not for training.
 */
export function CatchUp({ c, onClose }: { c: ConversationSummary; onClose: () => void }) {
  const t = useTheme();
  const [step, setStep] = useState<'ask' | 'busy' | 'done'>('busy');
  const [s, setS] = useState<AiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = c.group?.name ?? c.peer?.displayName ?? 'this chat';
  const run = async () => { setStep('busy'); setError(null); try { setS(await (await api()).aiSummarize(c.id)); } catch (e) { setError(errText(e)); } setStep('done'); };
  useEffect(() => {
    void api().then((a) => a.aiConsent(c.id)).then((r) => (r.consent ? run() : setStep('ask')), (e) => { setError(errText(e)); setStep('done'); });
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (step === 'ask') {
    return (
      <Sheet title="Let Jack’s AI read this chat?" onClose={onClose} testID="catchup-consent">
        <Text style={{ fontSize: 14, lineHeight: 21, color: t.ink }}>To summarise, Jack’s AI needs the last 200 messages from <Text style={{ fontWeight: '800' }}>{name}</Text>. They are used for this answer only and are not used to train AI.</Text>
        <View style={{ gap: 8, padding: 12, borderRadius: 16, backgroundColor: t.raised }}>
          <View style={{ flexDirection: 'row', gap: 10 }}><Icon name="check" size={18} color={t['success-ink']} /><Text style={{ flex: 1, color: t.ink }}>Sent: message text, names and times</Text></View>
          <View style={{ flexDirection: 'row', gap: 10 }}><Icon name="close" size={18} color={t['danger-ink']} /><Text style={{ flex: 1, color: t.ink }}>Not sent: photos, voice notes, phone numbers</Text></View>
        </View>
        <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{c.kind === 'group' ? 'Group members are not told. ' : ''}You can turn this off any time from this chat.</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
          <OvalButton icon="close" label="Not now" variant="ghost" onPress={onClose} />
          <OvalButton icon="sparkles" label="Allow and summarise" size="lg" onPress={() => void api().then((a) => a.aiSetConsent(c.id, true)).then(run, (e) => { setError(errText(e)); setStep('done'); })} />
        </View>
      </Sheet>
    );
  }
  return (
    <View accessibilityRole="summary" testID="catchup" style={{ flexDirection: 'row', gap: 10, marginHorizontal: 10, marginVertical: 6, padding: 12, borderRadius: 18, backgroundColor: t['ember-wash'] }}>
      <Image source={BRAND.jack} style={{ width: 28, height: 28 }} resizeMode="contain" />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontWeight: '800', color: t.ink }}>{step === 'busy' ? 'Jack is reading the chat…' : error ? 'Couldn’t summarise' : `Summary of ${s!.count} message${s!.count === 1 ? '' : 's'}`}</Text>
        {step === 'busy' ? <ActivityIndicator size="small" color={t.ember} style={{ alignSelf: 'flex-start' }} /> : <Text style={{ fontSize: 14, lineHeight: 20, color: t.ink }}>{error ?? s!.text}</Text>}
        {step === 'done' && !error ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 12, color: t['ink-soft'] }}>AI summary · may miss details ·</Text>
            <TextLink label="Stop letting Jack read this chat" onPress={() => { void api().then((a) => a.aiSetConsent(c.id, false)).catch(() => undefined); onClose(); }} />
          </View>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Close summary" onPress={onClose} hitSlop={10}><Icon name="close" size={16} color={t['ink-soft']} /></Pressable>
    </View>
  );
}
