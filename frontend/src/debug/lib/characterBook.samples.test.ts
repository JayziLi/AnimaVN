/**
 * 真实角色卡回归:桌面「角色素材\_酒馆卡样本」里的每张 PNG 卡都要能
 * 读进来、原样写回去、跑一遍触发不报错。样本文件夹不在(别的机器)就整个跳过。
 *
 * 样本来源和统计见 docs/superpowers/specs/2026-09-29-world-info-sillytavern-compat-design.md。
 */
/// <reference types="node" />
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBook, serializeBook } from './characterBook';
import { DEFAULT_WORLD_INFO_SETTINGS, activateWorldInfo } from './worldInfo';

const SAMPLES = process.env.CARD_SAMPLES ?? join(homedir(), 'Desktop', '角色素材', '_酒馆卡样本', 'chub');

/** PNG tEXt chunk 里的卡 JSON(ccv3 优先),没有就 null */
function readCard(path: string): Record<string, unknown> | null {
  const buf = readFileSync(path);
  const chunks = new Map<string, Buffer>();
  let i = 8;
  while (i + 8 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const kind = buf.subarray(i + 4, i + 8).toString('latin1');
    if (kind === 'tEXt') {
      const body = buf.subarray(i + 8, i + 8 + length);
      const zero = body.indexOf(0);
      chunks.set(body.subarray(0, zero).toString('latin1'), body.subarray(zero + 1));
    }
    i += 12 + length;
  }
  const raw = chunks.get('ccv3') ?? chunks.get('chara');
  if (!raw) return null;
  return JSON.parse(Buffer.from(raw.toString('latin1'), 'base64').toString('utf-8'));
}

const files = existsSync(SAMPLES) ? readdirSync(SAMPLES).filter((f) => f.endsWith('.png')) : [];

describe.skipIf(files.length === 0)(`样本卡 (${files.length} 张)`, () => {
  for (const file of files) {
    it(file, () => {
      const card = readCard(join(SAMPLES, file));
      expect(card).not.toBeNull();
      const data = ((card as Record<string, unknown>).data ?? card) as Record<string, unknown>;
      const original = data.character_book;
      const book = parseBook(original);
      expect(book).not.toBeNull();
      if (!book) return;

      // 没动过就要一字不差
      expect(serializeBook(book)).toEqual(original);

      // 触发一遍不能炸,常驻的都得进
      const r = activateWorldInfo({
        entries: book.entries,
        messages: ['User: 你好,我们去王都吧', 'Char: 好啊'],
        scanData: {
          personaDescription: '',
          characterDescription: String(data.description ?? ''),
          characterPersonality: '',
          characterDepthPrompt: '',
          scenario: '',
          creatorNotes: '',
        },
        settings: DEFAULT_WORLD_INFO_SETTINGS,
        maxContext: 32768,
        random: () => 0.5,
        substitute: (s) => s,
        countTokens: (s) => Math.ceil(s.length / 2),
      });
      const constants = book.entries.filter((e) => e.enabled && e.constant && e.content.trim());
      const placedConstants = r.rows.filter(
        (row) => row.placed && constants.some((e) => e.uid === row.uid),
      );
      // 超预算、自定义出口、@@dont_activate、分组落选、概率没掷中都是合法的没进原因
      if (!r.overflowed) {
        for (const e of constants) {
          const row = r.rows.find((x) => x.uid === e.uid);
          expect(row, `条目 ${e.uid} 没有报告`).toBeDefined();
          if (!row?.placed) {
            expect(row?.reason).toMatch(
              /出口|dont_activate|互斥分组|正文是空的|只在这些生成方式|聊天满|概率/,
            );
          }
        }
      }
      expect(placedConstants.length).toBeLessThanOrEqual(constants.length);
    });
  }
});
