import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { SOCIAL_NETWORKS, type SocialLink, type SocialNetwork, type SocialsView } from '@yays/shared';
import { api } from '../lib/api';
import { useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Oval } from '../ui/Oval';
import { Banner, Field, OvalButton } from '../ui/kit';
import { Text } from '../ui/Text';
import { Sheet } from '../circles/common';
import { facebookReturn } from '../screens/SocialSignIn';
import { Choice, errText, socialFill, Group, SettingsPage, SocialChips, SOCIAL, SwitchRow, useSaved } from './ui';

/** What Facebook's page sent the phone back with (yaysapp://settings/facebook?fb=…). */
const BACK: Record<string, ['success' | 'danger' | 'warning', string]> = {
  linked: ['success', 'Facebook linked. It shows on your profile, and you can use it to sign in if you turned that on.'],
  taken: ['danger', 'That Facebook account is already linked to another YaysApp account.'],
  cancelled: ['warning', 'Facebook linking was cancelled. Nothing changed.'],
  error: ['danger', 'Facebook didn’t confirm. Try again.'],
  expired: ['danger', 'That took too long. Try linking Facebook again.'],
};
const param = (url: string, k: string) => { const m = new RegExp(`[?&]${k}=([^&#]*)`).exec(url); return m ? decodeURIComponent(m[1]!) : null; };
const VIS: Array<[SocialsView['visibility'], string]> = [['everyone', 'Everyone'], ['contacts', 'My contacts'], ['nobody', 'Nobody']];
export const visibilityText = (v: SocialsView['visibility']) => (v === 'everyone' ? 'Anyone who opens your profile sees these.' : v === 'contacts' ? 'Your contacts see these. Others see your name and photo only.' : 'Hidden from everyone. Only you see them here.');

