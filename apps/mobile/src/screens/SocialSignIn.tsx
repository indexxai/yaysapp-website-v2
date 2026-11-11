import React, { useState } from 'react';
import { Linking, Modal, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, needsPin, type AuthResult, type SignInResult } from '@yays/shared';
import { api } from '../lib/api';
import { config } from '../lib/config';
import { font, useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Oval } from '../ui/Oval';
import { Banner, Field, OvalButton } from '../ui/kit';
import { Text } from '../ui/Text';
import { Screen } from './Screen';

// ---------------------------------------------------------------------------------------------------------------
// Sign in with Google or Facebook, under the phone form ("or"). Google: Google's own sign-in sheet gives an ID
// token the API checks. Facebook: Facebook's page opens in a sign-in browser and comes back to yaysapp://.
// Facebook never makes an account: it works once it's linked to one (Settings › Social accounts on the web).
// ---------------------------------------------------------------------------------------------------------------
const msg = (e: unknown, f: string) => (e instanceof ApiError || e instanceof Error ? e.message : f);
type Done = (r: AuthResult) => void;

/** Google is set up when the app has the Google client ids; in development builds without them, a stand-in asks for an email. */
const googleReady = () => !!config.google.webClientId;
let configured = false;
async function googleIdToken(): Promise<string | null> {
  const g = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
  if (!configured) { g.GoogleSignin.configure({ webClientId: config.google.webClientId, ...(config.google.iosClientId ? { iosClientId: config.google.iosClientId } : {}) }); configured = true; }
  if (Platform.OS === 'android') await g.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  // Always offer the account picker, rather than reusing the last Google account without asking.
  await g.GoogleSignin.signOut().catch(() => undefined);
  const r = await g.GoogleSignin.signIn();
  if (!g.isSuccessResponse(r)) return null; // closed the sheet
  if (!r.data.idToken) throw new Error('Google did not return a sign-in token. Check the Google client ids in the app.');
  return r.data.idToken;
}

/** The development stand-in's token: what GOOGLE_DRIVER=dev on the API accepts. */
function devGoogleToken(email: string, name: string) {
  const json = JSON.stringify({ sub: `dev-${email.toLowerCase()}`, email, email_verified: true, name: name || undefined });
  const bytes = Array.from(unescape(encodeURIComponent(json)), (c) => c.charCodeAt(0));
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]! + (i + 1 < bytes.length ? abc[(n >> 6) & 63]! : '') + (i + 2 < bytes.length ? abc[n & 63]! : '');
  }
  return `dev.${out}`;
}

/** Facebook's page in a sign-in browser (or the phone's browser), back at yaysapp://auth/facebook?… */
async function facebookReturn(url: string): Promise<string | null> {
  const back = `${config.scheme}://auth/facebook`;
  try {
    const { InAppBrowser } = require('react-native-inappbrowser-reborn') as typeof import('react-native-inappbrowser-reborn');
    if (await InAppBrowser.isAvailable()) {
      const r = await InAppBrowser.openAuth(url, back, { ephemeralWebSession: false, showTitle: true, enableUrlBarHiding: true, enableDefaultShare: false, showInRecents: false });
      return r.type === 'success' ? r.url : null;
    }
  } catch { /* no sign-in browser on this phone: use the normal browser */ }
  return new Promise((resolve) => {
    const sub = Linking.addEventListener('url', ({ url: u }) => { if (u.startsWith(back)) { sub.remove(); resolve(u); } });
    void Linking.openURL(url).catch(() => { sub.remove(); resolve(null); });
  });
}
const param = (url: string, k: string) => { const m = new RegExp(`[?&]${k}=([^&#]*)`).exec(url); return m ? decodeURIComponent(m[1]!.replace(/\+/g, ' ')) : null; };

