import { describe, expect, it } from 'vitest';
import type { PairingCellOut, PairingTableOut, SceneAsset, WordRecordOut } from '../lib/api';
import {
  allSameRow,
  baseRows,
  cellFlags,
  fillSummary,
  missingItems,
  openSuggestions,
  pairableCgs,
  pairingSourceName,
  recordFlags,
  recordSourceName,
  rowChoices,
  sharedEditWarning,
  sortRecords,
  suggestionRows,
  usedByText,
  variantWordRows,
  withCell,
} from './pairingView';

const rec = (word: string, extra: Partial<WordRecordOut> = {}): WordRecordOut => ({
  word,
  item: 's1',
  source: 'migrated',
  guessed: false,
  unstable: false,
  score: null,
  ...extra,
});

const cell = (item: string, value: string | null, extra: Partial<PairingCellOut> = {}): PairingCellOut => ({
  item,
  value,
  source: 'migrated',
  guessed: false,
  pending: false,
  unstable: false,
  ...extra,
});

const asset = (id: string, extra: Partial<SceneAsset> = {}): SceneAsset => ({
  id,
  pack_id: 'p',
  kind: 'cg',
  label: id,
  aliases: [],
  description: '',
  has_file: true,
  mime: 'image/png',
  size: 1,
  file_version: 1,
  focus_x: 50,
  bgm_id: null,
  sort: 0,
  enabled: true,
  parent_id: null,
  ...extra,
});

describe('认词记录', () => {
  it('模型猜的排前面,其次今天本来就不稳定的,别的照后端的顺序', () => {
    const out = sortRecords([
      rec('甲'),
      rec('乙', { unstable: true }),
      rec('丙', { guessed: true }),
      rec('丁'),
      rec('戊', { guessed: true, unstable: true }),
    ]);
    expect(out.map((r) => r.word)).toEqual(['戊', '丙', '乙', '甲', '丁']);
  });

  it('不改传进来的数组', () => {
    const list = [rec('甲'), rec('乙', { guessed: true })];
    sortRecords(list);
    expect(list.map((r) => r.word)).toEqual(['甲', '乙']);
  });

  it('来源写成大白话,认不得的原样显示', () => {
    expect(recordSourceName('player')).toBe('你改的');
    expect(recordSourceName('model')).toBe('模型认过一次');
    expect(recordSourceName('somewhere')).toBe('somewhere');
  });

  it('两个小标', () => {
    expect(recordFlags(rec('甲'))).toEqual([]);
    expect(recordFlags(rec('甲', { guessed: true, unstable: true }))).toEqual(['模型猜的', '今天本来就不稳定']);
  });
});

describe('配对表的格子', () => {
  it('来源写成大白话(设计 1.6.6 的叫法)', () => {
    expect(pairingSourceName('migrated')).toBe('旧结果');
    expect(pairingSourceName('name')).toBe('同名');
    expect(pairingSourceName('chat')).toBe('聊天模型配的');
    expect(pairingSourceName('jev')).toBe('Jev 配的');
    expect(pairingSourceName('local')).toBe('本地模型配的');
    expect(pairingSourceName('player')).toBe('你改的');
    expect(pairingSourceName('other')).toBe('other');
  });

  it('CG 的 local 是名字对不上、先用构图本身,不是模型挑的', () => {
    expect(pairingSourceName('local', 'cg')).toBe('名字对不上');
    expect(pairingSourceName('name', 'cg')).toBe('同名');
    expect(pairingSourceName('local', 'voice')).toBe('本地模型配的');
  });

  it('三个小标按 模型猜的、不稳定、待重配 的顺序', () => {
    expect(cellFlags(cell('s1', 'e1'))).toEqual([]);
    expect(cellFlags(cell('s1', 'e1', { guessed: true, pending: true, unstable: true }))).toEqual([
      '模型猜的',
      '今天本来就不稳定',
      '待重配',
    ]);
  });

  it('withCell 换掉同一项的格子,没有就加上,不动原来的表', () => {
    const t: PairingTableOut = {
      id: 't',
      follower: 'voice',
      list_ref: 'pack:p',
      target: 'v',
      cards: [],
      cells: [cell('s1', 'e1'), cell('s2', 'e2')],
    };
    const changed = withCell(t, cell('s2', 'e3', { source: 'player' }));
    expect(changed.cells.map((c) => [c.item, c.value, c.source])).toEqual([
      ['s1', 'e1', 'migrated'],
      ['s2', 'e3', 'player'],
    ]);
    expect(t.cells[1].value).toBe('e2');
    const added = withCell(t, cell('s3', 'e1'));
    expect(added.cells.map((c) => c.item)).toEqual(['s1', 's2', 's3']);
  });

  it('missingItems:名单里表上还没有格子的项', () => {
    const items = [{ key: 's1' }, { key: 's2' }, { key: 's3' }];
    expect(missingItems(items, [cell('s2', 'e1')]).map((i) => i.key)).toEqual(['s1', 's3']);
    expect(missingItems(items, null).map((i) => i.key)).toEqual(['s1', 's2', 's3']);
  });
});