/** p27–p30, p34: Facebook (confirmed through Facebook), other socials by username, and who sees them. */
export function SocialsScreen({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const saved = useSaved();
  const [d, setD] = useState<SocialsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SocialNetwork | null>(null);
  const [linking, setLinking] = useState(false);
  const [back, setBack] = useState<['success' | 'danger' | 'warning', string] | null>(null);
  const load = async () => { try { setD(await (await api()).socials()); setError(null); } catch (e) { setError(errText(e, 'Could not load your socials.')); } };
  useEffect(() => { void load(); }, []);
  const run = async (fn: () => Promise<SocialsView>, ok: string) => { setBack(null); try { setD(await fn()); saved.ok(ok); } catch (e) { saved.fail(errText(e)); } };
  const fb = d?.facebook ?? null;
  const others = d?.links.filter((l) => l.network !== 'facebook') ?? [];
  return (
    <SettingsPage title="Social accounts" onBack={onBack} art="hype" testID="socials-screen">
      {back ? <Banner tone={back[0]}>{back[1]}</Banner> : null}
      {saved.banner}
      {error ? <Banner>{error}</Banner> : null}
      <Text style={{ fontSize: 14, lineHeight: 20, color: t['ink-soft'], marginHorizontal: 6 }}>Link your socials to show them on your profile. Linking Facebook also lets you sign in with it.</Text>
      {!d && !error ? <ActivityIndicator color={t.ember} /> : null}
      {d ? (
        <>
          <Group title="Social accounts">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }} testID="facebook-row">
              <Oval width={40} fill={SOCIAL.facebook.fill}><Icon name="facebook" size={18} color="#ffffff" /></Oval>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 15, color: t.ink }}>Facebook</Text>
                <Text style={{ fontSize: 13, color: fb ? t['success-ink'] : t['ink-soft'], fontWeight: fb ? '700' : '400' }}>{fb ? `${fb.name} · verified` : !d.facebookAvailable ? 'Not set up on this server yet' : 'Not linked'}</Text>
              </View>
              {fb ? <OvalButton icon="close" label="Unlink" size="sm" variant="ghost" onPress={() => void run(async () => (await api()).unlinkFacebook(), 'Facebook unlinked.')} />
                : <OvalButton icon="link" label="Link" size="sm" disabled={!d.facebookAvailable} onPress={() => setLinking(true)} />}
            </View>
            {SOCIAL_NETWORKS.map((n) => {
              const l = others.find((x) => x.network === n);
              return (
                <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Oval width={40} fill={socialFill(SOCIAL[n].fill, t.scheme)}><Icon name={SOCIAL[n].icon} size={18} color="#ffffff" /></Oval>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', fontSize: 15, color: t.ink }}>{SOCIAL[n].name}</Text>
                    <Text style={{ fontSize: 13, color: l ? t['ember-ink'] : t['ink-soft'] }} onPress={l?.url ? () => void Linking.openURL(l.url!).catch(() => undefined) : undefined}>{l ? l.handle : 'Not added'}</Text>
                  </View>
                  {l ? <OvalButton icon="close" label="Remove" accessibilityLabel={`Remove ${SOCIAL[n].name}`} size="sm" variant="ghost" onPress={() => void run(async () => (await api()).removeSocial(n), `${SOCIAL[n].name} removed.`)} />
                    : <OvalButton icon="plus" label="Add" accessibilityLabel={`Add ${SOCIAL[n].name}`} size="sm" variant="soft" onPress={() => setEditing(n)} />}
                </View>
              );
            })}
          </Group>
          <Group title="Sign in with Facebook">
            <SwitchRow label="Sign in with Facebook" disabled={!fb} on={!!fb?.login}
              hint={fb ? (fb.login ? 'On. Use “Continue with Facebook” when you sign in. Your two-step PIN is still asked.' : 'Off. Only your phone number and email sign you in.') : 'Link Facebook first.'}
              onChange={(on) => void run(async () => (await api()).facebookLogin(on), on ? 'You can sign in with Facebook.' : 'Signing in with Facebook is off.')} />
          </Group>
          <Group title="Who can see my socials">
            <Choice value={d.visibility} options={VIS} onChange={(v) => void run(async () => (await api()).socialVisibility(v), 'Saved.')} />
          </Group>
          {d.links.length ? (
            <Group title="How your profile shows them">
              <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
                <SocialChips links={d.links} />
                <Text style={{ fontSize: 13, color: t['ink-soft'] }}>{visibilityText(d.visibility)} The tick means it was confirmed through that network.</Text>
              </View>
            </Group>
          ) : null}
        </>
      ) : null}
      {editing ? <AddSocial network={editing} onClose={() => setEditing(null)} onSaved={(x) => { const n = editing; setD(x); setEditing(null); saved.ok(`${SOCIAL[n].name} added.`); }} /> : null}
      {linking ? <LinkFacebook onClose={() => setLinking(false)} onBack={(k) => { setLinking(false); setBack(BACK[k] ?? BACK.error!); void load(); }} /> : null}
    </SettingsPage>
  );
}

/** p28: what linking shares; then Facebook's own page (p29) in a sign-in browser, and back to the app (p30). */
function LinkFacebook({ onClose, onBack }: { onClose: () => void; onBack: (result: string) => void }) {
  const t = useTheme();
  const [login, setLogin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      const { url } = await (await api()).linkFacebook(login, 'app');
      const back = await facebookReturn(url, 'settings/facebook');
      onBack(back ? param(back, 'fb') ?? 'error' : 'cancelled');
    } catch (e) { setError(errText(e, 'Could not open Facebook. Try again.')); setBusy(false); }
  };
  return (
    <Sheet title="Link your Facebook" lead="Facebook opens so you can confirm it’s you." onClose={onClose} testID="link-facebook">
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, gap: 4, padding: 12, borderRadius: 16, backgroundColor: t['success-wash'] }}>
          <Text style={{ fontWeight: '800', color: t['success-ink'] }}>YaysApp gets</Text>
          <Text style={{ fontSize: 13, color: t.ink }}>Your name and profile photo</Text>
          <Text style={{ fontSize: 13, color: t.ink }}>A Facebook ID only for YaysApp</Text>
        </View>
        <View style={{ flex: 1, gap: 4, padding: 12, borderRadius: 16, backgroundColor: t['danger-wash'] }}>
          <Text style={{ fontWeight: '800', color: t['danger-ink'] }}>YaysApp never</Text>
          <Text style={{ fontSize: 13, color: t.ink }}>Sees your password or messages</Text>
          <Text style={{ fontSize: 13, color: t.ink }}>Posts or reads your friends list</Text>
        </View>
      </View>
      <SwitchRow label="Also sign in with Facebook" hint="You can turn this off later." on={login} onChange={setLogin} />
      {error ? <Banner>{error}</Banner> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 36 }}>
        <OvalButton icon="close" label="Not now" size="lg" variant="ghost" onPress={onClose} />
        <OvalButton icon="facebook" label="Continue with Facebook" size="lg" loading={busy} onPress={() => void go()} />
      </View>
    </Sheet>
  );
}

