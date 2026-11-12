import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, View, type TextInput as RNTextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ImagePicker from 'react-native-image-crop-picker';
import {
  CIRCLE_LIMITS, POST_REPORT_LABEL, POST_REPORT_REASONS, moneySchemeMatches,
  type CircleComment, type CirclePost, type CircleView, type MeProfile, type PostReportReason, type SchemeMatch,
} from '@yays/shared';
import { api } from '../lib/api';
import { config } from '../lib/config';
import { font, useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Avatar, Banner, OvalButton, TextLink } from '../ui/kit';
import { LineArt } from '../ui/LineArt';
import { Oval } from '../ui/Oval';
import { Text, TextInput } from '../ui/Text';
import { AuthorTag, Card, Header, Marked, MenuRow, Note, Sheet, State, Tag, ago, dateShort, errText, isMember, offline } from './common';

/* ------------------------------------------------------------------ photos */

export interface PickedPhoto { path: string; mime: string; size: number }
/** Up to `max` photos from the library, made smaller (2048px JPEG) like chat photos. */
export async function pickPhotos(max: number): Promise<PickedPhoto[]> {
  try {
    const got = await ImagePicker.openPicker({ multiple: true, maxFiles: max, mediaType: 'photo', compressImageMaxWidth: 2048, compressImageMaxHeight: 2048, compressImageQuality: 0.85, forceJpg: true });
    return got.slice(0, max).map((p) => ({ path: p.path, mime: p.mime || 'image/jpeg', size: p.size }));
  } catch (e) { if ((e as { code?: string }).code === 'E_PICKER_CANCELLED') return []; throw e; }
}
/** Uploads one photo for a post; gives back the key the post refers to. */
async function uploadPhoto(p: PickedPhoto): Promise<string> {
  const c = await api();
  // The picker's size can be missing or stale after compressing: the file itself says how big it is.
  let blob: Blob;
  try { blob = await (await fetch(p.path)).blob(); } catch { throw new Error('Could not read that photo. Try another one.'); }
  const ticket = await c.request<{ key: string; uploadUrl: string; headers: Record<string, string> }>('POST', '/v1/media/upload-url', { purpose: 'media', kind: 'image', contentType: p.mime, size: blob.size || p.size });
  let ok = false;
  try { ok = (await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: blob })).ok; }
  catch { throw new Error('The photo didn’t upload. Check your connection and try again.'); }
  if (!ok) throw new Error('The photo didn’t upload. Try again.');
  return ticket.key;
}

/* ------------------------------------------------------------------ one post */

export const postLink = (id: string) => `${config.webUrl}/circles/post?id=${id}`;

