/**
 * 整条链路对答案:同一张卡、同一个预设、同一句话,我们组装出来发给 AI 的东西
 * 和酒馆实际发出去的是不是一样。
 *
 * 样本文件夹里的 e2e/:
 *   manifest.json   5 个预设 × 5 张卡,每张卡配一句带世界书关键词的用户消息
 *   captured.jsonl  真的把酒馆 1.18 跑起来(独立数据目录)、接一个假的 AI 接口,记下的请求体
 *   runs.jsonl      哪一组对应 captured 的第几行
 * 怎么重新抓见 e2e/tools/README.md。文件夹不在就跳过。
 *
 * 不比正则脚本(我们没做)。随机数两边都钉成 0。
 */
/// <reference types="node" />
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getEncoding } from 'js-tiktoken';
import { describe, expect, it } from 'vitest';
import { assemble } from './assembler';
import { parseCardFile } from './cardParser';
import { parsePreset, pickDefaultOrderGroup } from './presetParser';

const DIR = process.env.TAVERN_E2E ?? join(homedir(), 'Desktop', '角色素材', '_酒馆卡样本', 'e2e');

interface Manifest {
  presets: { key: string; file: string }[];
  cards: { key: string; file: string; message: string }[];
}
interface Message {
  role: string;
  content: string;
  name?: string;
}

/**
 * 酒馆数 token 用的是真的分词器(接口认不出模型时是 cl100k)。世界书预算卡在哪一条、
 * 聊天记录留几条都取决于它,所以对照时两边得用同一把尺子。
 */
const cl100k = getEncoding('cl100k_base');
const tavernCount = (text: string) => cl100k.encode(text).length;

const ready = existsSync(join(DIR, 'manifest.json')) && existsSync(join(DIR, 'runs.jsonl'));

function load() {
  const manifest: Manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf-8'));
  const captured = readFileSync(join(DIR, 'captured.jsonl'), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).body as { messages: Message[] });
  // 同一组跑过多次的取最后一次抓到的
  const index = new Map<string, number>();
  for (const line of readFileSync(join(DIR, 'runs.jsonl'), 'utf-8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as { id: string; capturedIndex: number | null };
    if (row.capturedIndex !== null && row.capturedIndex !== undefined) index.set(row.id, row.capturedIndex);
  }
  return { manifest, captured, index };
}

async function ours(presetFile: string, cardFile: string, message: string) {
  const presetText = readFileSync(join(DIR, presetFile), 'utf-8').replace(/^﻿/, '');
  const preset = parsePreset(presetText, 'e2e');
  const png = readFileSync(join(DIR, cardFile));
  const card = await parseCardFile(new File([new Uint8Array(png)], 'card.png', { type: 'image/png' }));
  const group = pickDefaultOrderGroup(preset.orderGroups);
  // 酒馆留给提示词的额度 = 上下文大小 − 留给回复的长度;世界书的 25% 也是按这个数算的
  const maxContext = Number(preset.params.openai_max_context);
  const maxResponse = Number(preset.params.openai_max_tokens) || 0;

  const result = assemble({
    card,
    preset,
    order: group?.order ?? [],
    history: [
      ...(card.first_mes ? [{ role: 'assistant' as const, content: card.first_mes }] : []),
      { role: 'user' as const, content: message },
    ],
    userName: 'User',
    personaDescription: '',
    allowCardOverrides: true,
    tokenBudget: Number.isFinite(maxContext) ? maxContext - maxResponse : null,
    macroExtra: { lastGenerationType: 'normal', model: 'mock-model' },
    random: () => 0,
    // 酒馆没有「行首 // 当注释」这回事
    lineComments: false,
    countTokens: tavernCount,
  });
  return {
    messages: result.messages.map((m): Message => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    })),
    worldInfo: { budget: result.worldInfo?.budget, rows: result.worldInfo?.rows },
  };
}

/** 两份消息列表第一处不同在哪。一样返回 null */
function firstDiff(theirs: Message[], mine: Message[]): string | null {
  const n = Math.max(theirs.length, mine.length);
  for (let i = 0; i < n; i++) {
    const a = theirs[i];
    const b = mine[i];
    if (!a || !b) {
      const extra = a ?? b;
      return `第 ${i} 条:${a ? '酒馆多' : '我们多'}一条 [${extra.role}] ${JSON.stringify(extra.content.slice(0, 80))}`;
    }
    if (a.role !== b.role) {
      return `第 ${i} 条角色不同:酒馆 ${a.role} / 我们 ${b.role} · 酒馆 ${JSON.stringify(a.content.slice(0, 60))} · 我们 ${JSON.stringify(b.content.slice(0, 60))}`;
    }
    if (a.name !== b.name) {
      return `第 ${i} 条 name 不同:酒馆 ${a.name} / 我们 ${b.name} · ${JSON.stringify(a.content.slice(0, 60))}`;
    }
    if (a.content !== b.content) {
      let at = 0;
      while (at < a.content.length && a.content[at] === b.content[at]) at++;
      const show = (s: string) => JSON.stringify(s.slice(Math.max(0, at - 40), at + 80));
      return `第 ${i} 条 [${a.role}] 第 ${at} 字起不同\n      酒馆: ${show(a.content)}\n      我们: ${show(b.content)}`;
    }
  }
  return null;
}

describe.skipIf(!ready)('和酒馆整条链路对答案', () => {
  const { manifest, captured, index } = ready
    ? load()
    : { manifest: { presets: [], cards: [] }, captured: [], index: new Map<string, number>() };

  const report: { id: string; same: boolean; theirs: number; ours: number; diff: string | null }[] = [];

  for (const p of manifest.presets) {
    for (const c of manifest.cards) {
      const id = `${p.key}__${c.key}`;
      it(id, { timeout: 120_000 }, async () => {
        const at = index.get(id);
        expect(at, '这一组没有抓到酒馆的请求').toBeDefined();
        const theirs = captured[at as number].messages;
        const { messages: mine, worldInfo } = await ours(p.file, c.file, c.message);
        const diff = firstDiff(theirs, mine);
        report.push({ id, same: diff === null, theirs: theirs.length, ours: mine.length, diff });
        if (process.env.TAVERN_E2E_DUMP === id) {
          writeFileSync(join(DIR, `dump-${id}.json`), JSON.stringify({ theirs, mine, worldInfo }, null, 1));
        }
        expect(diff, `${id}:${diff}`).toBeNull();
      });
    }
  }

  it.skipIf(!process.env.TAVERN_E2E_REPORT)('写对比报告', () => {
    writeFileSync(join(DIR, 'report.json'), JSON.stringify(report, null, 1));
  });
});
