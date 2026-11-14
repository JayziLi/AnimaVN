/**
 * 发给 /generate(出图)和 /connections/{id}/test(测试出图)的请求体怎么拼。纯函数,有测试(request.test.ts)。
 * 以前写在 useImageGen.tsx 的 draw 里;11-07 起测试出图也要同一套,搬到这里
 */

import type { ConnKind, GenerateRequest, LookIn, Picture } from './api';
import { artistsFor, drawModel, drawStyle, sizeOf, usesReference, type CardImagePrefs, type ImageGenConfig } from './config';
import { modelOf, sdSampler } from './connModel';

/** 这张图是哪张卡的、她和玩家在剧情里叫什么(宏展开以后的) */
export interface CardNames {
  cardId: string | null;
  charName: string;
  userName: string;
}

/** 这一张挂在哪、画什么、多大、用哪条连接 */
export interface DrawOrder {
  chatId: string | null;
  entryId: string | null;
  swipe: number | null;
  line: number | null;
  trigger: GenerateRequest['trigger'];
  title: string;
  description: string;
  picture: Picture;
  size: { w: number; h: number };
  connectionId: string | null;
  /** 问指导模型花了几毫秒;没问(换一张、测试出图)不传 */
  planMs?: number | null;
  /** 这条连接的种类(本地 SD 多带调度器、LoRA) */
  connKind?: ConnKind | null;
  /** 过程预览的编号(只本地 SD) */
  jobId?: string;
}

/** 后端 plan_ms 收 0–600000 */
const PLAN_MS_MAX = 600_000;

/** 每个人平时的样子:她、玩家。指导模型偶尔把玩家写成「玩家」「你」:都当玩家 */
export function looksFor(
  c: ImageGenConfig,
  p: CardImagePrefs,
  names: Pick<CardNames, 'charName' | 'userName'>,
): Record<string, LookIn> {
  const player: LookIn = {
    tags: c.player.look,
    outfit: c.player.outfit,
    negative: c.player.negative,
    gender: c.player.gender,
    player: true,
  };
  return {
    [names.charName]: {
      tags: p.look,
      outfit: p.outfit,
      negative: p.negative,
      gender: p.gender,
      name_tag: p.nameTag,
      // 模型用不了参考图时后端自己跳过,这里照卡上的设置带
      ref: p.ref.kind === 'off' ? null : { kind: p.ref.kind, id: p.ref.id, style: p.ref.style, strength: p.ref.strength },
    },
    [names.userName]: player,
    玩家: player,
    你: player,
  };
}

/** 出图的请求体:这张卡的设置(这条连接下的那份)+ 长相 + 这一幕 */
export function buildGenerate(c: ImageGenConfig, p: CardImagePrefs, names: CardNames, o: DrawOrder): GenerateRequest {
  const style = drawStyle(c, p);
  const sd = o.connKind === 'sdapi';
  return {
    card_id: names.cardId,
    chat_id: o.chatId,
    entry_id: o.entryId,
    swipe: o.swipe,
    line: o.line,
    trigger: o.trigger,
    title: o.title,
    description: o.description,
    picture: o.picture,
    looks: looksFor(c, p, names),
    style: { tags: style.tags, negative: style.negative, artists: artistsFor(c, p) },
    model: sd ? modelOf('sdapi', c.model) : drawModel(c, p),
    width: o.size.w,
    height: o.size.h,
    steps: c.steps,
    scale: c.scale,
    sampler: sd ? sdSampler(c.sampler) : c.sampler,
    noise_schedule: c.noise,
    cfg_rescale: c.rescale,
    variety: c.variety,
    ...(c.seed !== null ? { seed: c.seed } : {}),
    quality: c.quality,
    uc_preset: c.ucPreset,
    uc: c.uc,
    sfw_only: p.sfwOnly,
    allow_paid: c.allowPaid,
    connection_id: o.connectionId,
    ...(typeof o.planMs === 'number' ? { plan_ms: Math.min(PLAN_MS_MAX, Math.max(0, Math.round(o.planMs))) } : {}),
    ...(sd ? { scheduler: c.scheduler, loras: c.loras, ...(o.jobId ? { job_id: o.jobId } : {}) } : {}),
  };
}

/** 测试出图画的那一幕:白天窗边,她一个人看着你(第一人称,不画玩家) */
export function trialPicture(who: string): Picture {
  return {
    scene: 'indoors, window, afternoon, sunlight',
    people: [{ who, tags: 'solo, standing, smile, looking at viewer', clothes: '', look: null }],
    nsfw: false,
    pov: true,
    composition: 'cowboy shot',
  };
}

/** 没选卡、这张卡也没写长相时用的样子 */
export const TRIAL_LOOK = { look: 'adult, long hair, smile', outfit: 'white shirt, long skirt' } as const;

/**
 * 测试出图的请求体(设计第 7 节):固定一幕,用这张卡的长相和这条连接下的设置,不挂在哪条消息上。
 * 没选卡:叫「她」、用 TRIAL_LOOK、不带参考图;卡上没写长相、也不靠参考图:用 TRIAL_LOOK
 */
export function buildTrial(
  c: ImageGenConfig,
  p: CardImagePrefs,
  names: CardNames,
  connectionId: string,
  screen: { width: number; height: number },
  extra: Pick<DrawOrder, 'connKind' | 'jobId'> = {},
): GenerateRequest {
  const name = names.charName.trim() || '她';
  let prefs: CardImagePrefs = names.cardId ? p : { ...p, ref: { ...p.ref, kind: 'off' } };
  if (!prefs.look.trim() && !usesReference(c, prefs)) {
    prefs = { ...prefs, look: TRIAL_LOOK.look, outfit: prefs.outfit || TRIAL_LOOK.outfit };
  }
  return buildGenerate(c, prefs, { ...names, charName: name }, {
    chatId: null,
    entryId: null,
    swipe: null,
    line: null,
    trigger: 'manual',
    title: '测试出图',
    description: '',
    picture: trialPicture(name),
    size: sizeOf(c, c.size, screen),
    connectionId,
    ...extra,
  });
}
