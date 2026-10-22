import { describe, expect, it } from 'vitest';
import { vnTagKinds } from '../vn/tags';
import { NO_JEV } from './jev';
import { LANG_BLOCK_ID, LANG_SETTING_KEY } from './lang';
import { PLAYER_BLOCK_ID, PLAYER_SETTING_KEY } from './player';
import {
  BLOCK_OF,
  JEV_KINDS,
  PLUGIN_BLOCK_IDS,
  PLUGINS,
  blockIdOf,
  kindName,
  navItems,
  pluginOfBlock,
  type PluginRow,
} from './registry';
import { SCENE } from './scene';
import { SPRITE_BLOCK_ID, SPRITE_SETTING_KEY } from './sprite';
import { VOICE_SETTING_KEY } from './voice';

// 总表以前是手写在各处的清单;下面的字面值就是 10-11 各处原来写的,当对照

describe('插件总表', () => {
  it('id、块、设置键、Jev 的那一类都不重复', () => {
    const uniq = (xs: readonly (string | undefined)[]) => {
      const set = xs.filter((x): x is string => x !== undefined);
      expect(new Set(set).size).toBe(set.length);
    };
    const rows: readonly PluginRow[] = PLUGINS;
    uniq(rows.map((p) => p.id));
    uniq(rows.map((p) => p.blockId));
    uniq(rows.map((p) => p.settingKey));
    uniq(rows.map((p) => p.tagKind));
    uniq(rows.map((p) => p.jevKind));
  });

  it('插件块的清单和原来 common.ts 的一样(先后也一样:新块插在已有插件块后面)', () => {
    expect(PLUGIN_BLOCK_IDS).toEqual([
      'anima_sprite',
      'anima_bg',
      'anima_bgm',
      'anima_cg',
      'anima_lang',
      'anima_player',
    ]);
  });

  it('Jev 的几类和原来 jev.ts 的一样', () => {
    expect(JEV_KINDS).toEqual(['sprite', 'bg', 'bgm', 'cg', 'player']);
    expect(NO_JEV).toEqual({ sprite: false, bg: false, bgm: false, cg: false, player: false });
    expect(BLOCK_OF).toEqual({
      sprite: 'anima_sprite',
      bg: 'anima_bg',
      bgm: 'anima_bgm',
      cg: 'anima_cg',
      player: 'anima_player',
    });
  });

  it('插件块 ↔ 插件,和原来 DebugApp 的 pluginOfBlock / blockIdOf 一样', () => {
    const pairs = [
      ['sprite', 'anima_sprite'],
      ['bg', 'anima_bg'],
      ['bgm', 'anima_bgm'],
      ['cg', 'anima_cg'],
      ['lang', 'anima_lang'],
      ['player', 'anima_player'],
    ] as const;
    for (const [id, block] of pairs) {
      expect(blockIdOf(id)).toBe(block);
      expect(pluginOfBlock(block)).toBe(id);
    }
    // 不是插件块的,原来的写法落到立绘
    expect(pluginOfBlock('chatHistory')).toBe('sprite');
  });

  it('插件抽屉左栏的角色组(第 2 步第四版):语音挪到立绘后面,音乐改叫 BGM,玩家台词不单独一页', () => {
    expect(navItems(null).map((p) => [p.id, p.name, p.beta])).toEqual([
      ['sprite', '立绘', false],
      ['voice', '语音', false],
      ['bg', '背景', false],
      ['bgm', 'BGM', false],
      ['cg', 'CG', false],
      ['lang', '外语', false],
    ]);
  });

  it('卡带的那一页插在它说的插件后面,说的插件不在就排最后', () => {
    const panel = (after: string) => ({ key: 'x', title: '某页', beta: true, after });
    expect(navItems(panel('bg')).map((p) => p.id)).toEqual(['sprite', 'voice', 'bg', 'x', 'bgm', 'cg', 'lang']);
    expect(navItems(panel('nope')).map((p) => p.id).at(-1)).toBe('x');
    expect(navItems(panel('bg'))[3]).toEqual({ id: 'x', name: '某页', beta: true });
  });

  it('几个卡带的页各插各的位置,同一个插件后面按传进来的先后', () => {
    const page = (key: string, after: string) => ({ key, title: key, after });
    expect(navItems([page('a', 'cg'), page('b', 'voice'), page('c', 'cg'), page('d', 'nope')]).map((p) => p.id)).toEqual([
      'sprite',
      'voice',
      'b',
      'bg',
      'bgm',
      'cg',
      'a',
      'c',
      'lang',
      'd',
    ]);
  });

  it('设置键和块 id 是存在库里 / 预设里的,一个字都不能变', () => {
    expect(SPRITE_BLOCK_ID).toBe('anima_sprite');
    expect(SPRITE_SETTING_KEY).toBe('plugin.sprite');
    expect([SCENE.bg.blockId, SCENE.bgm.blockId, SCENE.cg.blockId]).toEqual(['anima_bg', 'anima_bgm', 'anima_cg']);
    expect([SCENE.bg.settingKey, SCENE.bgm.settingKey, SCENE.cg.settingKey]).toEqual([
      'plugin.bg',
      'plugin.bgm',
      'plugin.cg',
    ]);
    expect(LANG_BLOCK_ID).toBe('anima_lang');
    expect(LANG_SETTING_KEY).toBe('plugin.lang');
    expect(PLAYER_BLOCK_ID).toBe('anima_player');
    expect(PLAYER_SETTING_KEY).toBe('plugin.player');
    expect(VOICE_SETTING_KEY).toBe('plugin.voice');
  });

  it('标签种类和视觉小说认的那几类对得上(先后也一样)', () => {
    const rows: readonly PluginRow[] = PLUGINS;
    const kinds = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>').map((k) => k.kind);
    expect(rows.flatMap((p) => (p.tagKind ? [p.tagKind] : []))).toEqual(kinds);
  });

  it('kindName:聊天区、视觉小说控制台用的统一叫法', () => {
    expect(['sprite', 'bg', 'bgm', 'cg', 'player'].map(kindName)).toEqual(['立绘', '背景', 'BGM', 'CG', '玩家台词']);
    expect(kindName('什么')).toBe('什么');
  });
});