/** A post in the feed (or at the top of its own page), or the placeholder that stands in for it (p51). */
export function PostCard({ p, c, onChange, onGone, onOpen, full }: { p: CirclePost; c: CircleView; onChange: (p: CirclePost) => void; onGone: () => void; onOpen?: () => void; full?: boolean }) {
  const t = useTheme();
  const [show, setShow] = useState(false);
  const [sheet, setSheet] = useState<'menu' | 'report' | 'edit' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const admin = c.access === 'admin';
  const member = isMember(c);
  const run = async (fn: () => Promise<CirclePost | void>) => { setError(null); setSheet(null); try { const r = await fn(); if (r) onChange(r); } catch (e) { setError(errText(e)); } };
  if (p.hidden === 'blocked') return <Gone icon="block" title="Post from someone you blocked" text={`You blocked ${p.author.displayName}, so their posts and comments are hidden.`} />;
  if (p.hidden === 'reported' && !show) return <Gone icon="eye-off" title="You reported this post" text="It’s hidden for you while the owners look at it." action={<TextLink label="Show anyway" onPress={() => setShow(true)} />} />;
  if (p.status === 'removed' && !p.mine && !admin) return null;
  const like = () => void run(() => api().then((a) => a.likeCirclePost(p.id, !p.liked)));
  return (
    <View testID="post" accessibilityLabel={`Post by ${p.author.displayName}`} style={{ borderRadius: 22, backgroundColor: t.raised, padding: 14, gap: 10, opacity: p.status === 'removed' ? 0.75 : 1, borderWidth: p.status === 'pending' ? 1.5 : 0, borderColor: t['warning-ink'], borderStyle: 'dashed' }}>
      {p.status === 'removed' ? <Note icon="trash" tone="danger">Post removed by the owners. {p.removedReason || 'It broke the circle’s rules.'}{p.mine ? ' Only you can see it.' : ''}</Note> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={p.author.displayName} photoUrl={p.author.photoUrl} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ fontSize: 14, fontWeight: '700', color: t.ink, flexShrink: 1 }} numberOfLines={1}>{p.author.displayName}</Text><AuthorTag a={p.author} /></View>
          <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{p.pinned ? 'Pinned · ' : ''}{full ? `${c.name} · ` : ''}{ago(p.createdAt)}{p.editedAt ? ' · edited' : ''}</Text>
        </View>
        {p.status === 'pending' ? <Tag kind="warn" icon="clock">Waiting</Tag> : null}
        {member || p.mine ? <Pressable accessibilityRole="button" accessibilityLabel="Post options" hitSlop={10} onPress={() => setSheet('menu')}><Icon name="more-horizontal" size={20} color={t['ink-soft']} /></Pressable> : null}
      </View>
      {error ? <Banner>{error}</Banner> : null}
      {p.text ? <Text style={{ fontSize: full ? 15 : 14, lineHeight: full ? 22 : 21, color: t.ink }} onPress={onOpen}>{p.text}</Text> : null}
      {p.photos.length ? <Photos urls={p.photos} /> : null}
      {p.status === 'pending' && p.mine ? <Text style={{ fontSize: 12, color: t['ink-soft'] }}>Only you can see this until an owner approves it. Usually within a few hours.</Text> : null}
      {p.answer && !full ? (
        <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: 14, backgroundColor: t['success-wash'] }}>
          <Icon name="check" size={16} color={t['success-ink']} />
          <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: t.ink }} numberOfLines={3}><Text style={{ fontWeight: '700' }}>Answered by {p.answer.by}:</Text> {p.answer.text}</Text>
        </View>
      ) : null}
      {p.status === 'live' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
          <Act icon="heart" label={String(p.likes)} on={p.liked} a11y={p.liked ? 'Unlike' : 'Like'} disabled={!member} onPress={like} />
          <Act icon="chat" label={`${p.comments} comment${p.comments === 1 ? '' : 's'}`} a11y={`${p.comments} comments`} onPress={full ? undefined : onOpen} />
          <View style={{ flex: 1 }} />
          <Act icon="share" label="Share" a11y="Share post" onPress={() => void Share.share({ message: `${p.text ? `${p.text.slice(0, 120)}\n` : ''}${postLink(p.id)}` }).catch(() => undefined)} />
        </View>
      ) : null}
      {sheet === 'menu' ? (
        <Sheet title="Post" onClose={() => setSheet(null)}>
          {admin && p.status === 'live' ? <MenuRow icon="pin" label={p.pinned ? 'Unpin' : 'Pin to top'} onPress={() => void run(() => api().then((a) => a.pinCirclePost(p.id, !p.pinned)))} /> : null}
          {p.mine && p.status !== 'removed' ? <MenuRow icon="edit" label="Edit" onPress={() => setSheet('edit')} /> : null}
          {p.mine || admin ? <MenuRow icon="trash" label="Delete" danger onPress={() => void run(async () => { await (await api()).deleteCirclePost(p.id); onGone(); })} /> : null}
          {admin && !p.mine && p.status !== 'removed' ? <MenuRow icon="close" label="Remove for breaking rules" danger onPress={() => setSheet('remove')} /> : null}
          {!p.mine ? <MenuRow icon="flag" label="Report" danger onPress={() => setSheet('report')} /> : null}
        </Sheet>
      ) : null}
      {sheet === 'report' ? <ReportSheet p={p} onClose={() => setSheet(null)} onDone={(blocked) => { setSheet(null); onChange({ ...p, hidden: blocked ? 'blocked' : 'reported' }); }} /> : null}
      {sheet === 'edit' ? <EditSheet p={p} onClose={() => setSheet(null)} onSaved={(x) => { setSheet(null); onChange(x); }} /> : null}
      {sheet === 'remove' ? <RemoveSheet p={p} c={c} onClose={() => setSheet(null)} onDone={(x) => { setSheet(null); onChange(x); }} /> : null}
    </View>
  );
}

