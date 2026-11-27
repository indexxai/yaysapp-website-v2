'use client';
import { useEffect, useId, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Modal } from '@/components/message-actions';
import { OvalButton } from '@/components/ui';
import type { PhotoCrop } from '@/lib/photo';

const V = 280; // the square the photo is framed in, in CSS px

/** Frame a new profile photo: drag to move it, zoom with the slider or the mouse wheel; the oval shows what people see. */
export function PhotoCropper({ file, title = 'Adjust your photo', onCancel, onUse }: { file: File; title?: string; onCancel: () => void; onUse: (c: PhotoCrop) => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const maskId = `crop${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const drag = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const scale = nat ? (V / Math.min(nat.w, nat.h)) * zoom : 1;
  const limit = (o: { x: number; y: number }, z = zoom) => {
    if (!nat) return o;
    const s = (V / Math.min(nat.w, nat.h)) * z;
    const mx = Math.max(0, (nat.w * s - V) / 2), my = Math.max(0, (nat.h * s - V) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };
  const setZ = (z: number) => { const v = Math.min(4, Math.max(1, z)); setZoom(v); setOff((o) => limit(o, v)); };
  const down = (e: RPointerEvent<HTMLDivElement>) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; };
  const move = (e: RPointerEvent<HTMLDivElement>) => { const d = drag.current; if (d && d.id === e.pointerId) setOff(limit({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })); };
  const use = () => {
    if (!nat) return;
    const size = V / scale; // source px across the frame
    const cx = nat.w / 2 - off.x / scale, cy = nat.h / 2 - off.y / scale;
    onUse({ x: (cx - size / 2) / nat.w, y: (cy - size / 2) / nat.h, w: size / nat.w, h: size / nat.h });
  };

  return (
    <Modal title={title} onClose={onCancel}>
      <div className="photo-crop">
        <div className="photo-crop__frame" style={{ width: V, height: V }} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }}
          onWheel={(e) => setZ(zoom - e.deltaY / 400)} data-testid="photo-crop-frame" aria-label="Drag to move the photo" role="img">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={nat ? { width: nat.w * scale, height: nat.h * scale, transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))` } : { visibility: 'hidden' }} />
          <svg className="photo-crop__mask" viewBox="0 0 1133 1052" preserveAspectRatio="none" aria-hidden>
            <defs><mask id={maskId}><rect width="1133" height="1052" fill="#fff" /><ellipse cx="566.5" cy="526" rx="627" ry="450" transform="rotate(-38.3 566.5 526)" fill="#000" /></mask></defs>
            <rect width="1133" height="1052" mask={`url(#${maskId})`} className="photo-crop__shade" />
            <ellipse cx="566.5" cy="526" rx="627" ry="450" transform="rotate(-38.3 566.5 526)" className="photo-crop__hole" />
          </svg>
        </div>
        <label className="photo-crop__zoom">
          <span>Zoom</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZ(Number(e.target.value))} aria-label="Zoom" style={{ accentColor: 'var(--ember)' }} />
        </label>
        <p className="muted p2-small" style={{ margin: 0 }}>Drag the photo to move it. The oval is what people see.</p>
      </div>
      <div className="row center">
        <OvalButton icon="close" label="Cancel" variant="ghost" onClick={onCancel} />
        <OvalButton icon="check" label="Use photo" size="lg" disabled={!nat} onClick={use} />
      </div>
    </Modal>
  );
}
