/**
 * 立绘切换特效 —— 换到某张立绘时跳一下、头顶冒个气泡、响一声(碧蓝档案剧情那种)。
 *
 * 每张立绘单独设(PackSprite.effect,存在后端,三样都是这里清单的 id,后端不认识它们);
 * 不认识的 id 当作没设。什么时候放见 vn/VNScreen.tsx 的 useSpriteFx:只在往下读、
 * 表情真的换了的那一句放,往回翻、读档、跳过都不放;这句有 CG 盖着立绘时也不放(fxStep)。
 *
 * 音效文件在 public/vn/sfx/,出处见同目录 CREDITS.txt,走音频总线(vn/audioBus.ts)的 fx 声道。
 * 跳字音效在 vn/typeSound.ts(设置里选)。
 * 设计见 docs/superpowers/specs/2026-10-04-sprite-switch-effects-design.md
 */

import type { SpriteEffect } from '../lib/api';
import { audioBus } from '../vn/audioBus';

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

// ---- 播放:走音频总线的 fx 声道(解码好的放缓存,见 vn/audioBus.ts) ----

/** 提前解码,第一次放的时候不用等下载 */
export function preloadSfx(files: (string | undefined)[]): void {
  audioBus.preloadClips(files);
}

export function soundFile(id: string | null | undefined): string | undefined {
  return FX_SOUNDS.find((s) => s.id === id)?.file;
}

export function playFxSound(id: string | null | undefined, volume: number): void {
  const file = soundFile(id);
  if (file) void audioBus.playClip('fx', file, volume);
}

// ---- 什么时候放 ----

/**
 * 立绘层这一刻对排上的那次切换特效怎么办(VNScreen 的 SpriteLayer 用):
 *   wait —— 没有要放的、这次已经处理过了、要的那张图还没换上来(新图下载完之前还留着旧图)
 *   skip —— 轮到了,但这句有 CG 盖着立绘(立绘看不见):动作、气泡、音效都不放,CG 收起时也不补
 *   play —— 放
 */
export function fxStep(
  cue: { id: number; target: string } | null,
  played: number,
  shownKey: string,
  covered: boolean,
): 'wait' | 'skip' | 'play' {
  if (!cue || cue.id === played || shownKey !== cue.target) return 'wait';
  return covered ? 'skip' : 'play';
}

/**
 * 换到 nextKey 这张时要不要直接换、不淡入(VNScreen 的 SpriteLayer 用):
 * 平时新表情叠在旧表情上 .2s 淡入;可这次要是带动作或气泡,动作一开始新图还半透明、旧图还在底下,
 * 两张一起跳 —— 看着像上一张没走、下一张的动画就来了。所以带动作 / 气泡的这次直接换上,再放特效。
 * 只有音效、这句被 CG 盖着、已经放过、或者换的不是它要的那张:照常淡入。减少动态时动作不放,只看气泡
 */
export function fxSwapsInstantly(
  cue: { id: number; target: string; effect: { motion?: string | null; bubble?: string | null } } | null,
  played: number,
  nextKey: string,
  covered: boolean,
  reduceMotion: boolean,
): boolean {
  if (!cue || cue.id === played || cue.target !== nextKey || covered) return false;
  const motion = Boolean(cue.effect.motion && MOTION_FRAMES[cue.effect.motion]) && !reduceMotion;
  return motion || Boolean(cue.effect.bubble);
}

/**
 * 立绘外面那层(.vn-sprite-fx)上的动作还在放吗(VNScreen 的 SpriteLayer 用)。
 * 读得快 / 自动播放时,上一张的动作还没放完就换到下一张:这次就算下一张没设特效也直接换上 ——
 * 不然新图淡入的那 0.2 秒,旧图还在底下跟着一起跳
 */
export function motionPlaying(el: { getAnimations: () => { playState: AnimationPlayState }[] } | null): boolean {
  return Boolean(el?.getAnimations().some((a) => a.playState === 'running'));
}
