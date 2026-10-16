/**
 * 卡编辑器左栏顶上那块角色信息要的几样:卡的版本、一段简介、开场白和世界书的条数;
 * 还有实机预览对话框里的那句台词(开场白第一句)。
 */

import type { TavernCard } from '../lib/cardParser';

/** 「酒馆卡 V2」;认不出的(调试台里新建的卡没有 spec)就叫「角色卡」 */
export function specLabel(spec: string): string {
  const m = /^chara_card_v(\d+)$/i.exec(spec.trim());
  return m ? `酒馆卡 V${m[1]}` : '角色卡';
}

/** 简介最多这么多字(界面上再按三行截) */
const BLURB_MAX = 160;

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

/**
 * 一段话的第一段:去掉 HTML 标签和 markdown 图片(Chub 的创作者注释常常是一整个网页)、
 * 只有标签的行(描述开头的 <char info> 这类),{{char}} 换成卡名、{{user}} 换成「你」。
 */
function firstParagraph(text: string, name: string): string {
  const lines = text.split(/\r?\n/).map((line) =>
    line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/<[^>\n]*>/g, '')
      .replace(/&(nbsp|amp|lt|gt|quot);/g, (m) => ENTITIES[m] ?? m)
      .replace(/\{\{char\}\}/gi, name)
      .replace(/\{\{user\}\}/gi, '你')
      .trim(),
  );
  const start = lines.findIndex((l) => l !== '');
  if (start < 0) return '';
  const end = lines.indexOf('', start);
  const para = lines
    .slice(start, end < 0 ? undefined : end)
    .join(' ')
    .replace(/\s+/g, ' ');
  return para.length > BLURB_MAX ? `${para.slice(0, BLURB_MAX)}…` : para;
}

/** 左栏的简介:创作者注释有就用它,没有用描述的第一段 */
export function cardBlurb(card: Pick<TavernCard, 'name' | 'creator_notes' | 'description'>): string {
  return firstParagraph(card.creator_notes, card.name) || firstParagraph(card.description, card.name);
}

/** 开场白几条:主开场白(有写的话)+ 其他开场白 */
export function greetingCount(card: Pick<TavernCard, 'first_mes' | 'alternate_greetings'>): number {
  return (card.first_mes.trim() ? 1 : 0) + card.alternate_greetings.length;
}

/** 卡自带的世界书几条 */
export function bookCount(card: Pick<TavernCard, 'character_book'>): number {
  return card.character_book?.entries.length ?? 0;
}

/** 开场白第一句最多这么多字(连省略号) */
const LINE_MAX = 40;

/** 一句话到这儿算完:中文句号、问号、叹号、省略号、波浪号,英文句号后面要跟空白或结尾 */
const SENTENCE_END = /[。！？!?～~]+|…+|\.(?=\s|$)/;

/**
 * 实机预览对话框里的台词:开场白的第一句。{{char}} / {{user}}(还有老写法 <BOT> / <USER>)换成名字,
 * 去掉 HTML 标签、markdown 图片、斜体的星号和引号;截到 max 字以内,截了就以「…」结尾。没写开场白是空串
 */
export function greetingLine(card: Pick<TavernCard, 'name' | 'first_mes'>, userName: string, max = LINE_MAX): string {
  const line =
    card.first_mes
      .split(/\r?\n/)
      .map((l) =>
        l
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
          .replace(/<(user|bot|char)>/gi, (_, w: string) => `{{${w.toLowerCase() === 'user' ? 'user' : 'char'}}}`)
          .replace(/<[^>\n]*>/g, '')
          .replace(/&(nbsp|amp|lt|gt|quot);/g, (m) => ENTITIES[m] ?? m)
          .replace(/\{\{char\}\}/gi, card.name)
          .replace(/\{\{user\}\}/gi, userName)
          .replace(/[*"「」『』“”]/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .find((l) => l !== '') ?? '';
  const end = SENTENCE_END.exec(line);
  const first = end ? line.slice(0, end.index + end[0].length) : line;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
