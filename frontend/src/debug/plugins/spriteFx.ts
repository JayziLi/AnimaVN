/**
 * 立绘切换特效 —— 换到某张立绘时跳一下、头顶冒个气泡、响一声(碧蓝档案剧情那种)。
 *
 * 每张立绘单独设(PackSprite.effect,存在后端,三样都是这里清单的 id,后端不认识它们);
 * 不认识的 id 当作没设。什么时候放见 vn/VNScreen.tsx 的 useSpriteFx:只在往下读、
 * 表情真的换了的那一句放,往回翻、读档、跳过都不放。
 *
 * 音效文件在 public/vn/sfx/,出处见同目录 CREDITS.txt。跳字音效也在这里(设置里选)。
 * 设计见 docs/superpowers/specs/2026-10-04-sprite-switch-effects-design.md
 */

import type { SpriteEffect } from '../lib/api';
import { bgmPlayer } from '../vn/bgm';

export interface FxOption {
  id: string;
  name: string;
}

export const FX_MOTIONS: FxOption[] = [
  { id: 'hop', name: '跳一下' },
  { id: 'hop2', name: '跳两下' },
  { id: 'shake', name: '左右晃' },
  { id: 'shiver', name: '发抖' },
  { id: 'closer', name: '凑近' },
  { id: 'back', name: '往后一缩' },
  { id: 'sink', name: '往下沉' },
];

/** 每个动作的关键帧(Web Animations)。播在立绘外面那层上,% 是那层的尺寸(视觉小说里是整个立绘舞台) */
export const MOTION_FRAMES: Record<string, { frames: Keyframe[]; timing: KeyframeAnimationOptions }> = {
  hop: {
    frames: [{ transform: 'none' }, { transform: 'translateY(-5%)', offset: 0.4 }, { transform: 'none' }],
    timing: { duration: 380, easing: 'cubic-bezier(.3,.7,.4,1)' },
  },
  hop2: {
    frames: [
      { transform: 'none' },
      { transform: 'translateY(-4%)', offset: 0.2 },
      { transform: 'none', offset: 0.45 },
      { transform: 'translateY(-4%)', offset: 0.7 },
      { transform: 'none' },
    ],
    timing: { duration: 620, easing: 'ease-out' },
  },
  shake: {
    frames: [
      { transform: 'none' },
      { transform: 'translateX(-3%)', offset: 0.15 },
      { transform: 'translateX(3%)', offset: 0.35 },
      { transform: 'translateX(-2%)', offset: 0.55 },
      { transform: 'translateX(1.5%)', offset: 0.75 },
      { transform: 'none' },
    ],
    timing: { duration: 450, easing: 'ease-in-out' },
  },
  shiver: {
    frames: Array.from({ length: 11 }, (_, i) => ({
      transform: i === 0 || i === 10 ? 'none' : `translateX(${i % 2 ? -0.6 : 0.6}%)`,
    })),
    timing: { duration: 500, easing: 'linear' },
  },
  // 凑近:放大一点停在那儿一会儿再回来(下一句可能还是这个表情,不能一直大着)
  closer: {
    frames: [
      { transform: 'none' },
      { transform: 'scale(1.07) translateY(2.5%)', offset: 0.25 },
      { transform: 'scale(1.07) translateY(2.5%)', offset: 0.8 },
      { transform: 'none' },
    ],
    timing: { duration: 1600, easing: 'ease-in-out' },
  },
  back: {
    frames: [{ transform: 'none' }, { transform: 'scale(.95) translateY(-1%)', offset: 0.4 }, { transform: 'none' }],
    timing: { duration: 420, easing: 'ease-out' },
  },
  sink: {
    frames: [
      { transform: 'none' },
      { transform: 'translateY(4%)', offset: 0.45 },
      { transform: 'translateY(4%)', offset: 0.7 },
      { transform: 'none' },
    ],
    timing: { duration: 800, easing: 'ease-in-out' },
  },
};