export function SocialSignIn({ onDone, onEmail }: { onDone: Done; onEmail?: () => void }) {
  const t = useTheme();
  const [busy, setBusy] = useState<'google' | 'facebook' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devGoogle, setDevGoogle] = useState(false);
  const [notLinked, setNotLinked] = useState<string | null>(null);
  const finish = (r: SignInResult) => { if (needsPin(r)) throw new Error('This account has two-step verification. Sign in on YaysApp Web for now.'); onDone(r); };
  const run = async (which: 'google' | 'facebook', fn: () => Promise<void>) => {
    setBusy(which); setError(null);
    try { await fn(); } catch (e) { setError(msg(e, 'That did not work. Try again.')); } finally { setBusy(null); }
  };
  const google = () => {
    if (!googleReady()) { setDevGoogle(true); return; }
    void run('google', async () => {
      let token: string | null;
      try { token = await googleIdToken(); } catch (e) { throw new Error((e as { code?: string }).code === 'SIGN_IN_CANCELLED' ? 'Google sign-in was cancelled.' : msg(e, 'Google sign-in did not work. Try again.')); }
      if (token) finish(await (await api()).google(token));
    });
  };
  const facebook = () => void run('facebook', async () => {
    const c = await api();
    const back = await facebookReturn((await c.facebookSignInStart(true)).url);
    if (!back) return; // closed Facebook's page
    const ticket = param(back, 'fb_ticket');
    if (ticket) { finish(await c.facebookSignIn(ticket)); return; }
    const why = param(back, 'fb');
    if (why === 'not_linked') setNotLinked(param(back, 'fb_name') ?? '');
    else if (why === 'error') throw new Error('Facebook sign-in did not work. Try again.');
    else if (why === 'expired') throw new Error('That took too long. Try again.');
  });
  // Google shows only where it can work: with the client ids, or as the stand-in in development.
  const showGoogle = googleReady() || __DEV__;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
        <Text style={{ color: t['ink-faint'], fontSize: 13 }}>or</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
      </View>
      {error ? <Banner>{error}</Banner> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 28 }}>
        <OvalButton icon="facebook" label="Facebook" size="lg" loading={busy === 'facebook'} disabled={!!busy} onPress={facebook} />
        {showGoogle ? <OvalButton icon="google" label="Google" size="lg" loading={busy === 'google'} disabled={!!busy} onPress={google} /> : null}
        {onEmail ? <OvalButton icon="mail" label="Email" size="lg" disabled={!!busy} onPress={onEmail} /> : null}
      </View>
      <Text style={{ fontSize: 12, lineHeight: 17, color: t['ink-soft'], textAlign: 'center' }}>Facebook works once you’ve linked it in Settings › Social accounts on YaysApp Web. New here? Start with your phone number.</Text>
      {devGoogle ? <DevGoogle onClose={() => setDevGoogle(false)} onToken={(tok) => { setDevGoogle(false); void run('google', async () => finish(await (await api()).google(tok))); }} /> : null}
      {notLinked !== null ? <NotLinked name={notLinked} onClose={(to) => { setNotLinked(null); if (to === 'email') onEmail?.(); }} /> : null}
    </>
  );
}

/** Development builds without Google's client ids: sign in as any Google account (the API's GOOGLE_DRIVER=dev). */
function DevGoogle({ onClose, onToken }: { onClose: () => void; onToken: (t: string) => void }) {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <SafeAreaView edges={['bottom']} testID="dev-google" style={{ backgroundColor: t.ground, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 14 }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 20, color: t.ink }}>Google (development)</Text>
        <Text style={{ color: t['ink-soft'], fontSize: 14, lineHeight: 20 }}>This build has no Google client ids yet, so this stands in for Google’s sign-in. It only works with a development API.</Text>
        <Field label="Google email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="you@gmail.com" />
        <Field label="Name on Google (optional)" value={name} onChangeText={setName} placeholder="Sara Ahmed" />
        <View style={{ alignItems: 'center' }}><OvalButton icon="google" label="Continue" size="lg" disabled={!ok} onPress={() => onToken(devGoogleToken(email.trim(), name.trim()))} /></View>
      </SafeAreaView>
    </Modal>
  );
}

/** Facebook said who this is, but no YaysApp account has it linked (the design's "This Facebook isn't linked yet"). */
function NotLinked({ name, onClose }: { name: string; onClose: (to: 'phone' | 'email') => void }) {
  const t = useTheme();
  return (
    <Modal visible animationType="slide" onRequestClose={() => onClose('phone')}>
      <View testID="facebook-not-linked" style={{ flex: 1, backgroundColor: t.surface }}>
        <Screen title="" lead={null}>
          <View style={{ alignItems: 'center', gap: 18, paddingTop: 30 }}>
            <Oval width={84} fill={t['warning-wash']}><Icon name="facebook" size={36} color={t['warning-ink']} /></Oval>
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 26, lineHeight: 32, color: t.ink, textAlign: 'center' }}>This Facebook isn’t linked yet</Text>
            <Text style={{ fontSize: 15, lineHeight: 22, color: t['ink-soft'], textAlign: 'center' }}>
              No YaysApp account uses {name ? <Text style={{ fontWeight: '700', color: t.ink }}>{name}</Text> : 'this account'} on Facebook. Sign in with your phone number, then link Facebook in Settings › Social accounts.
            </Text>
            <View style={{ flexDirection: 'row', gap: 32, marginTop: 8 }}>
              <OvalButton icon="phone" label="Sign in with phone" size="lg" onPress={() => onClose('phone')} />
              <OvalButton icon="mail" label="Sign in with email" size="lg" onPress={() => onClose('email')} />
            </View>
            <Text style={{ fontSize: 12, lineHeight: 17, color: t['ink-soft'], textAlign: 'center', marginTop: 24 }}>We don’t make new accounts from Facebook: every YaysApp account starts with a verified phone number.</Text>
          </View>
        </Screen>
      </View>
    </Modal>
  );
}
