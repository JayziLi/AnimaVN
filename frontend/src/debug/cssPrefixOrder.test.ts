/**
 * 打包时的 CSS 压缩(lightningcss)把同一条规则里「先 backdrop-filter、后 -webkit-backdrop-filter」当成后一条盖掉前一条,
 * 只留下带前缀的那条 —— Chrome / Edge 不认带前缀的,打包后的游戏菜单、对话框就没有毛玻璃了(开发模式下看不出来)。
 * 两条都要写的地方一律带前缀的在前、标准的在后,压缩后两条都在。这里把 src 下所有 .css 过一遍。
 */
/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return cssFiles(p);
    return e.name.endsWith('.css') ? [p] : [];
  });
}

describe('CSS 前缀顺序', () => {
  it('-webkit-backdrop-filter 写在 backdrop-filter 前面', () => {
    const bad: string[] = [];
    for (const file of cssFiles(SRC)) {
      const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/^\s*backdrop-filter\s*:/.test(line) && /^\s*-webkit-backdrop-filter\s*:/.test(lines[i + 1] ?? '')) {
          bad.push(`${relative(SRC, file)}:${i + 1}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});
