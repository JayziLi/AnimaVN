import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Beat } from '../core/beats';
import { buildTimeline } from '../core/timeline';
import { beat, CHAR, ctxOf, hit, resolverOf, sprite } from '../core/timeline.fixtures';
import type { JevStats } from '../plugins/jevRun';
import type { SceneState } from '../plugins/scene';
import { ConsoleView, type ConsoleViewProps } from './ConsoleView';
import { vnTagKinds } from './tags';

const sprites = [sprite('s1', '微笑'), sprite('s2', '平静')];
const kinds = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
const SCENE: SceneState = { bg: null, bgm: null, cg: null } as unknown as SceneState;
const STAGE = { faceTop: 0.12, faceScale: 1 } as unknown as ConsoleViewProps['spriteStage'];
const LAYOUT = { auto: true, zoom: 1, dx: 0, dy: 0 };

/** 一条三句的回复:第 0 句微笑(对得上),第 1 句「惊讶」(对不上),第 2 句平静 */
function reply(jev?: JevStats): Beat {
  const b = beat('a0', 3, [hit('sprite', '微笑', 0), hit('sprite', '惊讶', 1), hit('sprite', '平静', 2)]);
  b.raw = '<sprite:微笑>你好<sprite:惊讶>哎<sprite:平静>再见';
  b.parsed!.lines = [
    { speaker: CHAR, text: '你好' },
    { speaker: CHAR, text: '哎' },
    { speaker: null, text: '再见' },
  ];
  if (jev) b.entry = { ...b.entry, swipeInfo: [{ sendDate: '', jev }] };
  return b;
}

function props(b: Beat | null, extra: Partial<ConsoleViewProps> = {}): ConsoleViewProps {
  const ctx = ctxOf({ sprites, resolve: resolverOf(sprites) });
  const beats = b ? [b] : [];
  return {
    beat: b,
    beatNumber: b ? 1 : 0,
    beatIndex: b ? 0 : -1,
    line: 0,
    timeline: buildTimeline(beats, ctx),
    sprites,
    spriteStage: STAGE,
    spriteLayout: LAYOUT,
    emotion: ctx.emotion,
    tagKinds: kinds,
    sceneAssets: [],
    scene: SCENE,
    voice: {
      enabled: true,
      fixedEmotion: false,
      cast: { main: null, extras: [] },
      plans: [],
      clips: new Map(),
      paused: false,
      lastError: null,
      charName: CHAR,
      streaming: false,
    },
    onExit: () => {},
    ...extra,
  };
}

const jevStats = (o: Partial<JevStats> = {}): JevStats => ({
  kinds: ['sprite'],
  lines: 3,
  requests: 1,
  tokens: 1234,
  maxMs: 1500,
  failed: 0,
  ...o,
});

describe('ConsoleView', () => {
  it('每个标签一行,标签表和语音表的行都能点', () => {
    const html = renderToStaticMarkup(<ConsoleView {...props(reply())} />);
    expect(html.match(/<tr[^>]*tabindex="0"/g)).toHaveLength(3 + 3);
    expect(html).toContain('回到调试台');
    expect(html).toContain('点标签表或语音表的一行');
  });

  it('对不上的标签才是红的:红圆「!」+ 后端原文;对上的不红', () => {
    const html = renderToStaticMarkup(<ConsoleView {...props(reply())} />);
    // 「惊讶」认不出:一个红的,原文里那个标签也标 miss
    expect(html.match(/class="cv-err"/g)).toHaveLength(1);
    expect(html).toContain('假的:认不出,保持上一张');
    expect(html).toContain('class="miss k-sprite"');
    expect(html.match(/class="ok k-sprite"/g)).toHaveLength(2);
  });

  it('Jev 的正常说明是普通字色,没判成才红、并给原文', () => {
    const fine = renderToStaticMarkup(<ConsoleView {...props(reply(jevStats()))} />);
    expect(fine).toContain('是 Jev 标的');
    expect(fine).toContain('1,234 token');
    // 只有「惊讶」那一个红的,Jev 说明不红
    expect(fine.match(/class="cv-err"/g)).toHaveLength(1);

    const bad = renderToStaticMarkup(
      <ConsoleView {...props(reply(jevStats({ failed: 2, error: 'HTTP 502 Bad Gateway' })))} />,
    );
    expect(bad.match(/class="cv-err"/g)).toHaveLength(2);
    expect(bad).toContain('HTTP 502 Bad Gateway');
  });

  it('没有标签时是一句普通说明,不是红字', () => {
    const b = beat('a0', 1, []);
    b.raw = '没有标签的一句';
    const html = renderToStaticMarkup(<ConsoleView {...props(b)} />);
    expect(html).toContain('这条回复里没有标签');
    expect(html).not.toContain('cv-err');
  });

  it('还没有回复:不炸,舞台写「还没有回复」', () => {
    const html = renderToStaticMarkup(<ConsoleView {...props(null)} />);
    expect(html).toContain('还没有回复');
    expect(html).not.toContain('cv-err');
  });

  it('右边小舞台默认是光标那一句的表情', () => {
    const html = renderToStaticMarkup(<ConsoleView {...props(reply(), { line: 2 })} />);
    expect(html).toContain('第 3 句');
    // 第 2 句生效的是「平静」
    expect(html).toContain('<em>平静</em>');
  });

  it('语音合成失败的那句是红的,原文照给', () => {
    const b = reply();
    const html = renderToStaticMarkup(
      <ConsoleView
        {...props(b, {
          voice: {
            enabled: true,
            fixedEmotion: false,
            cast: { main: { id: 'v1', name: '主声音', text_lang: 'zh' } as never, extras: [] },
            plans: [null, null, null],
            clips: new Map(),
            paused: true,
            lastError: 'Connection refused',
            charName: CHAR,
            streaming: false,
          },
        })}
      />,
    );
    expect(html).toContain('Connection refused');
    expect(html).toContain('连续失败,暂停中');
  });
});
