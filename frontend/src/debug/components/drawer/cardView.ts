/**
 * 插件抽屉「看哪张卡」(第 2 步,plans/2026-10-16-asset-arch-step2-impl.md D3):抽屉里选的那张卡用了哪些素材。
 * 左栏的圆点、页头的小标签、卡带的「这张卡在不在用」都看它。
 *
 * 按卡单独去读(useCardView.ts),不切换调试台当前的卡。场景素材的拼法和游戏一样(scenePacks.ts 的 mergeBoundScene):
 * 背景只算出背景的包、BGM 只算出曲子的包,CG 算没拆过的场景包和这张卡绑的 CG 包;都只数启用的,CG 只数构图。
 */

import type {
  CardPrefs,
  CardSceneParts,
  CardSpritePacks,
  CardVoices,
  CgPack,
  PackSprite,
  SceneAsset,
  ScenePack,
  SpritePack,
  TtsApiType,
  TtsConnection,
  VoiceProfile,
} from '../../lib/api';
import { enabledOnly } from '../../plugins/common';
import { emotionListRef } from '../../plugins/emotionMatch';
import { isJaLang } from '../../plugins/lang';
import { backgroundsOf, bgmsOf, cgsOf } from '../../plugins/scene';
import { mergeBoundScene, sceneUnion } from '../../plugins/scenePacks';

/** 抽屉里看的那张卡用了哪些素材 */
export interface DrawerCardFacts {
  id: string;
  name: string;
  /** 启用的立绘张数(当前立绘包) */
  sprites: number;
  spritePack: { id: string; name: string } | null;
  /** 认词记录用的名单:pack:<立绘包 id>;没立绘时 'builtin' */
  listRef: string;
  mainVoice: VoiceProfile | null;
  /** 挂着的声音(主声音、备用);语音页换主声音时在这上面改 */
  voices: CardVoices;
  /** 场景包 / CG 包:包名(排第一的)和启用的背景、BGM、CG 构图各几个 */
  scene: { packName: string | null; bg: number; bgm: number; cgPackName: string | null; cg: number };
  /** 这张卡另设过的全部项(card_prefs);卡带看自己那一项(比如 AI 生图写没写长相)。没读到是 {} */
  prefs: CardPrefs;
}

/** 按卡读回来的原样数据(useCardView 读的那几个接口) */
export interface CardViewRaw {
  card: { id: string; name: string };
  /** 挂着哪些立绘包、哪个是当前 */
  packs: CardSpritePacks;
  /** 立绘包列表(取包名);不给就不写名字 */
  spritePacks?: readonly Pick<SpritePack, 'id' | 'name'>[];
  /** 当前立绘包里的立绘(含停用的) */
  sprites: readonly PackSprite[];
  sceneParts: CardSceneParts;
  /** 绑着的场景包里的全部素材(含停用的),几个包接在一起 */
  sceneAssets: readonly SceneAsset[];
  /** 场景包列表(取包名;cg_pack_id 说明包里的 CG 拆出去了) */
  scenePacks?: readonly Pick<ScenePack, 'id' | 'name' | 'cg_pack_id'>[];
  /** 这张卡绑的 CG 包,按顺序 */
  cgPackIds?: readonly string[];
  /** 绑着的 CG 包里的全部 CG(含停用的、差分) */
  cgAssets: readonly SceneAsset[];
  cgPacks?: readonly Pick<CgPack, 'id' | 'name'>[];
  voices: CardVoices;
  /** 全部声音(主声音在里面找) */
  profiles: readonly VoiceProfile[];
  prefs?: CardPrefs;
}

const nameIn = (list: readonly { id: string; name: string }[] | undefined, id: string | undefined) =>
  id === undefined ? null : (list?.find((p) => p.id === id)?.name ?? null);

