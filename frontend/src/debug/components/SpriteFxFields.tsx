/**
 * 立绘包里每张立绘的「切换特效」:动作 / 气泡 / 音效三个下拉,加一个「试一下」。
 * 清单在 plugins/spriteFx.ts;选了气泡而音效还空着时,音效自动填上配对的那个。
 */

import type { SpriteEffect } from '../lib/api';
import { FX_BUBBLES, FX_MOTIONS, FX_SOUNDS, normalizeEffect } from '../plugins/spriteFx';

const EMPTY: SpriteEffect = { motion: null, bubble: null, sound: null };

export function SpriteFxFields({
  effect: raw,
  disabled,
  onCommit,
  onPreview,
}: {
  effect: SpriteEffect | null | undefined;
  disabled: boolean;
  onCommit: (effect: SpriteEffect | null) => void;
  /** 在缩略图上演一遍 */
  onPreview: (effect: SpriteEffect) => void;
}) {
  const effect = normalizeEffect(raw) ?? EMPTY;
  const change = (patch: Partial<SpriteEffect>) => {
    const next = { ...effect, ...patch };
    if (patch.bubble && !effect.sound) {
      next.sound = FX_BUBBLES.find((b) => b.id === patch.bubble)?.sound ?? null;
    }
    const clean = normalizeEffect(next);
    onCommit(clean);
    if (clean) onPreview(clean);
  };
  const pick = (list: { id: string; name: string }[], value: string | null, label: string, key: keyof SpriteEffect) => (
    <label className="pl-field pl-fx-field">
      <span className="conn-label">{label}</span>
      <select
        className="text-input"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => change({ [key]: e.target.value || null })}
      >
        <option value="">不要</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );

  const set = effect.motion || effect.bubble || effect.sound;
  return (
    <div className="pl-fx">
      <span className="pl-fx-title" title="视觉小说里换到这张立绘时放:往下读、表情真的换了才放,往回翻和跳过不放">
        切换特效
      </span>
      {pick(FX_MOTIONS, effect.motion, '动作', 'motion')}
      {pick(FX_BUBBLES, effect.bubble, '气泡', 'bubble')}
      {pick(FX_SOUNDS, effect.sound, '音效', 'sound')}
      <button className="btn small" disabled={!set} onClick={() => onPreview(effect)} title="在左边的缩略图上演一遍">
        试一下
      </button>
    </div>
  );
}