/** 气泡;sound 是选了这个气泡时音效默认填的那个(碧蓝档案同名的原声) */
export const FX_BUBBLES: (FxOption & { sound: string })[] = [
  { id: 'exclaim', name: '！', sound: 'emo-exclaim' },
  { id: 'surprise', name: '！？', sound: 'emo-surprise' },
  { id: 'question', name: '？', sound: 'emo-question' },
  { id: 'heart', name: '爱心', sound: 'emo-heart' },
  { id: 'shy', name: '害羞', sound: 'emo-shy' },
  { id: 'angry', name: '怒筋', sound: 'emo-angry' },
  { id: 'steam', name: '冒气', sound: 'emo-steam' },
  { id: 'upset', name: '心烦', sound: 'emo-upset' },
  { id: 'sweat', name: '流汗', sound: 'emo-sweat' },
  { id: 'tear', name: '流泪', sound: 'emo-tear' },
  { id: 'sad', name: '难过', sound: 'emo-sad' },
  { id: 'sigh', name: '叹气', sound: 'emo-sigh' },
  { id: 'bulb', name: '灵光一闪', sound: 'emo-bulb' },
];

export const FX_SOUNDS: (FxOption & { file: string })[] = [
  { id: 'emo-exclaim', name: '气泡 · ！', file: 'emo-exclaim.wav' },
  { id: 'emo-surprise', name: '气泡 · ！？', file: 'emo-surprise.wav' },
  { id: 'emo-question', name: '气泡 · ？', file: 'emo-question.wav' },
  { id: 'emo-heart', name: '气泡 · 爱心', file: 'emo-heart.wav' },
  { id: 'emo-shy', name: '气泡 · 害羞', file: 'emo-shy.wav' },
  { id: 'emo-angry', name: '气泡 · 怒筋', file: 'emo-angry.wav' },
  { id: 'emo-steam', name: '气泡 · 冒气', file: 'emo-steam.wav' },
  { id: 'emo-upset', name: '气泡 · 心烦', file: 'emo-upset.wav' },
  { id: 'emo-sweat', name: '气泡 · 流汗', file: 'emo-sweat.wav' },
  { id: 'emo-tear', name: '气泡 · 流泪', file: 'emo-tear.wav' },
  { id: 'emo-sad', name: '气泡 · 难过', file: 'emo-sad.wav' },
  { id: 'emo-sigh', name: '气泡 · 叹气', file: 'emo-sigh.wav' },
  { id: 'emo-bulb', name: '气泡 · 灵光一闪', file: 'emo-bulb.wav' },
  { id: 'appear-1', name: '出现 1', file: 'appear-1.wav' },
  { id: 'appear-2', name: '出现 2', file: 'appear-2.wav' },
  { id: 'appear-3', name: '出现 3', file: 'appear-3.wav' },
  { id: 'cartoon-1', name: '卡通 1', file: 'cartoon-1.wav' },
  { id: 'cartoon-2', name: '卡通 2', file: 'cartoon-2.wav' },
  { id: 'face-shake', name: '摇头', file: 'face-shake.wav' },
  { id: 'shaking', name: '发抖', file: 'shaking.wav' },
  { id: 'deflate', name: '泄气', file: 'deflate.mp3' },
];

/** 跳字音效:前三个是现场合成的(没有文件),后三个来自効果音ラボ */
export const TYPE_SOUNDS: (FxOption & { file?: string })[] = [
  { id: 'soft', name: '柔和' },
  { id: '8bit', name: '8-bit' },
  { id: 'click', name: '轻点击' },
  { id: 'cute', name: '可爱', file: 'type-cute.mp3' },
  { id: 'pa', name: '啪', file: 'type-pa.mp3' },
  { id: 'ko', name: '扣', file: 'type-ko.mp3' },
];

const known = (list: FxOption[], id: string | null | undefined) =>
  id && list.some((o) => o.id === id) ? id : null;