function AddSocial({ network, onClose, onSaved }: { network: SocialNetwork; onClose: () => void; onSaved: (v: SocialsView) => void }) {
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => { setBusy(true); setError(null); try { onSaved(await (await api()).setSocial(network, handle)); } catch (e) { setError(errText(e)); setBusy(false); } };
  return (
    <Sheet title={`Add ${SOCIAL[network].name}`} onClose={onClose} testID="add-social">
      <Field label="Username" hint="Just the username, like @sara." error={error} value={handle} onChangeText={setHandle} placeholder="@username" autoCapitalize="none" autoCorrect={false} autoFocus returnKeyType="done" onSubmitEditing={() => { if (handle.trim()) void save(); }} />
      <View style={{ alignItems: 'center' }}><OvalButton icon="check" label="Save" size="lg" loading={busy} disabled={!handle.trim()} onPress={() => void save()} /></View>
    </Sheet>
  );
}

/** p34: your socials as others see them, with a preview as a contact or as anyone else. */
export function ProfileSocials({ openSocials }: { openSocials: () => void }) {
  const t = useTheme();
  const [d, setD] = useState<SocialsView | null>(null);
  const [as, setAs] = useState<'contact' | 'anyone'>('contact');
  useEffect(() => { void api().then((a) => a.socials()).then(setD, () => undefined); }, []);
  if (!d) return null;
  const shown = d.visibility === 'everyone' || (d.visibility === 'contacts' && as === 'contact');
  return (
    <Group title="Socials" testID="profile-socials">
      <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
        {d.links.length ? <SocialChips links={d.links} /> : <Text style={{ color: t['ink-soft'] }}>No socials yet. Link Facebook or add a username to show them on your profile.</Text>}
        <Text style={{ fontSize: 13, color: t['ink-soft'] }}>{visibilityText(d.visibility)}</Text>
        {d.links.length ? (
          <>
            <Choice label="See your profile as" value={as} options={[['contact', 'A contact'], ['anyone', 'Anyone else']]} onChange={setAs} />
            <Text testID="socials-preview" style={{ fontSize: 13, color: t.ink, paddingHorizontal: 4 }}>{shown ? `${as === 'contact' ? 'A contact' : 'Anyone else'} sees all ${d.links.length} of your socials.` : `${as === 'contact' ? 'A contact' : 'Anyone else'} sees your name and photo only.`}</Text>
          </>
        ) : null}
        <View style={{ alignItems: 'flex-start' }}><OvalButton icon="edit" label="Manage socials" size="sm" variant="soft" onPress={openSocials} /></View>
      </View>
    </Group>
  );
}

/** p33: a contact's socials on their info screen, when they share them with you. */
export function UserSocials({ userId }: { userId: string }) {
  const t = useTheme();
  const [links, setLinks] = useState<SocialLink[]>([]);
  useEffect(() => { let live = true; void api().then((a) => a.userSocials(userId)).then((v) => { if (live) setLinks(v.links); }, () => undefined); return () => { live = false; }; }, [userId]);
  if (!links.length) return null;
  return (
    <View style={{ alignSelf: 'stretch', gap: 8, padding: 12, borderRadius: 22, backgroundColor: t.raised }} accessibilityLabel="Social accounts" testID="user-socials">
      <Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 13, color: t['ink-soft'], textTransform: 'uppercase', letterSpacing: 0.4 }}>{links.every((l) => l.verified) ? 'Socials · verified' : 'Socials'}</Text>
      <SocialChips links={links} />
    </View>
  );
}
