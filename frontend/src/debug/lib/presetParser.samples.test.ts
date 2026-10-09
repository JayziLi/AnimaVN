/**
 * 真实预设回归:桌面「角色素材\_酒馆卡样本\presets」下的每个 Chat Completion 预设都要能
 * 解析、选出编排、跑一遍组装不报错。样本文件夹不在就整个跳过。
 *
 * 只保证「不炸」。哪些字段导入后丢了、哪些功能没实现,见设计文档里的统计。
 */
/// <reference types="node" />
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assemble } from './assembler';
import { EMPTY_CARD } from './cardParser';
import { parsePreset, pickDefaultOrderGroup } from './presetParser';

const SAMPLES =
  process.env.PRESET_SAMPLES ?? join(homedir(), 'Desktop', '角色素材', '_酒馆卡样本', 'presets');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === '.git') return [];
    if (statSync(p).isDirectory()) return walk(p);
    return name.endsWith('.json') ? [p] : [];
  });
}

const files = walk(SAMPLES).filter((p) => {
  try {
    const text = readFileSync(p, 'utf-8').replace(/^﻿/, '');
    const d = JSON.parse(text);
    return d && Array.isArray(d.prompts) && 'prompt_order' in d;
  } catch {
    return false;
  }
});

describe.skipIf(files.length === 0)(`样本预设 (${files.length} 个)`, () => {
  for (const file of files) {
    it(file.slice(SAMPLES.length + 1), () => {
      const text = readFileSync(file, 'utf-8').replace(/^﻿/, '');
      const preset = parsePreset(text, 'sample');
      expect(preset.prompts.length).toBeGreaterThan(0);
      const group = pickDefaultOrderGroup(preset.orderGroups);
      expect(group).not.toBeNull();
      if (!group) return;

      const r = assemble({
        card: { ...EMPTY_CARD, name: '艾琳', description: '骑士团长', first_mes: '你好' },
        preset,
        order: group.order,
        history: [
          { role: 'assistant', content: '你好' },
          { role: 'user', content: '我们去王都吧' },
        ],
        userName: '旅人',
        personaDescription: '',
        allowCardOverrides: true,
        tokenBudget: null,
      });
      expect(r.messages.length).toBeGreaterThan(0);
    });
  }
});
