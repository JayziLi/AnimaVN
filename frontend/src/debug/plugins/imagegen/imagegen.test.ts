import { describe, expect, it } from 'vitest';
import type { ChatEntry, SwipeInfo, VnImageMark } from '../../lib/chatEntry';
// 先加载登记处(它再加载各卡带),和内核加载的顺序一样
import { cartridge, extension } from '../cartridges';
import type { DrawerCardFacts } from '../../components/drawer/cardView';
import { navItems } from '../registry';
import { IMAGEGEN_PANEL, imagegenInUse } from './useImageGen';
import {
  anlasCost,
  artistsFor,
  drawModel,
  drawStyle,
  BUILTIN_STYLES,
  DEFAULT_CARD_PREFS,
  DEFAULT_IMAGEGEN_CONFIG,
  isFree,
  normalizeCardPrefs,
  normalizeImageGenConfig,
  sizeOf,
  snapSide,
  styleFor,
  UC_LIGHT,
  usesReference,
  withLook,
} from './config';
import { addImage, blockedByCooldown, endOf, imagesOf, markAt, patchImage, repliesSinceImage } from './marks';

const entry = (id: string, role: 'user' | 'assistant', images?: VnImageMark[], swipes = 1): ChatEntry => ({
  id,
  role,
  swipes: Array.from({ length: swipes }, () => 'x'),
  swipeIndex: swipes - 1,
  swipeInfo: Array.from({ length: swipes }, (_, i) =>
    i === swipes - 1 && images ? ({ sendDate: '', vn: { images } } as SwipeInfo) : ({ sendDate: '' } as SwipeInfo),
  ),
  overswipe: 'regenerate',
});