export function cardFacts(raw: CardViewRaw): DrawerCardFacts {
  const sprites = enabledOnly(raw.sprites);
  const current = raw.packs.current;
  const lists: Record<string, SceneAsset[]> = {};
  for (const a of raw.sceneAssets) (lists[a.pack_id] ??= []).push(a);
  const scene = enabledOnly(mergeBoundScene(raw.sceneParts, lists, raw.scenePacks ?? [], [raw.cgAssets]));
  const firstScene = raw.sceneParts.bg[0] ?? sceneUnion(raw.sceneParts)[0];
  return {
    id: raw.card.id,
    name: raw.card.name,
    sprites: sprites.length,
    spritePack: current ? { id: current, name: nameIn(raw.spritePacks, current) ?? '' } : null,
    listRef: emotionListRef(sprites),
    mainVoice: raw.profiles.find((p) => p.id === raw.voices.main) ?? null,
    voices: raw.voices,
    scene: {
      packName: firstScene === undefined ? null : (nameIn(raw.scenePacks, firstScene) ?? ''),
      bg: backgroundsOf(scene).length,
      bgm: bgmsOf(scene).length,
      cgPackName: nameIn(raw.cgPacks, raw.cgPackIds?.[0]),
      cg: cgsOf(scene).length,
    },
    prefs: raw.prefs ?? {},
  };
}

const ENGINE_NAME: Record<TtsApiType, string> = { gpt_sovits: 'GPT-SoVITS', indextts: 'IndexTTS-2.5' };

/** 「5090 · GPT-SoVITS」:连接名里已经有引擎名就不重复 */
export function connectionLabel(c: TtsConnection): string {
  const engine = ENGINE_NAME[c.api_type];
  return c.name.includes(engine) ? c.name : `${c.name} · ${engine}`;
}

/** 页头的小标签:「玉衡星 · 14 张」「刻晴(中文)」「用 5090 · GPT-SoVITS」 */
export function headTags(page: string, f: DrawerCardFacts, connections: readonly TtsConnection[]): string[] {
  const main = f.mainVoice;
  const s = f.scene;
  switch (page) {
    case 'sprite':
      return f.spritePack ? [`${f.spritePack.name || '立绘包'} · ${f.sprites} 张`] : ['没绑立绘'];
    case 'voice': {
      if (!main) return ['没设音色'];
      const c = connections.find((x) => x.id === main.connection_id);
      return c ? [main.name, `用 ${connectionLabel(c)}`] : [main.name];
    }
    case 'bg':
      return s.packName !== null ? [`${s.packName || '场景包'} · ${s.bg} 张`] : ['没绑场景包'];
    case 'bgm':
      return s.packName !== null ? [`${s.packName || '场景包'} · ${s.bgm} 首`] : ['没绑场景包'];
    case 'cg':
      if (s.cg === 0 && s.cgPackName === null) return ['没绑 CG 包'];
      return [`${s.cgPackName ?? s.packName ?? 'CG'} · ${s.cg} 张`];
    case 'lang':
      return main ? [`${main.name}的声音${isJaLang(main.text_lang) ? '是' : '不是'}日语`] : ['没设音色'];
    default:
      return [];
  }
}

/**
 * 「看哪张卡」下拉里每张卡写什么:名字只出现一次就写名字;同名的几张在后面接上创作者注释的第一小段
 * (「日语配音版：……」→「刻晴 · 日语配音版」),没有注释或注释开头也一样时接「第 N 张」
 */
export function pickLabels(cards: readonly { id: string; name: string; note?: string }[]): Map<string, string> {
  const name = (c: { name: string }) => c.name || '(未命名)';
  const head = (note = '') => note.trim().split(/[：:，,。.\n]/)[0].trim().slice(0, 12);
  const out = new Map<string, string>();
  const groups = new Map<string, typeof cards[number][]>();
  for (const c of cards) groups.set(name(c), [...(groups.get(name(c)) ?? []), c]);
  for (const [n, same] of groups) {
    if (same.length === 1) {
      out.set(same[0].id, n);
      continue;
    }
    const heads = same.map((c) => head(c.note));
    same.forEach((c, i) => {
      const h = heads[i];
      const unique = h && heads.filter((x) => x === h).length === 1;
      out.set(c.id, `${n} · ${unique ? h : `第 ${i + 1} 张`}`);
    });
  }
  return out;
}
