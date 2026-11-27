import React, { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';
import { ApiError } from '@yays/shared';
import { api } from '../lib/api';
import { useTheme } from '../lib/theme';
import { Sheet } from '../circles/common';
import { Banner, Field, OvalButton, TextLink } from '../ui/kit';
import { Text } from '../ui/Text';

/**
 * Sign in YaysApp on a computer (QA #01): point the phone at the QR code on yaysapp's sign-in page, or type the
 * 8-character code shown under it. The phone approves; the browser is signed in to this account.
 */
export function LinkDeviceSheet({ onClose, onLinked }: { onClose: () => void; onLinked: (deviceName: string) => void }) {
  const t = useTheme();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const handled = useRef(false);

  const approve = async (v: { qr: string } | { code: string }) => {
    setBusy(true); setError(null);
    try { onLinked((await (await api()).linkApprove(v)).deviceName); }
    catch (e) { handled.current = false; setError(e instanceof ApiError ? e.message : 'That didn’t work. Try again.'); setBusy(false); }
  };
  const scanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      const v = codes.find((c) => c.value)?.value;
      if (!v || handled.current) return;
      handled.current = true;
      void approve({ qr: v });
    },
  });
  const askCamera = async () => { setAsked(true); if (!(await requestPermission())) setError(null); };

  return (
    <Sheet title="Link a device" lead="Use YaysApp on a computer: open web.yaysapp.com, choose QR code, then scan it here. Only link a device you own." onClose={onClose} testID="link-device">
      {error ? <Banner>{error}</Banner> : null}
      {!typing ? (
        hasPermission && device ? (
          <View testID="qr-scanner" style={[styles.frame, { borderColor: t['ember-light'] }]}>
            <Camera style={StyleSheet.absoluteFill} device={device} isActive={!busy} codeScanner={scanner} />
            <View pointerEvents="none" style={[styles.target, { borderColor: '#ffffff' }]} />
          </View>
        ) : (
          <View style={{ gap: 10, alignItems: 'center' }}>
            <Text style={{ textAlign: 'center', color: t['ink-soft'], fontSize: 14, lineHeight: 20 }}>
              {asked && !hasPermission ? 'YaysApp needs the camera to scan the code. Allow it in Settings, or type the code instead.' : 'YaysApp uses the camera to scan the code on your computer’s screen.'}
            </Text>
            {asked && !hasPermission
              ? <OvalButton icon="settings" label="Open Settings" onPress={() => void Linking.openSettings()} />
              : <OvalButton icon="camera" label="Scan the code" onPress={() => void askCamera()} testID="allow-camera" />}
          </View>
        )
      ) : (
        <View style={{ gap: 12 }}>
          <Field label="Code from the computer" value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="XXXX-XXXX" autoCapitalize="characters" autoCorrect={false} maxLength={9} autoFocus />
          <View style={{ alignItems: 'center' }}>
            <OvalButton icon="link" label="Link device" loading={busy} disabled={code.replace(/[^a-z0-9]/gi, '').length !== 8} onPress={() => void approve({ code })} />
          </View>
        </View>
      )}
      <View style={{ alignItems: 'center' }}><TextLink label={typing ? 'Scan the QR code instead' : 'Type the code instead'} onPress={() => { setError(null); setTyping((v) => !v); }} /></View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  frame: { height: 300, borderRadius: 24, overflow: 'hidden', borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  target: { width: 200, height: 200, borderWidth: 3, borderRadius: 24 },
});
