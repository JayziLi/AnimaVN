/**
 * 跳字音效(设置里选):逐字显示时每隔一个字响一声,只在旁白上响(什么时候响见 VNScreen.tsx)。
 *
 * 前三个是现场合成的(没有文件),后三个来自効果音ラボ(public/vn/sfx/,出处见同目录 CREDITS.txt)。
 * 走音频总线(audioBus.ts)的 type 声道;设置页试听时总线还没解锁,用总线给短音效另开的那个。
 * 原来和立绘特效音写在一起(plugins/spriteFx.ts),10-11 分出来。
 */

import type { FxOption } from '../plugins/spriteFx';
import { audioBus } from './audioBus';

/** 跳字音效:前三个是现场合成的(没有文件),后三个来自効果音ラボ */
export const TYPE_SOUNDS: (FxOption & { file?: string })[] = [
  { id: 'soft', name: '柔和' },
  { id: '8bit', name: '8-bit' },
  { id: 'click', name: '轻点击' },
  { id: 'cute', name: '可爱', file: 'type-cute.mp3' },
  { id: 'pa', name: '啪', file: 'type-pa.mp3' },
  { id: 'ko', name: '扣', file: 'type-ko.mp3' },
];

/** 合成的跳字音:很短的一声,不要文件 */
function synth(kind: string, volume: number): void {
  const o = audioBus.shortOut('type');
  if (!o || volume <= 0) return;
  const { ac, out } = o;
  if (ac.state === 'suspended') {
    if (!audioBus.mayWake(ac)) return;
    void ac.resume().catch(() => undefined);
  }
  const t = ac.currentTime;
  const gain = ac.createGain();
  gain.connect(out);
  if (kind === 'click') {
    const noise = ac.createBuffer(1, 600, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
    const src = ac.createBufferSource();
    src.buffer = noise;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    src.connect(hp).connect(gain);
    gain.gain.value = volume * 0.8;
    src.start(t);
    return;
  }
  const osc = ac.createOscillator();
  osc.type = kind === '8bit' ? 'square' : 'sine';
  osc.frequency.setValueAtTime(kind === '8bit' ? 880 : 740, t);
  osc.connect(gain);
  const peak = volume * (kind === '8bit' ? 0.12 : 0.35);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  osc.start(t);
  osc.stop(t + 0.07);
}

export function playTypeSound(id: string, volume: number): void {
  const s = TYPE_SOUNDS.find((x) => x.id === id);
  if (!s) return;
  if (s.file) void audioBus.playClip('type', s.file, volume);
  else synth(s.id, volume);
}

/** 提前解码,第一次放的时候不用等下载 */
export function preloadTypeSound(id: string): void {
  audioBus.preloadClips([TYPE_SOUNDS.find((x) => x.id === id)?.file]);
}
