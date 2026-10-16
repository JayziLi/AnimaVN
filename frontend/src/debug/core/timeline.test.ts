import { describe, expect, it } from 'vitest';
import type { SceneAsset } from '../lib/api';
import type { ChatEntry } from '../lib/chatEntry';
import { setManual } from '../plugins/manualMarks';
import type { Beat } from './beats';
import { legacyCursorState, legacyEmotionBefore } from './legacyCursor';
import { buildTimeline, emotionAtStart, entryTimeline, stateAt, stateAtEnd } from './timeline';
import { ALT, asset, beat, ctxOf, hit, lensOf, randomCase, resolverOf, sprite } from './timeline.fixtures';

const SEEDS = 400;

/** 在这条消息的第 line 句记一个形态记号(存档里的 vn.forms,形态卡带也是这样写的) */
function withFormMark(entry: ChatEntry, line: number, form: string): ChatEntry {
  return {
    ...entry,
    swipeInfo: entry.swipeInfo.map((info) => ({ ...info, vn: { ...info.vn, forms: [{ line, form }] } })),
  };
}

describe('the timeline matches the old visual novel rules line by line', () => {
  for (const forms of [false, true]) {
    for (const monotonic of [true, false]) {
      it(`random chats: forms ${forms ? 'on' : 'off'}, tags ${monotonic ? 'in line order' : 'out of order'}`, () => {
        let lines = 0;
        for (let seed = 1; seed <= SEEDS; seed++) {
          const { beats, ctx } = randomCase(seed, { forms, monotonic });
          const tl = buildTimeline(beats, ctx);
          expect(stateAt(tl, -1, 0), `seed ${seed}, before any reply`).toEqual(legacyCursorState(beats, -1, 0, ctx));
          expect(tl.end.spriteLabel, `seed ${seed}, end`).toBe(legacyEmotionBefore(beats, beats.length, ctx));
          beats.forEach((b, bi) => {
            if (!b.parsed) return;
            expect(tl.entries[bi].start.spriteLabel, `seed ${seed}, start of ${bi}`).toBe(legacyEmotionBefore(beats, bi, ctx));
            for (let line = 0; line < Math.max(1, b.parsed.lines.length); line++) {
              expect(stateAt(tl, bi, line), `seed ${seed}, entry ${bi}, line ${line}`).toEqual(
                legacyCursorState(beats, bi, line, ctx),
              );
              lines++;
            }
          });
        }
        expect(lines).toBeGreaterThan(1000);
      });
    }
  }
});

describe('timeline cache', () => {
  const sprites = [sprite('s1', '微笑'), sprite('s2', '平静')];

  it('reuses replies whose split and start did not change, and recomputes the one being written', () => {
    const ctx = ctxOf({ sprites });
    const a0 = beat('a0', 2, [hit('sprite', '平静', 1)]);
    const first = buildTimeline([a0, beat('a1', 2, [])], ctx);
    const streamed = buildTimeline([a0, beat('a1', 3, [hit('sprite', '微笑', 2)])], ctx);
    expect(streamed.entries[0]).toBe(first.entries[0]);
    expect(streamed.entries[1]).not.toBe(first.entries[1]);
    expect(streamed.entries[1].start).toBe(first.entries[0].end);
    expect(streamed.entries[1].lines.map((l) => l.spriteLabel)).toEqual(['平静', '平静', '微笑']);
  });

  it('works everything out again for new inputs (model results came back, packs or form marks changed)', () => {
    const beats = [beat('a0', 1, [hit('sprite', '平静', 0)])];
    const one = buildTimeline(beats, ctxOf({ sprites }));
    const two = buildTimeline(beats, ctxOf({ sprites }));
    expect(two.entries[0]).not.toBe(one.entries[0]);
    expect(two.entries[0]).toEqual(one.entries[0]);
  });

  it('works out another swipe from the start the previous replies left', () => {
    const ctx = ctxOf({ sprites });
    const tl = buildTimeline([beat('a0', 1, [hit('sprite', '平静', -1)]), beat('a1', 1, [])], ctx);
    const other = entryTimeline(beat('a1', 1, [hit('sprite', '微笑', 0)]), tl.entries[1].start, ctx);
    expect([tl.entries[1].lines[0].spriteLabel, other.lines[0].spriteLabel]).toEqual(['平静', '微笑']);
  });
});