describe('生图卡带 · 设置', () => {
  it('库里没有时是默认值:V5 Curated、尺寸跟屏幕走、23 步、速写画风、自动出图开着、冷却 3', () => {
    const c = normalizeImageGenConfig(undefined);
    expect(c).toEqual(DEFAULT_IMAGEGEN_CONFIG);
    expect(c.model).toBe('nai-diffusion-5-curated');
    expect(c.styleId).toBe('fuzi_rella');
    expect(c.auto).toEqual({ enabled: true, cooldown: 3 });
    // 默认的画风是复制出来的,改了不会改到内置那份
    c.styles[0].tags = 'changed';
    expect(BUILTIN_STYLES[0].tags).not.toBe('changed');
  });

  it('不认识的值退回默认,数字压进范围', () => {
    const c = normalizeImageGenConfig({
      model: 'sd15',
      size: 'huge',
      steps: 99,
      scale: -3,
      styles: [{ id: 'a', name: 'A', tags: 't' }, { id: 'a', name: 'dup' }, { name: 'no id' }],
      styleId: 'gone',
      writer: { connectionId: '', thinking: 'max' },
      skills: { manual: '   ', auto: '自己写的' },
      auto: { enabled: false, cooldown: 100 },
      player: { gender: 'x' },
    });
    expect(c.model).toBe('nai-diffusion-5-curated');
    expect(c.size).toBe('screen');
    expect(c.steps).toBe(50);
    expect(c.scale).toBe(0);
    // 库里是第 1 版的画风:自己的留着,第 2 版新加的内置画风补在后面(第 1 版就有、删掉了的不补)
    expect(c.styles[2]).toEqual({ id: 'a', name: 'A', tags: 't', negative: '', artists: '' });
    expect(c.styles.map((s) => s.id)).toEqual(['yd_hiten', 'fuzi_rella', 'a']);
    // 选的画风不在了:换成默认的 fuzichoco + rella(补进来了)
    expect(c.styleId).toBe('fuzi_rella');
    expect(c.writer).toEqual({ connectionId: null, thinking: 'off' });
    expect(c.skills).toMatchObject({ manual: null, auto: '自己写的' });
    expect(c.auto).toEqual({ enabled: false, cooldown: 20 });
    expect(c.player.gender).toBe('male');
  });

  it('这张卡的那份:画风另选还在就用它,删掉了退回全局', () => {
    const c = normalizeImageGenConfig(undefined);
    expect(normalizeCardPrefs(null)).toEqual(DEFAULT_CARD_PREFS);
    expect(styleFor(c, normalizeCardPrefs({ styleId: 'anime' })).id).toBe('anime');
    expect(styleFor(c, normalizeCardPrefs({ styleId: 'deleted' })).id).toBe('fuzi_rella');
  });

  it('尺寸:分辨率预设 × 方向;跟屏幕走时竖屏用竖图;宽屏和 Normal 都在免费范围里', () => {
    const c = normalizeImageGenConfig(undefined);
    expect(c.res).toBe('wide');
    expect(sizeOf(c, 'screen', { width: 400, height: 800 })).toEqual({ w: 768, h: 1344 });
    expect(sizeOf(c, 'screen', { width: 1600, height: 900 })).toEqual({ w: 1344, h: 768 });
    expect(sizeOf({ ...c, res: 'normal' }, 'landscape', { width: 1, height: 1 })).toEqual({ w: 1216, h: 832 });
    for (const res of ['wide', 'normal'] as const) {
      for (const k of ['landscape', 'portrait', 'square'] as const) {
        const s = sizeOf({ ...c, res }, k, { width: 1, height: 1 });
        expect(isFree(s.w, s.h, 28)).toBe(true);
      }
    }
    // Wallpaper 没有方的:退成横的
    expect(sizeOf({ ...c, res: 'wallpaper' }, 'square', { width: 1, height: 1 })).toEqual({ w: 1920, h: 1088 });
    // 自定义:按方向把长边短边对调,方的取同样面积(对齐 64)
    const custom = { res: 'custom' as const, custom: { w: 768, h: 1344 } };
    expect(sizeOf(custom, 'landscape', { width: 1, height: 1 })).toEqual({ w: 1344, h: 768 });
    expect(sizeOf(custom, 'square', { width: 1, height: 1 })).toEqual({ w: 1024, h: 1024 });
    expect(snapSide(1000)).toBe(1024);
    expect(snapSide(9999)).toBe(2048);
    expect(isFree(1536, 1024, 23)).toBe(false);
    expect(isFree(1344, 768, 29)).toBe(false);
  });

  it('扣多少 Anlas 照网页的算法:Opus 免费范围是 0;V5 832×1216 23 步 26、V4.5 17', () => {
    expect(anlasCost({ model: 'nai-diffusion-5-curated', w: 832, h: 1216, steps: 23, opus: true })).toBe(0);
    expect(anlasCost({ model: 'nai-diffusion-5-curated', w: 832, h: 1216, steps: 23, opus: false })).toBe(26);
    // 10-09 Tablet 上 V5 1344×768 23 步实扣 26
    expect(anlasCost({ model: 'nai-diffusion-5-curated', w: 1344, h: 768, steps: 23, opus: false })).toBe(26);
    expect(anlasCost({ model: 'nai-diffusion-4-5-full', w: 832, h: 1216, steps: 23, opus: false })).toBe(17);
    expect(anlasCost({ model: 'nai-diffusion-4-5-full', w: 1536, h: 1024, steps: 23, opus: true })).toBeGreaterThan(0);
  });

  it('出图用的模型和画风:只画全年龄的卡换成 Curated;画风卡另选的优先', () => {
    const c = { ...normalizeImageGenConfig(undefined), model: 'nai-diffusion-4-5-full' };
    expect(drawModel(c, DEFAULT_CARD_PREFS)).toBe('nai-diffusion-4-5-full');
    expect(drawModel(c, { ...DEFAULT_CARD_PREFS, sfwOnly: true })).toBe('nai-diffusion-4-5-curated');
    expect(drawStyle(c, { ...DEFAULT_CARD_PREFS, styleId: 'yd_hiten' }).id).toBe('yd_hiten');
    expect(artistsFor(c, DEFAULT_CARD_PREFS)).toContain('fuzichoco');
  });

  it('旧设置搬过来:默认那串反向认成 Light 预设,改过的原样留着;质量词开关换成预设;没动过的旧内置画风换新', () => {
    const old = normalizeImageGenConfig({ uc: UC_LIGHT, quality: false, styles: [{ id: 'anime', name: '彩色动画', tags: 'flat color, cel shading, anime coloring' }] });
    expect(old.ucPreset).toBe('light');
    expect(old.uc).toBe('');
    expect(old.quality).toBe('none');
    expect(old.styles.find((s) => s.id === 'anime')).toEqual(BUILTIN_STYLES.find((s) => s.id === 'anime'));
    const mine = normalizeImageGenConfig({ uc: 'lowres, extra arms', styles: [{ id: 'anime', name: '我的', tags: 'x' }] });
    expect(mine.ucPreset).toBe('none');
    expect(mine.uc).toBe('lowres, extra arms');
    expect(mine.styles.find((s) => s.id === 'anime')?.name).toBe('我的');
    // 第 2、3 版加的去掉、第 4 版的补上
    expect(normalizeImageGenConfig({ styles: [{ id: 'painterly', name: 'p' }, { id: 'a', name: 'A' }], stylesVersion: 3 }).styles.map((s) => s.id)).toEqual(['yd_hiten', 'fuzi_rella', 'a']);
    // 存过一次(记了版本)以后删掉的新画风不会再补回来
    expect(normalizeImageGenConfig({ styles: [{ id: 'a', name: 'A' }], stylesVersion: 4 }).styles.map((s) => s.id)).toEqual(['a']);
    // 采样器换了噪声调度跟着默认;种子只收整数
    const c = normalizeImageGenConfig({ sampler: 'k_dpmpp_2m', seed: 1.5, scale: 15 });
    expect(c.noise).toBe('exponential');
    expect(c.seed).toBeNull();
    expect(c.scale).toBe(10);
  });

  it('参考图默认用立绘;上传的没有编号退回立绘;只有 V4.5 用得上、关了就不用', () => {
    expect(DEFAULT_CARD_PREFS.ref).toEqual({ kind: 'sprite', id: null, sha: null, style: false });
    expect(normalizeCardPrefs({ ref: { kind: 'upload', id: '' } }).ref.kind).toBe('sprite');
    expect(normalizeCardPrefs({ ref: { kind: 'upload', id: 'r1', sha: 'abc', style: true } }).ref).toEqual({
      kind: 'upload',
      id: 'r1',
      sha: 'abc',
      style: true,
    });
    expect(normalizeCardPrefs({ ref: { kind: 'off', id: 'x' } }).ref).toEqual({ kind: 'off', id: null, sha: null, style: false });
    const v5 = normalizeImageGenConfig(undefined);
    const v45 = { ...v5, model: 'nai-diffusion-4-5-full' };
    expect(usesReference(v5, DEFAULT_CARD_PREFS)).toBe(false);
    expect(usesReference(v45, DEFAULT_CARD_PREFS)).toBe(true);
    expect(usesReference(v45, normalizeCardPrefs({ ref: { kind: 'off' } }))).toBe(false);
  });

  it('镜头只有一个全局设置,默认第一人称;不认识的值退回默认,卡上不存镜头', () => {
    expect(normalizeImageGenConfig(undefined).camera).toBe('pov');
    expect(normalizeImageGenConfig({ camera: 'auto' }).camera).toBe('auto');
    expect(normalizeImageGenConfig({ camera: 'fisheye' }).camera).toBe('pov');
    expect('camera' in normalizeCardPrefs({ camera: 'third' })).toBe(false);
  });

  it('画师串:卡上填了用卡的,没填跟画风;读卡写的外貌认不出角色名时留着原来的', () => {
    const c = normalizeImageGenConfig({ styles: [{ id: 'a', name: 'A', tags: '', negative: '', artists: 'artist:foo' }], styleId: 'a' });
    expect(artistsFor(c, DEFAULT_CARD_PREFS)).toBe('artist:foo');
    expect(artistsFor(c, { ...DEFAULT_CARD_PREFS, artists: 'artist:bar' })).toBe('artist:bar');
    expect(normalizeImageGenConfig({ styles: [{ id: 'b', name: 'B' }] }).styles.find((x) => x.id === 'b')?.artists).toBe('');
    const prefs = { ...DEFAULT_CARD_PREFS, nameTag: 'keqing (genshin impact)', outfit: 'dress' };
    expect(withLook(prefs, { tags: 'purple hair', outfit: '', gender: 'female', name_tag: '' })).toEqual({
      ...prefs,
      look: 'purple hair',
    });
    expect(withLook(DEFAULT_CARD_PREFS, { tags: 'x', outfit: 'y', gender: 'male', name_tag: 'amiya (arknights)' })).toEqual(
      expect.objectContaining({ look: 'x', outfit: 'y', gender: 'male', nameTag: 'amiya (arknights)' }),
    );
  });
});

