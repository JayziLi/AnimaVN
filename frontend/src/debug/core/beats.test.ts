import { describe, expect, it } from 'vitest';
import type { ChatEntry } from '../lib/chatEntry';
import { buildMacroContext } from '../lib/macros';
import type { TagKind } from '../vn/script';
import { vnTagKinds } from '../vn/tags';
import { newBeatCache, parseBeats, type BeatCache } from './beats';

const KINDS = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
const macros = buildMacroContext({ card: null, userName: '旅行者', personaDescription: '', history: [] });

const entry = (id: string, text: string, over: Partial<ChatEntry> = {}): ChatEntry => ({
  id,
  role: 'assistant',
  swipes: [text],
  swipeIndex: 0,
  swipeInfo: [{ sendDate: '' }],
  overswipe: 'regenerate',
  ...over,
});

const parse = (entries: ChatEntry[], o: { cache?: BeatCache; charName?: string; tagKinds?: TagKind[] } = {}) =>
  parseBeats({
    entries,
    tagKinds: o.tagKinds ?? KINDS,
    macros,
    charName: o.charName ?? '星绘',
    userName: '旅行者',
    cache: o.cache ?? newBeatCache(),
  });

describe('parseBeats', () => {
  it('splits replies into lines and keeps user messages as they are', () => {
    const [user, reply] = parse([entry('u1', '早上好', { role: 'user' }), entry('a1', '<sprite:微笑>第一句。\n第二句。')]);
    expect(user.parsed).toBeNull();
    expect(user.raw).toBe('早上好');
    expect(reply.parsed?.lines.map((l) => l.text)).toEqual(['第一句。', '第二句。']);
    expect(reply.parsed?.hits.map((h) => [h.kind, h.label, h.lineIndex])).toEqual([['sprite', '微笑', 0]]);
  });

  it('reuses the cached split while nothing changed', () => {
    const cache = newBeatCache();
    const e = entry('a1', '<sprite:微笑>第一句。');
    const first = parse([e], { cache })[0].parsed;
    expect(parse([e], { cache })[0].parsed).toBe(first);
  });

  it('splits again when the text, the streaming flag, the names or the tag templates change', () => {
    const changed = (next: { e?: ChatEntry; charName?: string; tagKinds?: TagKind[] }) => {
      const cache = newBeatCache();
      const first = parse([entry('a1', '第一句。')], { cache })[0].parsed;
      const again = parse([next.e ?? entry('a1', '第一句。')], { cache, charName: next.charName, tagKinds: next.tagKinds });
      return again[0].parsed !== first;
    };
    expect(changed({})).toBe(false);
    expect(changed({ e: entry('a1', '第一句。第二句。') })).toBe(true);
    expect(changed({ e: entry('a1', '第一句。', { streaming: true }) })).toBe(true);
    expect(changed({ charName: '香奈美' })).toBe(true);
    expect(changed({ tagKinds: vnTagKinds('[表情:{表情}]', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>') })).toBe(true);
  });
});