describe('整列都是同一段', () => {
  it('两格以上、都配到同一段才算', () => {
    expect(allSameRow([cell('s1', 'e1'), cell('s2', 'e1'), cell('s3', 'e1')])).toBe(true);
    expect(allSameRow([cell('s1', 'e1'), cell('s2', 'e2')])).toBe(false);
    expect(allSameRow([cell('s1', 'e1')])).toBe(false);
    expect(allSameRow([])).toBe(false);
  });

  it('空格子(CG 的构图本身)不算同一段', () => {
    expect(allSameRow([cell('s1', null), cell('s2', null)])).toBe(false);
  });
});

describe('baseRows:去掉「X·后缀」那些版本', () => {
  const row = (id: string, label: string) => ({ id, label });

  it('同一个后缀挂在两行以上、前半是另一行的名字,才算版本', () => {
    const rows = [
      row('a', '平静'),
      row('b', '开心'),
      row('c', '平静·轻声'),
      row('d', '开心·轻声'),
      row('e', '生气'),
      row('f', '生气·嘴硬'),
    ];
    expect(baseRows(rows).map((r) => r.id)).toEqual(['a', 'b', 'e', 'f']);
  });

  it('前半不是这个声音的一行,不算版本', () => {
    const rows = [row('a', '平静'), row('b', '开心'), row('c', '平静·轻声'), row('d', '开心·轻声'), row('e', '惊讶·轻声')];
    expect(baseRows(rows).map((r) => r.id)).toEqual(['a', 'b', 'e']);
  });

  it('前半是一行、但这个后缀只算得上一行:是单独的一段', () => {
    const rows = [row('a', '平静'), row('b', '平静·轻声'), row('c', '惊讶·轻声')];
    expect(baseRows(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('按最后一个「·」切,名字前后的空白不算', () => {
    const rows = [
      row('a', '晴·暖'),
      row('b', ' 雨 '),
      row('c', '晴·暖·轻声'),
      row('d', '雨·轻声 '),
    ];
    expect(baseRows(rows).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('没有「·」的照旧', () => {
    const rows = [row('a', '平静'), row('b', '开心')];
    expect(baseRows(rows)).toEqual(rows);
  });
});

describe('rowChoices:下拉里的选项', () => {
  const choices = [
    { value: 'a', label: '平静' },
    { value: 'b', label: '开心' },
  ];
  const nameOf = (v: string | null) => (v === 'c' ? '平静·轻声' : v === null ? '构图本身' : '(不在了)');

  it('现在配的就在选项里:原样', () => {
    expect(rowChoices(choices, 'b', nameOf)).toEqual(choices);
  });

  it('现在配的不在选项里(版本行、删掉的):加在后面,好让下拉显示对', () => {
    expect(rowChoices(choices, 'c', nameOf)).toEqual([...choices, { value: 'c', label: '平静·轻声' }]);
    expect(rowChoices(choices, 'x', nameOf)).toEqual([...choices, { value: 'x', label: '(不在了)' }]);
  });

  it('还没有格子(undefined)不加', () => {
    expect(rowChoices(choices, undefined, nameOf)).toEqual(choices);
  });
});

describe('被几张卡用', () => {
  const names = new Map([
    ['c1', '甲卡'],
    ['c2', '乙卡'],
    ['c3', '丙卡'],
  ]);

  it('表头', () => {
    expect(usedByText([])).toBe('现在没有卡用');
    expect(usedByText(['c1'])).toBe('被 1 张卡用');
    expect(usedByText(['c1', 'c2'])).toBe('被 2 张卡用');
  });

  it('只有一张卡用不用问', () => {
    expect(sharedEditWarning([], names)).toBeNull();
    expect(sharedEditWarning(['c1'], names)).toBeNull();
  });

  it('几张卡用:列出卡名,找不到名字的写 id', () => {
    expect(sharedEditWarning(['c1', 'c2', 'zz'], names)).toBe('这张表被 3 张卡用(甲卡、乙卡、zz),改了它们都变');
  });

  it('卡太多时只列前四张', () => {
    const many = new Map([...names, ['c4', '丁卡'], ['c5', '戊卡']]);
    expect(sharedEditWarning(['c1', 'c2', 'c3', 'c4', 'c5'], many)).toBe(
      '这张表被 5 张卡用(甲卡、乙卡、丙卡、丁卡 等),改了它们都变',
    );
  });
});

describe('suggestionRows:建议清单「现在 → 建议」', () => {
  const itemName = (k: string) => ({ s1: '微笑', s2: '难过' })[k] ?? k;
  const valueName = (v: string | null) => (v === null ? '构图本身' : (({ e1: '平静', e2: '开心' }) as Record<string, string>)[v] ?? v);

  it('改的写现在和建议的名字', () => {
    expect(
      suggestionRows([{ item: 's1', current: 'e1', suggested: 'e2', new: false }], itemName, valueName),
    ).toEqual([{ item: 's1', name: '微笑', from: '平静', to: '开心', current: 'e1', suggested: 'e2' }]);
  });

  it('表里还没有的格子写「还没配」;CG 的空值写构图本身', () => {
    expect(
      suggestionRows(
        [
          { item: 's2', current: null, suggested: 'e1', new: true },
          { item: 's1', current: 'e2', suggested: null, new: false },
          { item: 's2', current: null, suggested: 'e2', new: false },
        ],
        itemName,
        valueName,
      ).map((r) => [r.name, r.from, r.to]),
    ).toEqual([
      ['难过', '还没配', '平静'],
      ['微笑', '开心', '构图本身'],
      ['难过', '构图本身', '开心'],
    ]);
  });
});

describe('CG:有差分的构图', () => {
  it('只列启用的构图,差分只算启用、传了图的;一张都没有的构图不列', () => {
    const assets = [
      asset('A', { label: '构图一' }),
      asset('A1', { parent_id: 'A', label: '微笑' }),
      asset('A2', { parent_id: 'A', label: '难过', enabled: false }),
      asset('A3', { parent_id: 'A', label: '惊讶', has_file: false }),
      asset('B', { label: '构图二' }),
      asset('B1', { parent_id: 'B', label: '微笑', has_file: false }),
      asset('C', { label: '构图三', enabled: false }),
      asset('C1', { parent_id: 'C', label: '微笑' }),
      asset('bg', { kind: 'bg' }),
    ];
    const out = pairableCgs(assets);
    expect(out.map((g) => [g.cg.id, g.variants.map((v) => v.id)])).toEqual([['A', ['A1']]]);
  });

  it('差分自己认的词:同样的名字和别名合成一行,数在几个构图里有', () => {
    const groups = pairableCgs([
      asset('A', { label: '构图一' }),
      asset('A1', { parent_id: 'A', label: '微笑', aliases: ['笑', ' 微笑 ', ''] }),
      asset('A2', { parent_id: 'A', label: '难过' }),
      asset('B', { label: '构图二' }),
      asset('B1', { parent_id: 'B', label: '微笑', aliases: ['笑'] }),
      asset('C', { label: '构图三' }),
      asset('C1', { parent_id: 'C', label: '微笑', aliases: ['开心'] }),
    ]);
    expect(variantWordRows(groups)).toEqual([
      { label: '微笑', aliases: ['笑'], count: 2 },
      { label: '难过', aliases: [], count: 1 },
      { label: '微笑', aliases: ['开心'], count: 1 },
    ]);
  });
});

describe('fillSummary:「补上缺的」回来以后那句话', () => {
  const added = (source: string, value: string | null) => cell('s', value, { source });

  it('没有缺的', () => {
    expect(fillSummary('voice', { table_id: 't', added: [], skipped: [] })).toBe('没有缺的格子。');
  });

  it('语音:名字对上几格、本地模型挑了几格', () => {
    expect(
      fillSummary('voice', { table_id: 't', added: [added('name', 'e1'), added('local', 'e2'), added('local', 'e1')], skipped: [] }),
    ).toBe('补上了 3 格:名字对上 1 格,本地模型挑了 2 格(标了待重配)。');
  });

  it('CG:对不上的先用构图本身', () => {
    expect(fillSummary('cg', { table_id: 't', added: [added('local', null)], skipped: [] })).toBe(
      '补上了 1 格:对不上的 1 格先用构图本身(标了待重配)。',
    );
  });

  it('没补上的写原因,同样的原因只写一次', () => {
    expect(
      fillSummary('voice', {
        table_id: 't',
        added: [added('name', 'e1')],
        skipped: [
          { item: 'a', reason: '本地认词模型用不了' },
          { item: 'b', reason: '本地认词模型用不了' },
        ],
      }),
    ).toBe('补上了 1 格:名字对上 1 格。2 格没补上:本地认词模型用不了。');
  });
});

describe('openSuggestions:还没采纳的建议,「现在」按表里现在的', () => {
  const cells = [cell('s1', 'e2'), cell('s2', 'e1')];

  it('已经和建议一样的(采纳过、自己改过去的)不列', () => {
    const out = openSuggestions(
      [
        { item: 's1', current: 'e1', suggested: 'e2', new: false },
        { item: 's2', current: 'e3', suggested: 'e2', new: false },
      ],
      cells,
    );
    expect(out).toEqual([{ item: 's2', current: 'e1', suggested: 'e2', new: false }]);
  });

  it('表里还没有的格子算新加;补上以后就不是新加了', () => {
    expect(openSuggestions([{ item: 's3', current: null, suggested: 'e1', new: true }], cells)).toEqual([
      { item: 's3', current: null, suggested: 'e1', new: true },
    ]);
    expect(
      openSuggestions([{ item: 's3', current: null, suggested: 'e1', new: true }], [...cells, cell('s3', 'e9')]),
    ).toEqual([{ item: 's3', current: 'e9', suggested: 'e1', new: false }]);
  });

  it('CG 的建议是构图本身(null)、表里也是构图本身:不列', () => {
    expect(openSuggestions([{ item: 's1', current: 'x', suggested: null, new: false }], [cell('s1', null)])).toEqual(
      [],
    );
  });
});