describe('timeline speed', () => {
  // 设计稿 7:3000 句全量不超过 50 毫秒、流式时单条不超过 2 毫秒。这里留足余量,机器忙时也不误报
  it('works out a 3000-line chat quickly, and only the reply being written while streaming', () => {
    const sprites = [sprite('s1', '微笑'), sprite('s2', '平静'), sprite('s3', '生气')];
    const ctx = ctxOf({ sprites });
    const words = ['微笑', '平静', '生气'];
    const beats = Array.from({ length: 300 }, (_, k) =>
      beat(`a${k}`, 10, [hit('sprite', words[k % 3], 0), hit('sprite', words[(k + 1) % 3], 5)]),
    );
    const t0 = performance.now();
    buildTimeline(beats, ctx);
    const full = performance.now() - t0;
    const t1 = performance.now();
    buildTimeline([...beats.slice(0, -1), beat('a299', 11, [hit('sprite', '生气', 10)])], ctx);
    const streamed = performance.now() - t1;
    expect(full).toBeLessThan(500);
    expect(streamed).toBeLessThan(50);
  });
});

describe('stateAtEnd', () => {
  const sprites = [sprite('s1', '微笑'), sprite('s2', '平静'), sprite('s3', '生气')];

  it('shows the last line of the last reply, without the tags written after it', () => {
    const ctx = ctxOf({ sprites });
    const beats = [beat('a0', 2, [hit('sprite', '平静', 1)]), beat('u1', 0, [], 'user'), beat('a2', 2, [hit('sprite', '生气', -1)])];
    expect(stateAtEnd(buildTimeline(beats, ctx), beats).spriteLabel).toBe('平静');
  });

  it('shows the start before any reply, and the empty stage of a last reply without lines', () => {
    const ctx = ctxOf({ sprites });
    const none = buildTimeline([], ctx);
    expect(stateAtEnd(none, [])).toBe(none.initial);
    const beats = [beat('a0', 1, [hit('sprite', '平静', 0)]), beat('a1', 0, [hit('sprite', '生气', -1)])];
    expect(stateAtEnd(buildTimeline(beats, ctx), beats).spriteLabel).toBe('平静');
  });
});

describe('emotionAtStart', () => {
  const sprites = [sprite('s1', '微笑'), sprite('s2', '平静'), sprite('s3', `${ALT}·微笑`), sprite('s4', `${ALT}·害羞`)];

  it('gives Jev the expression the stage shows when the new reply starts', () => {
    const ctx = ctxOf({ sprites, resolve: resolverOf(sprites, { 嘟嘴: { state: 'model', label: '平静', score: 0.7 } }) });
    // 模型认出来的算,路人台词前的不算(以前 Jev 这边只认名字和别名,还会算上路人台词前的)
    const a = [beat('a0', 2, [hit('sprite', '嘟嘴', 0), hit('sprite', '微笑', 1, '路人')])];
    expect(emotionAtStart(buildTimeline(a, ctx), ctx, 'new', null)).toBe('平静');
    // 写在上一条末尾的也算
    const b = [beat('a0', 1, [hit('sprite', '平静', 0), hit('sprite', '微笑', -1)])];
    expect(emotionAtStart(buildTimeline(b, ctx), ctx, 'new', null)).toBe('微笑');
  });

  it('puts it into the form of the first line of the new reply', () => {
    const before = [beat('a0', 1, [hit('sprite', '平静', 0)])];
    const ctx = ctxOf({ sprites, forms: lensOf([{ entryId: 'new', line: 0, form: 'alt' }], ['a0', 'new'], sprites) });
    expect(emotionAtStart(buildTimeline(before, ctx), ctx, 'new', null)).toBe(`${ALT}·微笑`);
  });

  it('falls back when the stage has nothing to show yet', () => {
    const ctx = ctxOf({ sprites: [] });
    expect(emotionAtStart(buildTimeline([], ctx), ctx, 'new', '平静')).toBe('平静');
  });
});

