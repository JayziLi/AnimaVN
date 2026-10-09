import { describe, expect, it } from 'vitest';
import {
  WI_POSITION,
  createEntry,
  emptyBook,
  parseBook,
  serializeBook,
  type CharacterBook,
} from './characterBook';

/** 酒馆导出的卡里一条世界书的样子,外加一个我们不认识的字段 */
const TAVERN_BOOK = {
  name: '王都设定',
  scan_depth: 4,
  token_budget: 500,
  recursive_scanning: true,
  extensions: { someTool: { version: 2 } },
  entries: [
    {
      id: 7,
      keys: ['王都', '/首都|京城/i'],
      secondary_keys: ['骑士团'],
      comment: '王都',
      content: '王都由骑士团守卫',
      constant: false,
      selective: true,
      insertion_order: 50,
      enabled: true,
      position: 'after_char',
      use_regex: true,
      name: '别的前端写的字段',
      extensions: {
        position: 4,
        depth: 2,
        role: 1,
        probability: 80,
        useProbability: true,
        selectiveLogic: 3,
        scan_depth: 6,
        case_sensitive: true,
        match_whole_words: false,
        exclude_recursion: true,
        prevent_recursion: false,
        delay_until_recursion: 2,
        group: '地点',
        group_override: true,
        group_weight: 30,
        sticky: 3,
        cooldown: 2,
        delay: 1,
        ignore_budget: true,
        match_scenario: true,
        display_index: 0,
        vectorized: false,
        automation_id: 'abc',
        triggers: ['normal'],
        unknown_future_field: { a: 1 },
      },
    },
    { keys: ['猫'], content: '她怕猫', enabled: true, insertion_order: 10 },
  ],
};

const load = (): CharacterBook => {
  const book = parseBook(structuredClone(TAVERN_BOOK));
  if (!book) throw new Error('解析失败');
  return book;
};

describe('读', () => {
  it('字段照酒馆的规则解析', () => {
    const [a, b] = load().entries;
    expect(a).toMatchObject({
      uid: 7,
      keys: ['王都', '/首都|京城/i'],
      secondaryKeys: ['骑士团'],
      selective: true,
      selectiveLogic: 3,
      position: WI_POSITION.atDepth,
      depth: 2,
      role: 1,
      probability: 80,
      scanDepth: 6,
      caseSensitive: true,
      matchWholeWords: false,
      excludeRecursion: true,
      delayUntilRecursion: 2,
      group: '地点',
      groupOverride: true,
      groupWeight: 30,
      ignoreBudget: true,
      matchScenario: true,
    });
    // 没有 id 的用下标;没写位置的算「后」;没写的开关跟全局
    expect(b).toMatchObject({
      uid: 1,
      position: WI_POSITION.after,
      constant: false,
      scanDepth: null,
      caseSensitive: null,
      probability: 100,
    });
  });

  it('不是世界书的东西返回 null', () => {
    expect(parseBook(null)).toBeNull();
    expect(parseBook({ name: 'x' })).toBeNull();
    expect(parseBook('entries')).toBeNull();
  });
});

describe('写', () => {
  it('没动过的世界书写回去一字不差', () => {
    expect(serializeBook(load())).toEqual(TAVERN_BOOK);
  });

  it('只改一个字段,别的原样保留', () => {
    const book = load();
    book.entries[0] = { ...book.entries[0], content: '王都已经陷落' };
    const out = serializeBook(book) as typeof TAVERN_BOOK;

    expect(out.entries[0].content).toBe('王都已经陷落');
    expect({ ...out.entries[0], content: TAVERN_BOOK.entries[0].content }).toEqual(
      TAVERN_BOOK.entries[0],
    );
    expect(out.entries[1]).toEqual(TAVERN_BOOK.entries[1]);
    expect(out.extensions).toEqual(TAVERN_BOOK.extensions);
  });

  it('给只有基本字段的条目加常驻,不会顺带写一堆默认值', () => {
    const book = load();
    book.entries[1] = { ...book.entries[1], constant: true };
    const out = serializeBook(book) as { entries: Record<string, unknown>[] };
    expect(out.entries[1]).toEqual({ ...TAVERN_BOOK.entries[1], constant: true });
  });

  it('改位置时两种写法一起更新', () => {
    const book = load();
    book.entries[1] = { ...book.entries[1], position: WI_POSITION.before };
    const out = serializeBook(book) as { entries: Record<string, unknown>[] };
    expect(out.entries[1].position).toBe('before_char');
    expect(out.entries[1].extensions).toEqual({ position: 0 });
  });

  it('写出去再读回来,条目不变', () => {
    const book = load();
    book.entries[0] = { ...book.entries[0], keys: ['新词'], probability: 40, constant: true };
    const again = parseBook(serializeBook(book));
    expect(again?.entries.map(({ raw: _raw, ...rest }) => rest)).toEqual(
      book.entries.map(({ raw: _raw, ...rest }) => rest),
    );
  });
});

describe('新建', () => {
  it('新条目是开着的、按关键词触发、放在角色描述前', () => {
    const e = createEntry(emptyBook());
    expect(e).toMatchObject({
      uid: 0,
      enabled: true,
      constant: false,
      position: WI_POSITION.before,
      insertion_order: 100,
    });
  });

  it('id 和顺序号接着现有的往后排', () => {
    const book = load();
    const e = createEntry(book);
    expect(e.uid).toBe(8);
    expect(e.insertion_order).toBe(100);
    book.entries.push(e);
    expect(createEntry(book).insertion_order).toBe(110);
  });
});
