import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, PermissionsAndroid, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Video, { type VideoRef } from 'react-native-video';
import AudioRecorderPlayer, { AudioEncoderAndroidType, AudioSourceAndroidType, AVEncoderAudioQualityIOSType, AVEncodingOption, OutputFormatAndroidType } from 'react-native-audio-recorder-player';
import { MAX_VOICE_MS, formatBytes, formatDuration, type ThreadItem } from '@yays/shared';
import { useEngine } from '../lib/chat';
import { useTheme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { Oval } from '../ui/Oval';
import { Text } from '../ui/Text';
import { phoneFile, VOICE_MIME } from './media';

/** A photo, video or voice note that didn't load: its link may have run out (1–2 hours), so ask for a new one. */
function useLinkRetry(m: ThreadItem) {
  const engine = useEngine();
  return useCallback(() => {
    const id = engine.getState().active;
    if (id && m.seq && !m.upload) void engine.refreshLinks(id, m.seq).catch(() => undefined);
  }, [engine, m.seq, m.upload]);
}

/** Uploading: how far, with Cancel; failed: Retry. */
function UploadState({ m, light }: { m: ThreadItem; light: boolean }) {
  const t = useTheme();
  const engine = useEngine();
  const u = m.upload;
  if (!u) return null;
  const ink = light ? '#ffffff' : t.ink;
  return (
    <View testID="upload-state" style={styles.upload}>
      {u.status === 'failed' ? (
        <>
          <Text style={{ color: ink, fontSize: 12, fontWeight: '700', flex: 1 }}>{u.error ?? 'Not sent.'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry upload" onPress={() => engine.retryUpload(m.clientId)} hitSlop={8}><Icon name="refresh" size={18} color={ink} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Remove" onPress={() => engine.cancelUpload(m.clientId)} hitSlop={8}><Icon name="close" size={18} color={ink} /></Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator size="small" color={ink} />
          <Text style={{ color: ink, fontSize: 12, fontWeight: '700', flex: 1 }}>{Math.round((u.sent / Math.max(1, u.total)) * 100)}%</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel upload" onPress={() => engine.cancelUpload(m.clientId)} hitSlop={8}><Icon name="close" size={18} color={ink} /></Pressable>
        </>
      )}
    </View>
  );
}

/** A photo or video in its bubble, at its own shape, up to 240 wide. Tap to open it full screen. */
function Visual({ m, onOpen }: { m: ThreadItem; onOpen: () => void }) {
  const t = useTheme();
  const a = m.attachment!;
  const retry = useLinkRetry(m);
  const ratio = a.width && a.height ? Math.min(1.6, Math.max(0.6, a.width / a.height)) : 4 / 3;
  const w = 240, h = Math.round(w / ratio);
  const src = a.kind === 'image' ? a.thumbUrl || a.url : a.thumbUrl;
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${a.kind === 'video' ? 'Video' : 'Photo'}${m.text ? `: ${m.text}` : ''}`} testID={`media-${a.kind}`} onPress={m.upload ? undefined : onOpen}
      style={{ width: w, height: h, borderRadius: 14, overflow: 'hidden', backgroundColor: t.sunken }}>
      {src ? <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={retry} /> : null}
      {a.kind === 'video' ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Oval width={52} fill="rgba(0,0,0,0.45)"><Icon name="play" size={24} color="#ffffff" /></Oval>
          {a.durationMs ? <Text style={styles.duration}>{formatDuration(a.durationMs)}</Text> : null}
        </View>
      ) : null}
      {m.upload ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }]}><UploadState m={m} light /></View> : null}
    </Pressable>
  );
}

/** A voice note: play, pause, the waveform filling as it plays, and how long. */
function Voice({ m, mine }: { m: ThreadItem; mine: boolean }) {
  const t = useTheme();
  const a = m.attachment!;
  const retry = useLinkRetry(m);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const player = useRef<VideoRef>(null);
  const total = a.durationMs ?? 0;
  const bars = a.waveform?.length ? a.waveform : Array.from({ length: 32 }, (_, i) => 30 + ((i * 37) % 50));
  const done = total ? Math.min(1, pos / total) : 0;
  const ink = mine ? t['on-ember'] : t['ember-ink'];
  return (
    <View testID="voice" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: 230 }}>
      {a.url && !m.upload ? (
        <Video ref={player} source={{ uri: a.url }} paused={!playing} playInBackground={false} ignoreSilentSwitch="ignore" style={{ width: 0, height: 0 }}
          onProgress={(p) => setPos(p.currentTime * 1000)} onEnd={() => { setPlaying(false); setPos(0); player.current?.seek(0); }} onError={() => { setPlaying(false); retry(); }} />
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play voice message'} disabled={!a.url || !!m.upload} onPress={() => setPlaying((p) => !p)} hitSlop={6}>
        <Oval width={40} fill={mine ? 'rgba(255,255,255,0.22)' : t['ember-wash']}><Icon name={playing ? 'pause' : 'play'} size={20} color={ink} /></Oval>
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 26 }} accessible={false}>
          {bars.slice(0, 40).map((b, i, all) => <View key={i} style={{ flex: 1, height: `${Math.max(12, b)}%`, borderRadius: 2, backgroundColor: ink, opacity: i / all.length < done ? 1 : 0.4 }} />)}
        </View>
        <Text style={{ fontSize: 11, fontWeight: '600', color: mine ? t['on-ember'] : t['ink-soft'] }}>{formatDuration(playing || pos ? pos : total)}</Text>
      </View>
      {m.upload ? <UploadState m={m} light={mine} /> : null}
    </View>
  );
}

/** A document: icon, name and size; tap to open it. */
function FileRow({ m, mine }: { m: ThreadItem; mine: boolean }) {
  const t = useTheme();
  const a = m.attachment!;
  const ink = mine ? t['on-ember'] : t.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`File ${a.name}, ${formatBytes(a.size)}. Open`} testID="media-file" disabled={!a.url || !!m.upload}
      onPress={() => void Linking.openURL(a.url)} style={[styles.file, { backgroundColor: mine ? 'rgba(255,255,255,0.16)' : t.surface }]}>
      <Oval width={40} fill={mine ? 'rgba(255,255,255,0.22)' : t['ember-wash']}><Icon name="file" size={18} color={mine ? t['on-ember'] : t['ember-ink']} /></Oval>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ fontWeight: '700', fontSize: 14, color: ink }}>{a.name}</Text>
        <Text style={{ fontSize: 12, color: mine ? t['on-ember'] : t['ink-soft'] }}>{formatBytes(a.size)}{a.mime ? ` · ${(a.mime.split('/')[1] ?? '').toUpperCase().slice(0, 8)}` : ''}</Text>
      </View>
      {m.upload ? <UploadState m={m} light={mine} /> : <Icon name="download" size={18} color={mine ? t['on-ember'] : t['ink-soft']} />}
    </Pressable>
  );
}

/** The attachment part of a message bubble. */
export function MediaBody({ m, onOpen }: { m: ThreadItem; onOpen: () => void }) {
  const engine = useEngine();
  const a = m.attachment;
  if (!a) return null;
  const mine = m.senderId === engine.me;
  if (a.kind === 'image' || a.kind === 'video') return <Visual m={m} onOpen={onOpen} />;
  if (a.kind === 'voice') return <Voice m={m} mine={mine} />;
  return <FileRow m={m} mine={mine} />;
}

/** Full screen: a photo, or a video playing with controls. Open in browser to save it. */
export function MediaViewer({ m, onClose }: { m: ThreadItem | null; onClose: () => void }) {
  const engine = useEngine();
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [m?.key]);
  if (!m?.attachment) return null;
  const a = m.attachment;
  const retry = () => { setBroken(true); const id = engine.getState().active; if (id && m.seq) void engine.refreshLinks(id, m.seq).then(() => setBroken(false)).catch(() => undefined); };
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']} statusBarTranslucent>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} testID="media-viewer">
        <View style={styles.viewerBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}><Icon name="close" size={26} color="#ffffff" /></Pressable>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: '#ffffff', fontWeight: '700', fontSize: 16 }}>{m.senderId === engine.me ? 'You' : engine.nameOf(m.senderId)}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Open to save" onPress={() => void Linking.openURL(a.url)} hitSlop={12}><Icon name="download" size={24} color="#ffffff" /></Pressable>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {a.kind === 'image'
            ? <Image source={{ uri: a.url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" onError={retry} accessibilityLabel={m.text || 'Photo'} />
            : <Video source={{ uri: a.url }} controls paused={false} resizeMode="contain" style={{ width: '100%', height: '100%' }} onError={retry} poster={a.thumbUrl ?? undefined} />}
          {broken ? <ActivityIndicator color="#ffffff" style={StyleSheet.absoluteFill} /> : null}
        </View>
        {m.text ? <Text style={{ color: '#ffffff', fontSize: 15, padding: 16, textAlign: 'center' }}>{m.text}</Text> : null}
      </SafeAreaView>
    </Modal>
  );
}

/** "+" in the message box: photos and videos, the camera, or a file. */
export function AttachSheet({ open, poll, onClose, onPick }: { open: boolean; poll?: boolean; onClose: () => void; onPick: (what: 'media' | 'camera' | 'video' | 'file' | 'poll') => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (!open) return null;
  const items: Array<[IconName, string, 'media' | 'camera' | 'video' | 'file' | 'poll']> = [
    ['image', 'Photos and videos', 'media'], ['camera', 'Take a photo', 'camera'], ['video', 'Record a video', 'video'], ['file', 'Document', 'file'],
    ...(poll ? [['list', 'Poll', 'poll'] as [IconName, string, 'poll']] : []),
  ];
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <View testID="attach-sheet" style={{ backgroundColor: t.ground, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 18, paddingBottom: Math.max(insets.bottom, 18), flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', rowGap: 16 }}>
        {items.map(([icon, label, what]) => (
          <Pressable key={what} accessibilityRole="button" accessibilityLabel={label} onPress={() => { onClose(); onPick(what); }} style={{ alignItems: 'center', gap: 8, width: 84 }}>
            <Oval width={56} fill={t['ember-wash']}><Icon name={icon} size={24} color={t['ember-ink']} /></Oval>
            <Text style={{ fontFamily: 'Outfit', fontWeight: '700', fontSize: 12, color: t.ink, textAlign: 'center' }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

/** Loudness (dB, about -60…0) to a bar height (0–100). */
const level = (db: number | undefined) => Math.max(4, Math.min(100, Math.round(((db ?? -60) + 60) * (100 / 60))));
/** Averages many samples into `n` bars, so every voice note's waveform has the same number of bars. */
function bars(levels: number[], n: number) {
  if (!levels.length) return [];
  return Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * levels.length) / n), to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / n));
    const part = levels.slice(from, to);
    return Math.round(part.reduce((x, y) => x + y, 0) / part.length);
  });
}

export interface VoiceNote { file: Blob; durationMs: number; waveform: number[]; localUrl: string }
let recorder: AudioRecorderPlayer | null = null;

/** Records a voice note (AAC, up to 15 minutes), with a live timer and the loudness for the waveform. */
export function useVoiceRecorder() {
  const [state, setState] = useState<{ on: boolean; ms: number; levels: number[] }>({ on: false, ms: 0, levels: [] });
  const levels = useRef<number[]>([]);
  const start = async (): Promise<string | null> => {
    if (Platform.OS === 'android') {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (r !== PermissionsAndroid.RESULTS.GRANTED) return 'YaysApp needs the microphone for voice notes. Turn it on in Settings.';
    }
    recorder ??= new AudioRecorderPlayer();
    levels.current = [];
    try {
      await recorder.startRecorder(undefined, {
        AudioSourceAndroid: AudioSourceAndroidType.MIC, OutputFormatAndroid: OutputFormatAndroidType.MPEG_4, AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
        AVFormatIDKeyIOS: AVEncodingOption.aac, AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high, AVNumberOfChannelsKeyIOS: 1,
      }, true);
    } catch { return 'YaysApp needs the microphone for voice notes. Turn it on in Settings.'; }
    recorder.addRecordBackListener((e) => {
      levels.current.push(level(e.currentMetering));
      setState({ on: true, ms: e.currentPosition, levels: levels.current.slice(-40) });
      if (e.currentPosition >= MAX_VOICE_MS) void recorder?.stopRecorder();
    });
    setState({ on: true, ms: 0, levels: [] });
    return null;
  };
  /** Stops; with `keep`, returns the note ready to send. */
  const stop = async (keep: boolean): Promise<VoiceNote | null> => {
    if (!recorder) return null;
    const ms = state.ms;
    const uri = await recorder.stopRecorder().catch(() => '');
    recorder.removeRecordBackListener();
    setState({ on: false, ms: 0, levels: [] });
    if (!keep || !uri || ms < 800) return null;
    return { file: await phoneFile(uri, VOICE_MIME), durationMs: Math.round(ms), waveform: bars(levels.current, 48), localUrl: uri };
  };
  return { recording: state.on, ms: state.ms, levels: state.levels, start, stop };
}

/** While recording: the timer, the live waveform, Cancel and Send. */
export function RecordingBar({ ms, levels, onCancel, onSend }: { ms: number; levels: number[]; onCancel: () => void; onSend: () => void }) {
  const t = useTheme();
  return (
    <View testID="recording-bar" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel recording" onPress={onCancel} hitSlop={10}><Icon name="trash" size={22} color={t['danger-ink']} /></Pressable>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.danger }} />
      <Text style={{ fontWeight: '700', color: t.ink, width: 52 }} accessibilityLabel={`Recording, ${formatDuration(ms)}`}>{formatDuration(ms)}</Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 28 }}>
        {levels.map((b, i) => <View key={i} style={{ flex: 1, height: `${b}%`, borderRadius: 2, backgroundColor: t.ember }} />)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Send voice message" onPress={onSend}>
        <Oval width={44} fill={t.ember}><Icon name="send" size={20} color={t['on-ember']} /></Oval>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  upload: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
  duration: { position: 'absolute', right: 8, bottom: 6, color: '#ffffff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 14, width: 250 },
  viewerBar: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 10 },
});