describe('cgFrame (word-record engine reads the pairing table)', () => {
  const sprites = [sprite('s1', '微笑'), sprite('s2', '平静')];
  const sceneAssets = [
    asset({ id: 'c1', kind: 'cg', label: '拥抱' }),
    asset({ id: 'c1a', kind: 'cg', label: '微笑', parent_id: 'c1' }),
    asset({ id: 'c1b', kind: 'cg', label: '平静', parent_id: 'c1' }),
  ];
  const beats = [beat('a0', 3, [hit('cg', '拥抱', 0), hit('sprite', '平静', 1), hit('sprite', '生气', 2)])];

  it('asks ctx.cgFrame first, with the expression before the form conversion', () => {
    const asked: [string, string | null][] = [];
    const ctx = {
      ...ctxOf({ sprites, sceneAssets }),
      cgFrame: (cg: SceneAsset, label: string | null) => {
        asked.push([cg.id, label]);
        return label === '平静' ? sceneAssets[1] : undefined;
      },
    };
    const tl = buildTimeline(beats, ctx);
    // 平静的两句表里配的是 c1a(和名字对不上也用它);第 0 句(微笑)返回 undefined,照旧按名字找
    expect(tl.entries[0].lines.map((l) => l.cgFrame?.id)).toEqual(['c1a', 'c1a', 'c1a']);
    expect(asked).toEqual([
      ['c1', '微笑'],
      ['c1', '平静'],
      ['c1', '平静'],
    ]);
  });

  it('falls back to the name when it returns undefined, the same as without it', () => {
    const plain = ctxOf({ sprites, sceneAssets });
    const tl = buildTimeline(beats, { ...plain, cgFrame: () => undefined });
    expect(tl.entries[0].lines.map((l) => l.cgFrame?.id)).toEqual(['c1a', 'c1b', 'c1b']);
    expect(tl.entries[0].lines).toEqual(buildTimeline(beats, plain).entries[0].lines);
  });
});