/** 后端存的特效 → 认得的部分;一样都不认识(或没设)是 null */
export function normalizeEffect(raw: SpriteEffect | null | undefined): SpriteEffect | null {
  if (!raw) return null;
  const fx = {
    motion: known(FX_MOTIONS, raw.motion),
    bubble: known(FX_BUBBLES, raw.bubble),
    sound: known(FX_SOUNDS, raw.sound),
  };
  return fx.motion || fx.bubble || fx.sound ? fx : null;
}

// ---- 播放:WebAudio,解码好的放缓存,跳字一秒几十下也不卡 ----

const SFX_BASE = '/vn/sfx/';
let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function audio(): AudioContext | null {
  // 游戏里用 BGM 那个:它在玩家点击时解锁过(iOS 上 AudioContext 只能在手势里启动,自己建的
  // 那个从没在手势里 resume 过,一直是哑的)。语音也是这么共用的。BGM 还没解锁时(插件页试听)
  // 才用自己的 —— 试听是点按钮触发的,resume 在手势里
  const shared = bgmPlayer.context;
  if (shared) return shared;
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

// 失败过的文件隔一会儿再试:跳字音每隔一个字就要放一次,文件真没有的话不能每个字都去下一遍
const failedAt = new Map<string, number>();
const RETRY_AFTER_MS = 30_000;

/**
 * 挂起着的能不能叫醒。BGM 那个是切到后台时故意挂起的:后台里自动播放还在翻句,
 * 这时候放个音效把它叫醒,BGM 和语音就在后台接着响了 —— 后台不出音效
 */
function mayResume(ac: AudioContext): boolean {
  return !(ac === bgmPlayer.context && document.hidden);
}

function load(file: string): Promise<AudioBuffer | null> {
  let p = buffers.get(file);
  if (!p) {
    const failed = failedAt.get(file);
    if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve(null);
    const ac = audio();
    p = ac
      ? fetch(SFX_BASE + file)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((b) => ac.decodeAudioData(b))
          .catch(() => null)
      : Promise.resolve(null);
    buffers.set(file, p);
    // 没拿到(网络抖了一下、开发服务器在重启)不记:不然这个音效这次打开页面里一直是哑的
    const mine = p;
    void mine.then((buf) => {
      if (buf !== null) failedAt.delete(file);
      else if (buffers.get(file) === mine) {
        buffers.delete(file);
        failedAt.set(file, Date.now());
      }
    });
  }
  return p;
}

/** 提前解码,第一次放的时候不用等下载 */
export function preloadSfx(files: (string | undefined)[]): void {
  for (const f of files) if (f) void load(f);
}

async function playFile(file: string, volume: number): Promise<void> {
  const ac = audio();
  if (!ac || volume <= 0) return;
  if (ac.state === 'suspended') {
    if (!mayResume(ac)) return;
    await ac.resume().catch(() => undefined);
  }
  const buf = await load(file);
  if (!buf) return;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const gain = ac.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(ac.destination);
  src.start();
}

export function soundFile(id: string | null | undefined): string | undefined {
  return FX_SOUNDS.find((s) => s.id === id)?.file;
}

export function playFxSound(id: string | null | undefined, volume: number): void {
  const file = soundFile(id);
  if (file) void playFile(file, volume);
}

/** 合成的跳字音:很短的一声,不要文件 */
function synth(kind: string, volume: number): void {
  const ac = audio();
  if (!ac || volume <= 0) return;
  if (ac.state === 'suspended') {
    if (!mayResume(ac)) return;
    void ac.resume().catch(() => undefined);
  }
  const t = ac.currentTime;
  const gain = ac.createGain();
  gain.connect(ac.destination);
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
  if (s.file) void playFile(s.file, volume);
  else synth(s.id, volume);
}

export function preloadTypeSound(id: string): void {
  preloadSfx([TYPE_SOUNDS.find((x) => x.id === id)?.file]);
}
