/**
 * 和后端导入器对拍(素材架构第 3 段 B3):同一批合成卡(AnimaBackend/tests/fixtures/cards/),
 * 前端导入时 POST 的那份(DebugApp 的 loadCard:cardToStored(parseCardFile(file)) + 头像)
 * 要和 *.expected.json 逐字段一样,后端 app/importer/cards.py 的 parse_card 也和同一份比。
 *
 * 改了解析规则要重算期望结果:UPDATE_CARD_FIXTURES=1 npx vitest run src/debug/lib/cardParser.fixtures.test.ts
 * (卡本身由 AnimaBackend/tests/fixtures/cards/make_cards.py 生成)。
 */
/// <reference types="node" />
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCardFile } from './cardParser';
import { cardToStored } from './cardStore';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../AnimaBackend/tests/fixtures/cards');
const UPDATE = Boolean(process.env.UPDATE_CARD_FIXTURES);

const isCardFile = (name: string) => /\.(png|json)$/i.test(name) && !name.endsWith('.expected.json');
const expectedPath = (name: string) => join(DIR, name.replace(/\.[^.]+$/, '.expected.json'));

function fileOf(name: string): { file: File; bytes: Buffer } {
  const bytes = readFileSync(join(DIR, name));
  // 浏览器里拖进来的 .png 带 image/png;.json 的类型解析时用不到
  const type = name.toLowerCase().endsWith('.png') ? 'image/png' : 'application/json';
  return { file: new File([new Uint8Array(bytes)], name, { type }), bytes };
}

/** DebugApp.loadCard 建卡时 POST 的那份 */
async function payloadOf(name: string): Promise<Record<string, unknown>> {
  const { file, bytes } = fileOf(name);
  const parsed = await parseCardFile(file);
  const isPng = file.name.toLowerCase().endsWith('.png') || file.type === 'image/png';
  // loadCard 用 fileToDataUrl(FileReader.readAsDataURL),node 里没有 FileReader;
  // readAsDataURL 的结果就是 data:<文件类型>;base64,<整个文件>,这里照样拼
  const avatar = isPng ? `data:${file.type};base64,${bytes.toString('base64')}` : parsed.avatar;
  return { ...cardToStored(parsed), avatar };
}

const names = readdirSync(DIR).filter(isCardFile).sort();

describe('酒馆卡夹具:前端解析和后端 parse_card 对拍', () => {
  it('夹具都在', () => {
    expect(names.length).toBeGreaterThanOrEqual(7);
  });

  for (const name of names) {
    const expected = expectedPath(name);
    if (!existsSync(expected) && !UPDATE) continue;
    if (name === 'no_card.png') continue;
    it(name, async () => {
      const payload = await payloadOf(name);
      if (UPDATE) {
        writeFileSync(expected, JSON.stringify(payload, null, 2) + '\n');
        return;
      }
      const want = JSON.parse(readFileSync(expected, 'utf-8')) as Record<string, unknown>;
      expect(payload).toEqual(want);
      // 键的先后也一样(世界书的 entries 写回时排到最后)
      expect(JSON.stringify(payload)).toBe(JSON.stringify(want));
    });
  }

  it('没有卡数据的 PNG 报错', async () => {
    await expect(parseCardFile(fileOf('no_card.png').file)).rejects.toThrow('没有找到角色卡数据');
  });
});
