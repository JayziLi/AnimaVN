import { describe, expect, it } from 'vitest';
import { collectDrop, type DropEntry, type DropItem } from './collectDrop';

// 假的 FileSystemEntry:文件夹每次 readEntries 只给 batch 个(Chrome 一次最多给 100 个),给完以后给空数组
const file = (name: string, content = name) => new File([content], name);

function fileEntry(name: string, opts: { broken?: boolean } = {}): DropEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (ok, err) => {
      if (opts.broken) err?.(new Error('读不了'));
      else setTimeout(() => ok(file(name)));
    },
  };
}

function dirEntry(name: string, children: DropEntry[], batch = 2, calls?: { n: number }): DropEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (ok) => {
          if (calls) calls.n += 1;
          const out = children.slice(at, at + batch);
          at += batch;
          setTimeout(() => ok(out));
        },
      };
    },
  };
}

const entryItem = (entry: DropEntry | null, fallback: File | null = null): DropItem => ({
  kind: 'file',
  webkitGetAsEntry: () => entry,
  getAsFile: () => fallback,
});

const paths = (got: { path: string }[]) => got.map((g) => g.path);

describe('collectDrop', () => {
  it('walks folders, keeping the top-level folder name in each path', async () => {
    const tree = dirEntry('刻晴', [
      fileEntry('刻晴.png'),
      dirEntry('立绘（玉衡星）', [fileEntry('01_微笑.png'), fileEntry('02_生气.png')]),
      dirEntry('BGM候选', [fileEntry('日常.ogg'), fileEntry('picks.json')]),
    ]);
    const got = await collectDrop({ items: [entryItem(tree)] });
    expect(paths(got)).toEqual([
      '刻晴/刻晴.png',
      '刻晴/立绘（玉衡星）/01_微笑.png',
      '刻晴/立绘（玉衡星）/02_生气.png',
      '刻晴/BGM候选/日常.ogg',
      '刻晴/BGM候选/picks.json',
    ]);
    expect(got[0].file.name).toBe('刻晴.png');
  });

  it('keeps calling readEntries until it comes back empty', async () => {
    const calls = { n: 0 };
    const kids = Array.from({ length: 5 }, (_, i) => fileEntry(`${i}.png`));
    const got = await collectDrop({ items: [entryItem(dirEntry('包', kids, 2, calls))] });
    expect(paths(got)).toEqual(['包/0.png', '包/1.png', '包/2.png', '包/3.png', '包/4.png']);
    // 2 + 2 + 1,再来一次空的才算读完
    expect(calls.n).toBe(4);
  });

  it('takes dropped files and folders side by side, in drop order', async () => {
    const got = await collectDrop({
      items: [entryItem(fileEntry('Seraphina.png')), entryItem(dirEntry('expressions', [fileEntry('joy.png')]))],
    });
    expect(paths(got)).toEqual(['Seraphina.png', 'expressions/joy.png']);
  });

  it('reads the entries before the drop event ends (items go stale right after)', async () => {
    let live = true;
    const item: DropItem = {
      kind: 'file',
      webkitGetAsEntry: () => (live ? dirEntry('包', [fileEntry('a.png')]) : null),
      getAsFile: () => null,
    };
    const pending = collectDrop({ items: [item] });
    live = false;
    expect(paths(await pending)).toEqual(['包/a.png']);
  });

  it('falls back to getAsFile when there is no entry API or no entry', async () => {
    const noApi: DropItem = { kind: 'file', getAsFile: () => file('卡.json') };
    const got = await collectDrop({ items: [noApi, entryItem(null, file('图.png'))] });
    expect(paths(got)).toEqual(['卡.json', '图.png']);
  });

  it('falls back to the plain file list when there are no items', async () => {
    const got = await collectDrop({ items: null, files: [file('a.png'), file('b.ogg')] });
    expect(paths(got)).toEqual(['a.png', 'b.ogg']);
    expect(paths(await collectDrop({ files: [file('c.png')] }))).toEqual(['c.png']);
  });

  it('ignores items that are not files (dragged text)', async () => {
    const text: DropItem = { kind: 'string', getAsFile: () => null };
    const got = await collectDrop({ items: [text, entryItem(fileEntry('a.png'))] });
    expect(paths(got)).toEqual(['a.png']);
  });

  it('drops the junk files operating systems leave behind', async () => {
    const tree = dirEntry('包', [
      fileEntry('.DS_Store'),
      fileEntry('Thumbs.db'),
      fileEntry('desktop.ini'),
      dirEntry('__MACOSX', [fileEntry('._joy.png')]),
      fileEntry('joy.png'),
    ]);
    expect(paths(await collectDrop({ items: [entryItem(tree), entryItem(fileEntry('Thumbs.db'))] }))).toEqual([
      '包/joy.png',
    ]);
  });

  it('skips a file it cannot read and keeps the rest', async () => {
    const tree = dirEntry('包', [fileEntry('a.png'), fileEntry('坏.png', { broken: true }), fileEntry('b.png')]);
    expect(paths(await collectDrop({ items: [entryItem(tree)] }))).toEqual(['包/a.png', '包/b.png']);
  });

  it('keeps what a folder gave before its reader failed', async () => {
    let first = true;
    const flaky: DropEntry = {
      isFile: false,
      isDirectory: true,
      name: '包',
      createReader: () => ({
        readEntries: (ok, err) => {
          if (first) {
            first = false;
            ok([fileEntry('a.png')]);
          } else err?.(new Error('读不了'));
        },
      }),
    };
    expect(paths(await collectDrop({ items: [entryItem(flaky)] }))).toEqual(['包/a.png']);
  });
});