describe('生图卡带 · 图挂在消息上', () => {
  const m = (line: number, id: string, hidden?: boolean): VnImageMark => ({ line, id, sha: `sha-${id}`, ...(hidden ? { hidden } : {}) });

  it('每句显示这句或之前最近的那一张;收起的那张不显示,更早的也不冒回来', () => {
    const e = entry('e', 'assistant', [m(5, 'b'), m(2, 'a', false)]);
    expect(markAt(e, 1)).toBeNull();
    expect(markAt(e, 2)?.id).toBe('a');
    expect(markAt(e, 4)?.id).toBe('a');
    expect(markAt(e, 8)?.id).toBe('b');
    const hidden = patchImage(e, 0, 'b', (x) => ({ ...x, hidden: true }));
    expect(markAt(hidden, 8)).toBeNull();
    expect(markAt(hidden, 3)?.id).toBe('a');
  });

  it('到结束句为止:指导模型写了 until 就到那句,没写挂 4 句;最少挂 3 句;过了就不显示,更早的也不冒回来', () => {
    const e = entry('e', 'assistant', [{ ...m(2, 'a'), until: 6 }, m(10, 'b')]);
    expect(markAt(e, 6)?.id).toBe('a');
    expect(markAt(e, 7)).toBeNull();
    expect(markAt(e, 13)?.id).toBe('b');
    expect(markAt(e, 14)).toBeNull();
    expect(endOf({ ...m(5, 'x'), until: 2 })).toBe(8);
    // 判得太早(画的那句就结束):也挂够最少的句数;设置改了跟着
    expect(endOf({ ...m(5, 'x'), until: 5 })).toBe(7);
    expect(endOf({ ...m(5, 'x'), until: 5 }, { min: 1, fallback: 4 })).toBe(5);
    expect(endOf(m(5, 'x'), { min: 1, fallback: 2 })).toBe(6);
    expect(markAt(e, 12, { min: 1, fallback: 2 })).toBeNull();
    const added = addImage(entry('f', 'assistant'), 0, { line: 4, until: 9, id: 'n', sha: 's' });
    expect(imagesOf(added)).toEqual([{ line: 4, until: 9, id: 'n', sha: 's' }]);
  });

  it('挂一张:只动那个分支,同一句的旧图被顶掉,别的记号原样留着', () => {
    const e = entry('e', 'assistant', undefined, 2);
    e.swipeInfo[1] = { sendDate: '', vn: { manual: [{ line: 0, item: 'x', label: 'x' }] } };
    const once = addImage(e, 1, m(3, 'a'));
    const twice = addImage(once, 1, m(3, 'b'));
    expect(imagesOf(twice, 1).map((x) => x.id)).toEqual(['b']);
    expect(twice.swipeInfo[1].vn?.manual).toHaveLength(1);
    expect(twice.swipeInfo[0]).toEqual(e.swipeInfo[0]);
    expect(e.swipeInfo[1].vn?.images).toBeUndefined();
  });

  it('格式不对的记号不算', () => {
    const e = entry('e', 'assistant', [{ line: 'x' } as unknown as VnImageMark, m(1, 'ok')]);
    expect(imagesOf(e).map((x) => x.id)).toEqual(['ok']);
  });

  it('冷却:上一张在几条回复以前;中间至少隔 cooldown 条,重要度 3 不挡', () => {
    const es = [
      entry('a1', 'assistant', [m(0, 'x')]),
      entry('u1', 'user'),
      entry('a2', 'assistant'),
      entry('u2', 'user'),
      entry('a3', 'assistant'),
    ];
    expect(repliesSinceImage(es, 4)).toBe(2);
    expect(repliesSinceImage(es, 2)).toBe(1);
    expect(repliesSinceImage([entry('a', 'assistant')], 1)).toBeNull();
    expect(blockedByCooldown(2, 3, 2)).toBe(true);
    expect(blockedByCooldown(3, 3, 2)).toBe(true);
    expect(blockedByCooldown(4, 3, 2)).toBe(false);
    expect(blockedByCooldown(1, 3, 3)).toBe(false);
    expect(blockedByCooldown(null, 3, 1)).toBe(false);
  });
});