describe('a line whose emotion the player changed in the inspector', () => {
  const sprites = [sprite('s1', '微笑'), sprite('s2', '平静'), sprite('s3', '生气')];
  const mark = (b: Beat, line: number, item: string, label: string): Beat => ({
    ...b,
    entry: setManual(b.entry, line, { item, label }),
  });
  const labels = (tl: ReturnType<typeof buildTimeline>, i: number) => tl.entries[i].lines.map((l) => [l.spriteLabel, l.shownLabel]);

  it('only that line changes; the lines before and after, and what carries on, stay the same', () => {
    const ctx = ctxOf({ sprites });
    const plain = [beat('a0', 4, [hit('sprite', '平静', 0), hit('sprite', '生气', 3)]), beat('a1', 1, [])];
    const was = buildTimeline(plain, ctx);
    const tl = buildTimeline([mark(plain[0], 1, 's1', '微笑'), plain[1]], ctx);
    expect(labels(tl, 0)).toEqual([
      ['平静', '平静'],
      ['微笑', '微笑'],
      ['平静', '平静'],
      ['生气', '生气'],
    ]);
    expect(tl.entries[0].end).toEqual(was.entries[0].end);
    expect(tl.entries[1].lines).toEqual(was.entries[1].lines);
  });

  it('finds the sprite by id (its name now), else by name; one removed or turned off counts as no change', () => {
    const renamed = [sprite('s1', '笑容'), sprite('s2', '平静'), sprite('s3', '生气')];
    const ctx = ctxOf({ sprites: renamed });
    const b = beat('a0', 3, [hit('sprite', '平静', 0)]);
    let marked = mark(b, 0, 's1', '微笑');
    marked = mark(marked, 1, 'old', '生气');
    marked = mark(marked, 2, 'gone', '不存在');
    expect(buildTimeline([marked], ctx).entries[0].lines.map((l) => l.shownLabel)).toEqual(['笑容', '生气', '平静']);
  });

  it('shows what the player picked without the form conversion', () => {
    const withH = [...sprites, sprite('s4', `${ALT}·害羞`)];
    const ctx = ctxOf({ sprites: withH, forms: lensOf([{ entryId: 'a0', line: 0, form: 'alt' }], ['a0'], withH) });
    const b = beat('a0', 3, [hit('sprite', '平静', 0)]);
    const lines = buildTimeline([mark(b, 1, 's1', '微笑')], ctx).entries[0].lines;
    expect(lines.map((l) => [l.spriteLabel, l.shownLabel, l.form])).toEqual([
      ['平静', `${ALT}·害羞`, 'alt'],
      ['微笑', '微笑', 'alt'],
      ['平静', `${ALT}·害羞`, 'alt'],
    ]);
  });

  it('picks the CG frame by what the player picked', () => {
    const sceneAssets = [
      asset({ id: 'c1', kind: 'cg', label: '拥抱' }),
      asset({ id: 'c1a', kind: 'cg', label: '微笑', parent_id: 'c1' }),
      asset({ id: 'c1b', kind: 'cg', label: '平静', parent_id: 'c1' }),
    ];
    const b = beat('a0', 3, [hit('cg', '拥抱', 0), hit('sprite', '平静', 0)]);
    const asked: (string | null)[] = [];
    const ctx = {
      ...ctxOf({ sprites, sceneAssets }),
      cgFrame: (_cg: SceneAsset, label: string | null) => {
        asked.push(label);
        return undefined;
      },
    };
    const lines = buildTimeline([mark(b, 1, 's1', '微笑')], ctx).entries[0].lines;
    expect(lines.map((l) => l.cgFrame?.id)).toEqual(['c1b', 'c1a', 'c1b']);
    expect(asked).toEqual(['平静', '微笑', '平静']);
  });

  it('a card without sprites takes a built-in expression', () => {
    const ctx = ctxOf({ sprites: [] });
    const b = beat('a0', 2, [hit('sprite', '开心', 0)]);
    let marked = mark(b, 0, '难过', '难过');
    marked = mark(marked, 1, '乱写的', '乱写的');
    expect(buildTimeline([marked], ctx).entries[0].lines.map((l) => l.shownLabel)).toEqual(['难过', '开心']);
  });

  it('the cache works the reply out again after a change, and the replies after it stay cached', () => {
    const ctx = ctxOf({ sprites });
    const b0 = beat('a0', 2, [hit('sprite', '平静', 0)]);
    const b1 = beat('a1', 1, []);
    const one = buildTimeline([b0, b1], ctx);
    const b0m = mark(b0, 1, 's1', '微笑');
    const two = buildTimeline([b0m, b1], ctx);
    expect(two.entries[0]).not.toBe(one.entries[0]);
    expect(two.entries[0].lines[1].shownLabel).toBe('微笑');
    // 手改不进累计结果:结尾还是原来那个对象,后面那条直接用缓存
    expect(two.entries[0].end).toBe(one.entries[0].end);
    expect(two.entries[1]).toBe(one.entries[1]);
    // vn 里别的记号变了、手改记号还是同一个数组:用缓存
    const b0f = { ...b0m, entry: withFormMark(b0m.entry, 0, 'normal') };
    expect(buildTimeline([b0f, b1], ctx).entries[0]).toBe(two.entries[0]);
    // 改回去
    const back = buildTimeline([{ ...b0m, entry: setManual(b0m.entry, 1, null) }, b1], ctx);
    expect(back.entries[0].lines).toEqual(one.entries[0].lines);
  });
});
