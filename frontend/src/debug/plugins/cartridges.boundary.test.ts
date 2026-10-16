/**
 * 卡带的边界(cartridges.ts 开头的规矩):卡带文件夹外面谁都不许 import 卡带里的东西,卡带之间也不许。
 *
 * 卡带文件夹 = plugins/ 下面有 cartridge.ts 的文件夹(和 cartridges.ts 的 glob 同一个认法),所以这里不写
 * 它们的名字;一个卡带都没有时(公开版)什么都不查。只有登记处 cartridges.ts 和私有工具可以碰卡带。
 */
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARTRIDGES } from './cartridges';

/** 前端根目录;下面的路径都相对它、用 / 分隔 */
const FRONTEND = fileURLToPath(new URL('../../../', import.meta.url));
const PLUGINS = 'src/debug/plugins';
/** 登记处:只有它按 glob 收卡带 */
const REGISTRY = `${PLUGINS}/cartridges.ts`;
/** 私有工具:生成公开版时一起删(publish/make_public.py 的 DROP),可以直接 import 卡带 */
const PRIVATE_TOOLS = ['src/debug/replay/'];

/**
 * 代码里写的模块路径:import / export … from、import()、import.meta.glob()、vi.mock 一类、require()、
 * new URL()。注释里写成 import 的样子也算(宁可多报)
 */
const SPECIFIER =
  /(?:\bfrom|\bimport|\bimport\s*\(|\bimport\.meta\.glob\s*\(|\bvi\.(?:mock|doMock|unmock|importActual|importMock)\s*\(|\brequire\s*\(|\bnew\s+URL\s*\()\s*(['"`])([^'"`\r\n]+)\1/g;

const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

/** 文件列表里的卡带文件夹:plugins/<x>/cartridge.ts 所在的 plugins/<x> */
function cartridgeDirsOf(files: readonly string[]): string[] {
  const re = new RegExp(`^(${PLUGINS}/[^/]+)/cartridge\\.ts$`);
  return files.flatMap((f) => re.exec(f)?.[1] ?? []).sort();
}

/** 模块路径落到哪个文件(相对前端根目录);包名是 null */
function resolveSpecifier(file: string, spec: string): string | null {
  const path = spec.replace(/[?#].*$/, '');
  if (path === '.' || path === '..' || path.startsWith('./') || path.startsWith('../')) {
    return posix.normalize(posix.join(posix.dirname(file), path));
  }
  // vite 里 / 开头是项目根目录
  if (path.startsWith('/')) return posix.normalize(path.slice(1));
  return null;
}

/** file 里 import 了哪些不该碰的卡带文件:返回代码里写的那串路径。同一个卡带文件夹里互相 import 不算 */
function cartridgeImports(file: string, source: string, dirs: readonly string[]): string[] {
  const own = dirs.find((d) => inside(file, d));
  const out: string[] = [];
  for (const m of source.matchAll(SPECIFIER)) {
    const target = resolveSpecifier(file, m[2]);
    if (target === null) continue;
    const dir = dirs.find((d) => inside(target, d));
    if (dir !== undefined && dir !== own) out.push(m[2]);
  }
  return out;
}

/** src 下全部 .ts / .tsx(相对前端根目录) */
function sourceFiles(): string[] {
  return readdirSync(join(FRONTEND, 'src'), { recursive: true, encoding: 'utf8' })
    .map((f) => `src/${f.replaceAll('\\', '/')}`)
    .filter((f) => /\.tsx?$/.test(f))
    .sort();
}

describe('卡带的边界', () => {
  const files = sourceFiles();
  const dirs = cartridgeDirsOf(files);

  it('能找到源码(路径没算错)', () => {
    expect(files).toContain(REGISTRY);
  });

  it('和登记处认的是同一批卡带', () => {
    expect([...CARTRIDGES.keys()].map((id) => `${PLUGINS}/${id}`).sort()).toEqual(dirs);
  });

  it('卡带文件夹外面没人 import 卡带,卡带之间也不', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f === REGISTRY || PRIVATE_TOOLS.some((p) => f.startsWith(p))) continue;
      for (const spec of cartridgeImports(f, readFileSync(join(FRONTEND, f), 'utf8'), dirs)) bad.push(`${f} → ${spec}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('扫 import 的规则', () => {
  const A = `${PLUGINS}/fake-a`;
  const B = `${PLUGINS}/fake-b`;
  const dirs = [A, B];

  it('认得 plugins 下面有 cartridge.ts 的文件夹', () => {
    expect(
      cartridgeDirsOf([
        `${A}/cartridge.ts`,
        `${A}/thing.ts`,
        `${PLUGINS}/common.ts`,
        `${PLUGINS}/deep/er/cartridge.ts`,
        'src/debug/core/x/cartridge.ts',
        `${B}/cartridge.ts`,
      ]),
    ).toEqual([A, B]);
  });

  it('各种写法的 import 都算', () => {
    const source = [
      "import { a } from './fake-a/thing';",
      "import type { T } from './fake-a/types';",
      "export { b } from './fake-a/b';",
      "export * from './fake-a';",
      "import './fake-a/style.css';",
      "const m = await import('./fake-a/lazy');",
      "vi.mock('./fake-a/mocked', () => ({}));",
      "const g = import.meta.glob('./fake-a/*.ts');",
      "const raw = import('./fake-a/data.json?raw');",
      "const url = new URL('./fake-a/pic.png', import.meta.url);",
      'import {',
      '  x,',
      '  y,',
      "} from './fake-a/multi';",
      'import { z } from "/src/debug/plugins/fake-b/abs";',
    ].join('\n');
    expect(cartridgeImports(`${PLUGINS}/core.ts`, source, dirs)).toEqual([
      './fake-a/thing',
      './fake-a/types',
      './fake-a/b',
      './fake-a',
      './fake-a/style.css',
      './fake-a/lazy',
      './fake-a/mocked',
      './fake-a/*.ts',
      './fake-a/data.json?raw',
      './fake-a/pic.png',
      './fake-a/multi',
      '/src/debug/plugins/fake-b/abs',
    ]);
  });

  it('按 import 它的文件所在的位置算相对路径', () => {
    const source = "import { a } from '../plugins/fake-a/thing';\nimport { c } from '../plugins/common';";
    expect(cartridgeImports('src/debug/vn/VNScreen.tsx', source, dirs)).toEqual(['../plugins/fake-a/thing']);
    expect(cartridgeImports('src/debug/vn/deeper/x.ts', source, dirs)).toEqual([]);
  });

  it('卡带里 import 自己的文件和内核可以,import 别的卡带不行', () => {
    const source = [
      "import { a } from './thing';",
      "import { c } from '../common';",
      "import type { Cartridge } from '../cartridges';",
      "import { b } from '../fake-b/thing';",
    ].join('\n');
    expect(cartridgeImports(`${A}/cartridge.ts`, source, dirs)).toEqual(['../fake-b/thing']);
    expect(cartridgeImports(`${A}/sub/deep.ts`, "import { a } from '../thing';", dirs)).toEqual([]);
  });

  it('包名、名字只是开头一样的文件夹不算', () => {
    const source = [
      "import { useState } from 'react';",
      "import { a } from './fake-a-old/thing';",
      "import { b } from './fake-ab';",
      'const s = Array.from("abc");',
    ].join('\n');
    expect(cartridgeImports(`${PLUGINS}/core.ts`, source, dirs)).toEqual([]);
  });
});
