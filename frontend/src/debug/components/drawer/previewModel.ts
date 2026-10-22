/**
 * 插件抽屉的快速预览(第 2 步 D6):立绘、语音、背景三页「试一下」要的纯逻辑。
 * 试的结果只放在页面上:不写进对话、不改设置、不写认词记录(不调会记下结果的 emotionResolve)。
 */

import type { PackSprite, WordRecordOut } from '../../lib/api';
import { currentText, type ChatEntry } from '../../lib/chatEntry';
import { resolveByLabel } from '../../plugins/common';
import { jevText } from '../../plugins/jevNotes';
import { parseBilingual } from '../../plugins/lang';
import { extractTags, type TagKind } from '../../vn/script';

/**
 * 最近几句角色说的台词(只在看的是调试台当前那张卡时有):新的在前,同一句不重复,最多 max 句。
 * 和游戏同一套切句(Jev 标过的合并进来;回复里有立绘标签时,没带标签的引号不算角色的);标签去掉
 */
export function recentLines(
  entries: readonly ChatEntry[],
  o: { charName: string; userName: string; kinds: readonly TagKind[] },
  max = 3,
): string[] {
  const out: string[] = [];
  for (let i = entries.length - 1; i >= 0 && out.length < max; i--) {
    const e = entries[i];
    if (e.role !== 'assistant') continue;
    const parsed = parseBilingual(jevText(e, o.kinds), {
      charName: o.charName,
      userName: o.userName,
      tags: o.kinds,
      streaming: false,
    });
    for (let j = parsed.lines.length - 1; j >= 0 && out.length < max; j--) {
      const l = parsed.lines[j];
      const text = l.text.trim();
      if (l.speaker === o.charName && !l.player && text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

/** AI 自己写过的表情词(正文里的立绘标签,不算 Jev 补的):新的在前,去重,最多 max 个 */
export function recentSpriteWords(entries: readonly ChatEntry[], kinds: readonly TagKind[], max = 6): string[] {
  const sprite = kinds.filter((k) => k.kind === 'sprite');
  const out: string[] = [];
  for (let i = entries.length - 1; i >= 0 && out.length < max; i--) {
    const e = entries[i];
    if (e.role !== 'assistant') continue;
    const words = extractTags(currentText(e), sprite, false).tags.map((t) => t.label.trim());
    for (let j = words.length - 1; j >= 0 && out.length < max; j--) {
      if (words[j] && !out.includes(words[j])) out.push(words[j]);
    }
  }
  return out;
}

/** AI 写的这个词会换成哪张:名字 / 别名对上 → 认词记录里记过 → 没有(null)。只查不写 */
export function resolveWordLocally(
  word: string,
  sprites: readonly PackSprite[],
  records: readonly WordRecordOut[],
): { sprite: PackSprite; how: 'name' | 'record' } | null {
  const w = word.trim();
  if (!w) return null;
  const byName = resolveByLabel(w, sprites);
  if (byName) return { sprite: byName, how: 'name' };
  const rec = records.find((r) => r.word === w);
  const byRecord = rec ? sprites.find((s) => s.id === rec.item) : undefined;
  return byRecord ? { sprite: byRecord, how: 'record' } : null;
}

/** 音频的峰值条(画波形用):bars 条,每条是那一段里最大的振幅,按最响的那条归一到 0–1 */
export function peaks(samples: Float32Array, bars: number): number[] {
  const out = new Array<number>(bars).fill(0);
  if (samples.length === 0 || bars <= 0) return out;
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b * samples.length) / bars);
    const to = Math.max(from + 1, Math.floor(((b + 1) * samples.length) / bars));
    let m = 0;
    for (let i = from; i < to && i < samples.length; i++) m = Math.max(m, Math.abs(samples[i]));
    out[b] = m;
  }
  const top = Math.max(...out);
  return top > 0 ? out.map((v) => v / top) : out;
}
