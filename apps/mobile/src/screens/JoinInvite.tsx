import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, type CommunityInvitePreview, type InvitePreview } from '@yays/shared';
import { api } from '../lib/api';
import { useEngine } from '../lib/chat';
import { font, useTheme } from '../lib/theme';
import { Avatar, Banner, OvalButton } from '../ui/kit';
import { LineArt } from '../ui/LineArt';
import { Text } from '../ui/Text';
import { CircleMark, Header, Note } from '../circles/common';

const errText = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);

/**
 * An invite link opened on the phone (m52): a group (yaysapp…/join/CODE) or a circle (…/c/CODE). See what it is,
 * then join, or ask to join when its admins approve new members.
 */
export function JoinInviteScreen({ kind, code, onBack, openChat, openCircle }: { kind: 'group' | 'circle'; code: string; onBack: () => void; openChat: (id: string) => void; openCircle: (id: string) => void }) {
  const t = useTheme();
  const engine = useEngine();
  const [g, setG] = useState<InvitePreview | null>(null);
  const [c, setC] = useState<CommunityInvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      if (kind === 'group') setG(await engine.invitePreview(code));
      else setC(await (await api()).previewCommunityInvite(code));
      setError(null);
    } catch (e) { setError(errText(e, 'Could not open this invite. Check your connection.')); }
  }, [kind, code, engine]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(errText(e, 'That did not work. Try again.')); } finally { setBusy(false); } };
  const p = g ?? c;
  const group = kind === 'group';
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="join-invite">
      <LineArt name="hype" height={220} />
      <Header back="Back" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, alignItems: 'center' }}>
        {error ? <View style={{ alignSelf: 'stretch' }}><Banner>{error}</Banner></View> : null}
        {!p && !error ? <ActivityIndicator color={t.ember} style={{ marginTop: 40 }} /> : null}
        {!p && error ? <OvalButton icon="refresh" label="Try again" variant="soft" onPress={() => void load()} /> : null}
        {p ? (
          <>
            {group ? <Avatar name={p.name} photoUrl={p.photoUrl} size={96} /> : <CircleMark c={{ id: c!.id, name: c!.name, photoUrl: c!.photoUrl }} size={96} />}
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 26, lineHeight: 32, color: t.ink, textAlign: 'center' }}>{p.name}</Text>
            <Text style={{ fontSize: 14, color: t['ink-soft'], textAlign: 'center' }}>
              {group ? `Group · ${p.memberCount.toLocaleString()} member${p.memberCount === 1 ? '' : 's'}` : `Circle · ${p.memberCount.toLocaleString()} member${p.memberCount === 1 ? '' : 's'} · ${c!.groupCount} chat${c!.groupCount === 1 ? '' : 's'}`}
            </Text>
            {p.about ? <Text style={{ fontSize: 15, lineHeight: 22, color: t.ink, textAlign: 'center' }}>{p.about}</Text> : null}
            <View style={{ alignSelf: 'stretch' }}><Note icon="eye" tone="plain">Members will see your name and profile photo. Your phone number stays hidden unless they’re in your contacts.</Note></View>
            {p.alreadyMember ? (
              <OvalButton icon={group ? 'chat' : 'people'} label={group ? 'Open chat' : 'Open circle'} size="lg" onPress={() => (group ? openChat(g!.conversationId) : openCircle(c!.id))} />
            ) : p.requested ? (
              <>
                <View style={{ alignSelf: 'stretch' }}><Banner tone="success">Your request was sent. An admin will let you in.</Banner></View>
                <OvalButton icon="close" label="Cancel request" variant="ghost" loading={busy} onPress={() => void act(async () => { if (group) await engine.cancelJoinRequest(code); else await (await api()).cancelCommunityRequest(code); await load(); })} />
              </>
            ) : (
              <>
                {p.needsApproval ? <Text style={{ fontSize: 13, color: t['ink-soft'] }}>An admin approves new members.</Text> : null}
                <View style={{ flexDirection: 'row', gap: 36 }}>
                  <OvalButton icon="close" label="Not now" size="lg" variant="ghost" onPress={onBack} />
                  <OvalButton icon={p.needsApproval ? 'person-add' : 'check'} label={p.needsApproval ? 'Ask to join' : group ? 'Join group' : 'Join circle'} size="lg" loading={busy}
                    onPress={() => void act(async () => {
                      if (group) { const r = await engine.joinInvite(code); if (r.status === 'joined') openChat(r.conversation.id); else await load(); }
                      else { const r = await (await api()).joinCommunity(code); if (r.status === 'joined') openCircle(r.community.id); else await load(); }
                    })} />
                </View>
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