describe('生图卡带 · 登记', () => {
  it('内核要到的插图扩展点就是它;插件抽屉角色组里「AI 生图 BETA」排在外语后面', () => {
    expect(cartridge('imagegen')?.name).toBe('AI 生图');
    expect(extension('useIllustrations')).toBe(cartridge('imagegen')?.useIllustrations);
    const ids = navItems(IMAGEGEN_PANEL).map((p) => p.id);
    expect(ids.indexOf('imagegen')).toBe(ids.indexOf('lang') + 1);
    expect(IMAGEGEN_PANEL).toMatchObject({ title: 'AI 生图', group: 'role', power: 'illustrations' });
  });

  it('这张卡在不在用:它自己那份里写了长相或角色名', () => {
    const card = (prefs: DrawerCardFacts['prefs']) => ({ prefs }) as DrawerCardFacts;
    expect(imagegenInUse(card({}))).toBe(false);
    expect(imagegenInUse(card({ 'plugin.imagegen': { look: '  ' } }))).toBe(false);
    expect(imagegenInUse(card({ 'plugin.imagegen': { look: 'long hair' } }))).toBe(true);
    expect(imagegenInUse(card({ 'plugin.imagegen': { nameTag: 'keqing (genshin impact)' } }))).toBe(true);
  });
});