function Act({ icon, label, a11y, on, disabled, onPress }: { icon: 'heart' | 'chat' | 'share'; label: string; a11y: string; on?: boolean; disabled?: boolean; onPress?: () => void }) {
  const t = useTheme();
  const ink = on ? t['ember-ink'] : t['ink-soft'];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ selected: !!on, disabled: !!disabled }} disabled={disabled || !onPress} onPress={onPress} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name={icon} size={16} color={ink} strokeWidth={on ? 2.6 : 1.8} />
      <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 13, color: ink }}>{label}</Text>
    </Pressable>
  );
}

/** One to four photos: one wide, or a grid. Tap opens the photo. */
function Photos({ urls }: { urls: string[] }) {
  const t = useTheme();
  const one = urls.length === 1;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID="post-photos">
      {urls.slice(0, 4).map((u, i) => (
        <Pressable key={i} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1}`} onPress={() => void Linking.openURL(u).catch(() => undefined)}
          style={{ width: one ? '100%' : '48.9%', height: one ? 190 : 130, borderRadius: 16, overflow: 'hidden', backgroundColor: t.sunken }}>
          <Image source={{ uri: u }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        </Pressable>
      ))}
    </View>
  );
}

function Gone({ icon, title, text, action }: { icon: 'block' | 'eye-off'; title: string; text: string; action?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View testID="post-placeholder" style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 22, backgroundColor: t.sunken }}>
      <Icon name={icon} size={20} color={t['ink-soft']} />
      <View style={{ flex: 1, gap: 4 }}><Text style={{ fontWeight: '700', color: t.ink }}>{title}</Text><Text style={{ fontSize: 13, color: t['ink-soft'] }}>{text}</Text>{action}</View>
    </View>
  );
}

/** p42 → p52: why, then thanks. Blocking is offered alongside. */
function ReportSheet({ p, onClose, onDone }: { p: CirclePost; onClose: () => void; onDone: (blocked: boolean) => void }) {
  const t = useTheme();
  const [reason, setReason] = useState<PostReportReason | null>(null);
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (sent) {
    return (
      <Sheet title="Thanks, we got your report" onClose={() => onDone(block)} testID="report-sent">
        <View style={{ alignItems: 'center' }}><Oval width={72} fill={t['success-wash']}><Icon name="check" size={32} color={t['success-ink']} /></Oval></View>
        <Text style={{ textAlign: 'center', color: t['ink-soft'], fontSize: 14, lineHeight: 21 }}>The owners and YaysApp will look at it. {p.author.displayName} isn’t told who reported.</Text>
        {block ? <Note icon="block" tone="success">You blocked {p.author.displayName}. You won’t see their posts, comments or messages.</Note> : null}
        <View style={{ alignItems: 'center' }}><OvalButton icon="check" label="Done" onPress={() => onDone(block)} /></View>
      </Sheet>
    );
  }
  const send = async () => { if (!reason) return; setBusy(true); setError(null); try { await (await api()).reportCirclePost(p.id, reason, block); setSent(true); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  return (
    <Sheet title="Report this post" lead={`The circle owners and YaysApp see your report. ${p.author.displayName} isn’t told who reported.`} onClose={onClose} testID="report-sheet">
      {error ? <Banner>{error}</Banner> : null}
      <View accessibilityRole="radiogroup" style={{ gap: 4 }}>
        {POST_REPORT_REASONS.map((r) => (
          <Pressable key={r} accessibilityRole="radio" accessibilityState={{ checked: reason === r }} accessibilityLabel={POST_REPORT_LABEL[r][0]} onPress={() => setReason(r)}
            style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 10, borderRadius: 14, backgroundColor: reason === r ? t['ember-wash'] : 'transparent' }}>
            <Oval width={22} fill={reason === r ? t.ember : t.sunken}>{reason === r ? <Icon name="check" size={13} color="#fff" /> : null}</Oval>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>{POST_REPORT_LABEL[r][0]}</Text><Text style={{ fontSize: 13, color: t['ink-soft'] }}>{POST_REPORT_LABEL[r][1]}</Text></View>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: block }} accessibilityLabel={`Also block ${p.author.displayName}`} onPress={() => setBlock(!block)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 10 }}>
        <Oval width={22} fill={block ? t.ember : t.sunken}>{block ? <Icon name="check" size={13} color="#fff" /> : null}</Oval>
        <Text style={{ color: t.ink, fontWeight: '600' }}>Also block {p.author.displayName}</Text>
      </Pressable>
      <View style={{ alignItems: 'center' }}><OvalButton icon="flag" label="Send report" variant="danger" loading={busy} disabled={!reason} onPress={() => void send()} /></View>
    </Sheet>
  );
}

function EditSheet({ p, onClose, onSaved }: { p: CirclePost; onClose: () => void; onSaved: (p: CirclePost) => void }) {
  const t = useTheme();
  const [text, setText] = useState(p.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const marks = moneySchemeMatches(text);
  return (
    <Sheet title="Edit post" onClose={onClose}>
      {error ? <Banner>{error}</Banner> : null}
      <TextInput accessibilityLabel="Post" multiline value={text} maxLength={CIRCLE_LIMITS.post} onChangeText={setText} style={{ minHeight: 120, padding: 14, borderRadius: 16, backgroundColor: t.raised, color: t.ink, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' }} />
      {marks.length ? <Note icon="alert-triangle" tone="danger">Take out “{marks.map((m) => m.text).join('”, “')}”. Circles don’t allow promising profits or asking for money.</Note> : null}
      <View style={{ alignItems: 'center' }}><OvalButton icon="check" label="Save" loading={busy} disabled={!text.trim() || marks.length > 0} onPress={() => void (async () => { setBusy(true); setError(null); try { onSaved(await (await api()).editCirclePost(p.id, text)); } catch (e) { setError(errText(e)); setBusy(false); } })()} /></View>
    </Sheet>
  );
}

function RemoveSheet({ p, c, onClose, onDone }: { p: CirclePost; c: CircleView; onClose: () => void; onDone: (p: CirclePost) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = (reason: string) => void (async () => { setBusy(true); setError(null); try { onDone(await (await api()).removeCirclePost(p.id, reason)); } catch (e) { setError(errText(e)); setBusy(false); } })();
  return (
    <Sheet title="Remove this post" lead={`${p.author.displayName} sees it was removed, and why.`} onClose={onClose}>
      {error ? <Banner>{error}</Banner> : null}
      {busy ? <ActivityIndicator /> : null}
      {c.rules.map((r, i) => <MenuRow key={i} icon="close" danger label={`Rule ${i + 1}: ${r}`} onPress={() => go(`Rule ${i + 1}: ${r}`)} />)}
      <MenuRow icon="close" danger label="Spam" onPress={() => go('Spam')} />
      <MenuRow icon="close" danger label="Other" onPress={() => go('')} />
    </Sheet>
  );
}

/* ------------------------------------------------------------------ writing a post (p40, p49, p50) */

/** New post, full screen. Money-scheme wording is caught before it goes; the owners can be asked to decide. */
export function ComposeScreen({ circleId, me, onBack, onPosted, onEvent }: { circleId: string; me: MeProfile; onBack: () => void; onPosted: () => void; onEvent: () => void }) {
  const t = useTheme();
  const [c, setC] = useState<CircleView | null>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<SchemeMatch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const input = useRef<RNTextInput>(null);
  useEffect(() => { void api().then((a) => a.circle(circleId)).then(setC, (e) => setError(errText(e))); }, [circleId]);
  const send = async (mode: 'normal' | 'review') => {
    const body = text.trim();
    if (!body && !photos.length) return;
    if (mode === 'normal') { const m = moneySchemeMatches(body); if (m.length) { setFlagged(m); return; } }
    setBusy(true); setError(null); setFailed(false);
    try {
      const photoKeys: string[] = [];
      for (const p of photos) photoKeys.push(await uploadPhoto(p));
      await (await api()).createCirclePost(circleId, { text: body, photoKeys, send: mode });
      setFlagged(null);
      onPosted();
    } catch (e) {
      const d = (e as { details?: { reason?: string; matches?: SchemeMatch[] } }).details;
      if (d?.reason === 'money_scheme' && d.matches) setFlagged(d.matches);
      // p50: it didn't go. Nothing is lost: the text and photos stay here to try again.
      else if (offline(e) || /connection/i.test((e as Error).message ?? '')) { setFailed(true); setFlagged(null); }
      else { setError(errText(e, (e as Error).message || 'Your post didn’t go. Try again.')); setFlagged(null); }
    } finally { setBusy(false); }
  };
  const addPhotos = async () => { try { const got = await pickPhotos(CIRCLE_LIMITS.photos - photos.length); setPhotos([...photos, ...got].slice(0, CIRCLE_LIMITS.photos)); } catch { setError('Could not open your photos. Allow access in Settings.'); } };
  const left = CIRCLE_LIMITS.post - text.length;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="compose-screen">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
          <OvalButton icon="close" label="Cancel" size="sm" variant="secondary" onPress={onBack} />
          <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 20, color: t.ink, marginBottom: 20 }}>New post</Text>
          <OvalButton icon="send" label="Post" size="sm" loading={busy} disabled={!text.trim() && !photos.length} onPress={() => void send('normal')} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name={me.displayName} photoUrl={me.photoUrl} size={40} />
            <View><Text style={{ fontWeight: '700', color: t.ink }}>{me.displayName}</Text><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{c?.name ?? ' '}</Text></View>
          </View>
          {error ? <Banner>{error}</Banner> : null}
          {failed ? <Note icon="alert-triangle" tone="danger" testID="post-failed">Your post didn’t go: you’re offline or the connection dropped. It’s still here. Tap Post to try again.</Note> : null}
          {c?.muted ? <Note icon="volume-off">You can’t post until {dateShort(c.muted.until)}.</Note> : null}
          {c && c.postApproval && c.access !== 'admin' ? <Note icon="info">In this circle, owners check posts before everyone sees them.</Note> : null}
          <TextInput ref={input} accessibilityLabel="Write a post" autoFocus multiline placeholder="Share an update or ask a question…" placeholderTextColor={t['ink-faint']} value={text} maxLength={CIRCLE_LIMITS.post}
            onChangeText={setText} style={{ minHeight: 140, fontSize: 17, lineHeight: 25, color: t.ink, textAlignVertical: 'top' }} />
          {photos.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {photos.map((p, i) => (
                <View key={p.path + i} style={{ width: 96, height: 96, borderRadius: 14, overflow: 'hidden', backgroundColor: t.sunken }}>
                  <Image source={{ uri: p.path }} style={{ width: '100%', height: '100%' }} />
                  <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setPhotos(photos.filter((_, j) => j !== i))} style={{ position: 'absolute', top: 4, right: 4 }}>
                    <Oval width={26} fill="rgba(0,0,0,0.55)"><Icon name="close" size={14} color="#fff" /></Oval>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {left < 200 ? <Text style={{ fontSize: 12, color: t['ink-soft'], textAlign: 'right' }}>{left}</Text> : null}
          <Text style={{ fontSize: 12, lineHeight: 17, color: t['ink-soft'] }}>{c ? `Posts are seen by all ${c.memberCount.toLocaleString()} members. ` : ''}Promoting investments or asking for money isn’t allowed and gets removed.</Text>
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: 22, paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.ground }}>
          <OvalButton icon="image" label="Photo" size="sm" variant="soft" disabled={photos.length >= CIRCLE_LIMITS.photos} onPress={() => void addPhotos()} />
          <OvalButton icon="calendar" label="Event" size="sm" variant="soft" onPress={onEvent} />
        </View>
      </KeyboardAvoidingView>
      {flagged ? (
        <Sheet title="This looks like an investment offer" onClose={() => setFlagged(null)} testID="post-flagged">
          <View style={{ alignItems: 'center' }}><Oval width={64} fill={t['danger-wash']}><Icon name="alert-triangle" size={28} color={t['danger-ink']} /></Oval></View>
          <View style={{ padding: 12, borderRadius: 16, backgroundColor: t.raised }}><Marked text={text.trim()} marks={flagged} /></View>
          <Note icon="alert-triangle" tone="danger">Circles don’t allow promising profits or asking people for money. We marked the parts that look like that. Edit them, or send the post to the owners to decide.</Note>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
            <OvalButton icon="edit" label="Edit post" onPress={() => { setFlagged(null); setTimeout(() => input.current?.focus(), 300); }} />
            <OvalButton icon="send" label="Send to owners" variant="ghost" loading={busy} onPress={() => void send('review')} />
          </View>
          <Text style={{ fontSize: 12, color: t['ink-soft'], textAlign: 'center' }}>If you send it, the owners decide. Repeated scam posts get people removed.</Text>
        </Sheet>
      ) : null}
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ comments (p38) */

export function Thread({ comments, c, onReply, onChanged, canAnswer, readOnly }: { comments: CircleComment[]; c: CircleView; onReply: (to: CircleComment) => void; onChanged: () => void; canAnswer: boolean; readOnly: boolean }) {
  const t = useTheme();
  const tops = comments.filter((x) => !x.parentId);
  const sorted = [...tops.filter((x) => x.answer), ...tops.filter((x) => !x.answer)];
  const act = (fn: (a: Awaited<ReturnType<typeof api>>) => Promise<unknown>) => void api().then(fn).then(onChanged, () => undefined);
  const one = (x: CircleComment, reply = false) => (
    <View key={x.id} testID="comment" style={{ flexDirection: 'row', gap: 10, marginLeft: reply ? 42 : 0 }}>
      <Avatar name={x.author.displayName} photoUrl={x.author.photoUrl} size={reply ? 28 : 32} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ padding: 10, borderRadius: 16, gap: 2, backgroundColor: x.answer ? t['success-wash'] : t.surface }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>{x.author.displayName}</Text><AuthorTag a={x.author} />{x.answer ? <Tag kind="ok" icon="check">Answer</Tag> : null}
          </View>
          <Text style={{ fontSize: 14, lineHeight: 20, color: x.hidden === 'blocked' ? t['ink-soft'] : t.ink, fontStyle: x.hidden === 'blocked' ? 'italic' : 'normal' }}>{x.hidden === 'blocked' ? 'Hidden: you blocked this person.' : x.text}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{ago(x.createdAt)}</Text>
          {!readOnly ? <TextLink label="Reply" onPress={() => onReply(x)} /> : null}
          {canAnswer && !reply ? <TextLink label={x.answer ? 'Unmark answer' : 'Mark as answer'} onPress={() => act((a) => a.markCircleAnswer(x.id, !x.answer))} /> : null}
          {x.mine || c.access === 'admin' ? <TextLink label="Delete" onPress={() => act((a) => a.deleteCircleComment(x.id))} /> : null}
        </View>
      </View>
    </View>
  );
  return <View style={{ gap: 14 }}>{sorted.map((top) => <View key={top.id} style={{ gap: 10 }}>{one(top)}{comments.filter((r) => r.parentId === top.id).map((r) => one(r, true))}</View>)}</View>;
}

/** The box at the bottom: write, reply, send. Money-scheme wording can't be sent. */
export function CommentBox({ me, replyTo, onCancelReply, onSend, disabled, placeholder = 'Write a comment…' }: { me: MeProfile; replyTo: CircleComment | null; onCancelReply: () => void; onSend: (text: string) => Promise<void>; disabled?: string | null; placeholder?: string }) {
  const t = useTheme();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const marks = moneySchemeMatches(text);
  if (disabled) return <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 14, backgroundColor: t.ground, borderTopWidth: 1, borderTopColor: t.line }}><Icon name="volume-off" size={16} color={t['ink-soft']} /><Text style={{ flex: 1, color: t['ink-soft'], fontSize: 13 }}>{disabled}</Text></View>;
  const send = async () => { setBusy(true); setError(null); try { await onSend(text.trim()); setText(''); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  return (
    <View style={{ gap: 8, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6, backgroundColor: t.ground, borderTopWidth: 1, borderTopColor: t.line }}>
      {error ? <Banner>{error}</Banner> : null}
      {replyTo ? <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 6 }}><Text style={{ flex: 1, fontSize: 13, color: t['ink-soft'] }}>Replying to {replyTo.author.displayName}</Text><TextLink label="Cancel" onPress={onCancelReply} /></View> : null}
      {marks.length ? <Note icon="alert-triangle" tone="danger">Take out “{marks.map((m) => m.text).join('”, “')}”. Circles don’t allow promising profits or asking for money.</Note> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <Avatar name={me.displayName} photoUrl={me.photoUrl} size={32} />
        <TextInput accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={t['ink-faint']} value={text} maxLength={CIRCLE_LIMITS.comment} multiline onChangeText={setText}
          style={{ flex: 1, minHeight: 44, maxHeight: 120, marginBottom: 22, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, borderRadius: 22, backgroundColor: t.surface, color: t.ink, fontSize: 15 }} />
        <OvalButton icon="send" label="Send" size="sm" loading={busy} disabled={!text.trim() || marks.length > 0} onPress={() => void send()} />
      </View>
    </View>
  );
}

/** One post with its comments. */
export function PostScreen({ id, me, onBack, openCircle }: { id: string; me: MeProfile; onBack: () => void; openCircle: (id: string) => void }) {
  const t = useTheme();
  const [p, setP] = useState<CirclePost | null>(null);
  const [c, setC] = useState<CircleView | null>(null);
  const [comments, setComments] = useState<CircleComment[]>([]);
  const [replyTo, setReplyTo] = useState<CircleComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const load = useCallback(async () => {
    try {
      const a = await api();
      const post = await a.circlePost(id);
      const [circle, cs] = await Promise.all([a.circle(post.circleId), a.circleComments(id)]);
      setP(post); setC(circle); setComments(cs);
    } catch (e) { setError(errText(e, 'This post isn’t available.')); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const member = c ? isMember(c) : false;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="post-screen">
      <LineArt name="reader" height={240} style={{ left: -36, right: undefined, bottom: 96 }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Header back="Feed" onBack={onBack} title="Post" />
        {gone ? <State icon="trash" title="Post deleted" actions={<OvalButton icon="arrow-left" label="Back" size="lg" onPress={onBack} />} />
          : error ? <State icon="link" tone="plain" title="This post isn’t available">{error}</State>
          : !p || !c ? <ActivityIndicator style={{ marginTop: 40 }} color={t.ember} />
          : (
            <>
              <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }} keyboardShouldPersistTaps="handled">
                <PostCard p={p} c={c} full onChange={setP} onGone={() => setGone(true)} />
                <Card testID="comments">
                  {comments.length ? <Thread comments={comments} c={c} canAnswer={c.access === 'admin'} readOnly={!member || !!c.muted} onReply={setReplyTo} onChanged={() => void load()} />
                    : <Text style={{ color: t['ink-soft'] }}>No comments yet.</Text>}
                </Card>
                {!member ? <Note icon="info" tone="plain">Join {c.name} to comment.</Note> : null}
                {!member ? <View style={{ alignItems: 'center' }}><OvalButton icon="people" label="Open the circle" variant="soft" onPress={() => openCircle(c.id)} /></View> : null}
              </ScrollView>
              {p.status === 'live' && member ? (
                <CommentBox me={me} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} disabled={c.muted ? `You can comment again from ${dateShort(c.muted.until)}.` : null}
                  onSend={async (text) => { await (await api()).commentOnCirclePost(p.id, text, replyTo?.id); setReplyTo(null); await load(); }} />
              ) : null}
            </>
          )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
