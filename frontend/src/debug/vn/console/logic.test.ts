import { describe, expect, it } from 'vitest';
import { asset, CHAR, ctxOf, hit, sprite } from '../../core/timeline.fixtures';
import type { TagKind } from '../script';
import { vnTagKinds } from '../tags';
import { clipStatus, describeMatch, hitVerdict, hitWhere, isMiss, pickedLine, rawSegments, resolveTag } from './logic';

const sprites = [sprite('s1', '微笑'), { ...sprite('s2', '平静'), has_image: false }];
const sceneAssets = [asset({ id: 'b1', kind: 'bg', label: '校园' }), asset({ id: 'm1', kind: 'bgm', label: '心动', has_file: false })];
const ctx = { emotion: ctxOf({ sprites, sceneAssets }).emotion, sprites, sceneAssets };

describe('describeMatch', () => {
  it('对上了是 ✓,模型认的是 ≈ 并带分数,没传图的提一句', () => {
    expect(describeMatch({ state: 'exact', label: '微笑' }, sprites)).toEqual({ mark: '✓', text: '微笑' });
    expect(describeMatch({ state: 'exact', label: '平静' }, sprites).text).toBe('平静(还没传图)');
    expect(describeMatch({ state: 'model', label: '微笑', score: 0.8 }, sprites)).toEqual({ mark: '≈', text: '微笑(模型 0.80)' });
    expect(describeMatch({ state: 'record', label: '微笑', source: 'model' }, sprites).text).toContain('认词记录');
  });
  it('还在认不是错误', () => {
    const v = describeMatch({ state: 'pending' }, sprites);
    expect(v.mark).toBe('…');
    expect(isMiss(v)).toBe(false);
  });
  it('失败才是红的,原因原样给(英文报错不翻译)', () => {
    const v = describeMatch({ state: 'failed', reason: 'HTTP 503 Service Unavailable' }, sprites);
    expect(isMiss(v)).toBe(true);
    expect(v.text).toBe('HTTP 503 Service Unavailable,保持上一张');
    expect(describeMatch({ state: 'failed', reason: 'x' }, []).text).toBe('x,占位框写原词');
  });
  it('一张立绘都没有时写「内置表情」', () => {
    expect(describeMatch({ state: 'exact', label: '开心' }, []).text).toBe('内置表情 开心');
  });
});

describe('resolveTag / hitVerdict', () => {
  it('背景、音乐按名字找;文件没传提一句', () => {
    expect(resolveTag('bg', '校园', ctx)).toEqual({ mark: '✓', text: '校园' });
    expect(resolveTag('bgm', '心动', ctx).text).toBe('心动(还没传文件)');
  });
  it('场景包里没有这个名字才算没对上', () => {
    const v = resolveTag('bg', '海边', ctx);
    expect(isMiss(v)).toBe(true);
    expect(v.text).toContain('场景包里没有这个');
    expect(resolveTag('bg', '海边', { ...ctx, sceneAssets: [] }).text).toBe('这张卡没有绑定场景包');
  });
  it('玩家台词、收起 CG 不是错', () => {
    expect(isMiss(resolveTag('player', '我', ctx))).toBe(false);
    expect(resolveTag('cg', '收起', ctx).text).toBe('收起 CG');
  });
  it('跟在别的角色台词前的立绘标签不切立绘,用中性的 —', () => {
    const v = hitVerdict(hit('sprite', '微笑', 0, '路人'), ctx);
    expect(v.mark).toBe('—');
    expect(isMiss(v)).toBe(false);
    expect(hitVerdict(hit('sprite', '微笑', 0, CHAR), ctx).mark).toBe('✓');
  });
  it('生效于:末尾的标签写「延续到下一条」', () => {
    expect(hitWhere(hit('sprite', '微笑', 2))).toBe('第 3 句');
    expect(hitWhere(hit('sprite', '微笑', -1))).toContain('延续到下一条');
  });
});

describe('rawSegments', () => {
  const kinds: TagKind[] = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
  const ok = (_k: string, label: string) => label !== '坏';
  it('把标签切出来,带是否对上和类别', () => {
    const segs = rawSegments('<sprite:微笑>你好<sprite:坏>再见', kinds, ok);
    expect(segs.map((s) => s.text)).toEqual(['<sprite:微笑>', '你好', '<sprite:坏>', '再见']);
    expect(segs[0].tag).toEqual({ ok: true, kind: 'sprite' });
    expect(segs[2].tag).toEqual({ ok: false, kind: 'sprite' });
    expect(segs[1].tag).toBeUndefined();
  });
  it('原文空是空,没有标签就整段', () => {
    expect(rawSegments('', kinds, ok)).toEqual([]);
    expect(rawSegments('只有字', kinds, ok)).toEqual([{ text: '只有字' }]);
  });
  it('模板不合法(pattern 是 null)的那类不认', () => {
    const bad = kinds.map((k) => (k.kind === 'sprite' ? { ...k, pattern: null } : k));
    expect(rawSegments('<sprite:微笑>', bad, ok)).toEqual([{ text: '<sprite:微笑>' }]);
  });
});

describe('clipStatus', () => {
  it('各个状态;出错给后端原文', () => {
    expect(clipStatus(undefined).text).toBe('还没请求');
    expect(clipStatus({ state: 'queued' }).text).toBe('排队中');
    expect(clipStatus({ state: 'loading' }).text).toBe('合成中…');
    expect(clipStatus({ state: 'ready', cache: 'hit', emotion: '平静', mode: 'ref', ms: 900 })).toEqual({
      text: '缓存命中 · 0.9 秒',
      error: false,
      ok: true,
    });
    expect(clipStatus({ state: 'error', message: 'Connection refused' })).toEqual({
      text: 'Connection refused',
      error: true,
      ok: false,
    });
  });
});

describe('pickedLine', () => {
  const hits = [hit('sprite', '微笑', 0), hit('sprite', '平静', 2), hit('bgm', '心动', -1)];
  it('没点就是光标那句,夹在句子范围里', () => {
    expect(pickedLine(null, hits, 3, 1)).toBe(1);
    expect(pickedLine(null, hits, 3, 9)).toBe(2);
    expect(pickedLine(null, hits, 0, 4)).toBe(0);
  });
  it('点标签表的一行看它生效的那句,末尾的标签看最后一句', () => {
    expect(pickedLine({ table: 'tag', index: 1 }, hits, 3, 0)).toBe(2);
    expect(pickedLine({ table: 'tag', index: 2 }, hits, 3, 0)).toBe(2);
    expect(pickedLine({ table: 'tag', index: 9 }, hits, 3, 0)).toBe(2);
  });
  it('点语音表的一行就是那一句', () => {
    expect(pickedLine({ table: 'voice', index: 1 }, hits, 3, 0)).toBe(1);
  });
});
