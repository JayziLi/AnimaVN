/**
 * 句检查器(vn/LineInspector.tsx)里「这句为什么这样」的那几行字(素材架构设计 1.3、1.4、1.9):
 * 表情是怎么来的(你手改的 / 谁写的什么词、怎么认出来的 / 沿用 / 开局默认,形态换算过没有)、
 * 背景和 CG 是这句换的还是沿用的、台词前写没写名字、语音那一段是配对表配的还是按名字挑的。
 * 纯函数,这里测、组件不测;只 import 类型和不碰 location 的代码,node 里的测试跑得了
 */
import type { Fold, LineState, Timeline } from '../core/timeline';
import type { PairingCellOut } from '../lib/api';
import { normTag, RECORD_SOURCE_NAME, type TagMatch } from '../plugins/emotionMatch';
import { cellFlags, pairingSourceName } from '../plugins/pairingView';
import type { VNLine } from './script';

// ---- 表情 ----

/** 标签是谁写的(设计 1.3 的 from):AI 写的 / Jev 标的 / 开场白里卡作者写的 */
export type TagBy = 'ai' | 'jev' | 'card';

const BY_NAME: Record<TagBy, string> = { ai: 'AI 写的', jev: 'Jev 标的', card: '开场白里写的' };

export interface EmotionHowInput {
  /** 这句手改成的表情(找得到那一张的);没改是 null */
  manual: string | null;
  /**
   * 定这句表情的那个立绘标签:这条回复到这句为止最后一个(路人台词前的不算)—— 原词、写在第几句、认成了什么。
   * 这条回复到这句还没写过是 null
   */
  tag: { word: string; line: number; match: TagMatch } | null;
  /** 这句是这条回复的第几句(从 0 数) */
  line: number;
  by: TagBy;
  /** 没写标签时:从开局起表情就没变过(还是开局那张) */
  fromStart: boolean;
  /** 这句显示的表情;没有是 null */
  shown: string | null;
  /** 这张卡没配立绘:认不出时直接用原词 */
  rawOnFail: boolean;
  /** 形态换算过(这句的表情不在这句的形态里,换成了这个形态的默认图):换算前的表情、形态的名字;没换算是 null */
  mapped: { from: string | null; form: string } | null;
}

/** 认法(设计 1.4 的 match):名字对上 / 别名对上 / 认词记录 / 模型认的 / 还在认 / 认不出 */
function matchHow(word: string, m: TagMatch, rawOnFail: boolean): string {
  switch (m.state) {
    case 'exact':
      // 名字和别名都是不分大小写、去掉首尾空白比的(plugins/common.ts 的 resolveByLabel)
      return normTag(word).toLowerCase() === m.label.toLowerCase() ? '名字对上' : `是「${m.label}」的别名`;
    case 'record':
      return `认词记录认成「${m.label}」(${RECORD_SOURCE_NAME[m.source]})`;
    case 'model':
      return `模型认成「${m.label}」(相似度 ${m.score.toFixed(2)})`;
    case 'pending':
      return '模型还在认,先保持上一句';
    case 'failed':
      return rawOnFail ? `认不出(${m.reason}),没配立绘,直接用原词` : `认不出(${m.reason}),保持上一句`;
  }
}

/** 表情那一行下面的「怎么来的」 */
export function emotionHow(o: EmotionHowInput): string {
  const said = o.tag ? `${BY_NAME[o.by]}是「${o.tag.word}」` : null;
  // 手改的优先级最高,也不做形态换算(玩家明说的)
  if (o.manual !== null) return said ? `你手改的,只改这一句(${said})` : '你手改的,只改这一句';
  let text: string;
  if (o.tag && said) {
    const how = `${said},${matchHow(o.tag.word, o.tag.match, o.rawOnFail)}`;
    text = o.tag.line < o.line ? `沿用第 ${o.tag.line + 1} 句:${how}` : how;
  } else if (o.fromStart) {
    text = o.shown === null ? '还没写过表情' : '开局默认那张';
  } else {
    text = '这句没写表情,沿用上一句';
  }
  if (o.mapped) {
    const from = o.mapped.from === null ? '' : `「${o.mapped.from}」不在「${o.mapped.form}」这个形态里,`;
    text += `;${from}换算到这个形态的默认图`;
  }
  return text;
}

/** 这个词是认词记录或模型认的:检查器里能「以后都认成」别的(名字、别名对上的改不了,想改去改别名) */
export const recordable = (m: TagMatch): boolean => m.state === 'record' || m.state === 'model';

// ---- 手改的表情:「只改这一句」的下拉、语音那段的「生效的表情」 ----

type ManualPick = { item: string; label: string };

/**
 * 「只改这一句」那个下拉选中哪一项、占位那一项写什么(没有占位是 null)。
 * 手改记号先按 item(立绘 id / 内置表情名)对下拉里的项,对不上再按记下的名字对 —— 和 plugins/manualMarks.ts 的 manualLabel
 * 一个找法(下拉的项就是同一份立绘 / 内置表情)。对上了选它、不要占位;没改是「选一张…」;
 * 改的那张真找不到了(删了、停用了)才是「改的那张不在了」
 */
export function manualSelect(
  mark: ManualPick | undefined,
  choices: readonly ManualPick[],
): { value: string; placeholder: string | null } {
  if (!mark) return { value: '', placeholder: '选一张…' };
  const hit = choices.find((c) => c.item === mark.item) ?? choices.find((c) => c.label === mark.label);
  return hit ? { value: hit.item, placeholder: null } : { value: '', placeholder: '改的那张不在了' };
}

/**
 * 语音那段「生效的表情」:这句手改了(找得到那一张)就是手改的那张 —— 画面、语音请求、配对表挑哪一行都按它
 * (plugins/voice.ts 的 planVoiceLines);没改照旧是标签累计下来的,没有写「无」
 */
export function effectiveEmotion(manual: string | null, fromTags: string | null): { v: string; note?: string } {
  return manual !== null ? { v: manual, note: '你手改的' } : { v: fromTags ?? '无' };
}

// ---- 背景、CG、表情:这句换的还是沿用的 ----

export type Origin = { at: 'here' } | { at: 'line'; line: number } | { at: 'before' } | { at: 'initial' };

/**
 * 第 index 条第 line 句的某样东西(pick 取出来,按 === 比)是从哪来的:这句换的 / 这条回复第几句换的 /
 * 之前的回复里换的 / 从开局起就没变过。index 是 -1(还没有回复)时是开局;line 超出范围时按最后一句算
 */
export function originIn<T>(tl: Timeline, index: number, line: number, pick: (s: LineState | Fold) => T): Origin {
  if (index < 0) return { at: 'initial' };
  const e = tl.entries[index];
  const n = e.lines.length;
  const at = n === 0 ? 0 : Math.max(0, Math.min(line, n - 1));
  const cur = pick(n === 0 ? e.empty : e.lines[at]);
  // 这条回复里往回找:最近一次和这句不一样的下一句就是换的那句
  for (let k = at - 1; k >= 0; k--) {
    if (pick(e.lines[k]) !== cur) return k + 1 === at ? { at: 'here' } : { at: 'line', line: k + 1 };
  }
  if (pick(e.start) !== cur) return at === 0 ? { at: 'here' } : { at: 'line', line: 0 };
  // 之前的回复里变过(哪怕又变回来)就是沿用之前的,一次都没变过才是开局的
  if (pick(tl.initial) !== cur) return { at: 'before' };
  for (let j = 0; j < index; j++) {
    const p = tl.entries[j];
    if (pick(p.start) !== cur || pick(p.end) !== cur || p.lines.some((s) => pick(s) !== cur)) return { at: 'before' };
  }
  return { at: 'initial' };
}

export function originText(o: Origin): string {
  switch (o.at) {
    case 'here':
      return '这句换的';
    case 'line':
      return `沿用第 ${o.line + 1} 句`;
    case 'before':
      return '沿用之前的';
    case 'initial':
      return '开局默认';
  }
}

// ---- 说话人 ----

/**
 * 说话人那一行:谁说的。角色的台词前没写名字(切句按引号默认成她的)时注明;
 * 写没写看切句时记下的 line.named,长台词切成的后几句也算写了
 */
export function speakerText(line: VNLine, o: { charName: string; jev?: boolean }): string {
  if (line.player) return `${line.speaker}(玩家台词)`;
  if (line.untagged) return o.jev ? '(Jev 判成不是角色说的)' : '(没写立绘标签,不算角色的)';
  if (!line.speaker) return '旁白';
  if (line.speaker === o.charName && !line.named) return `${line.speaker}(台词前没写名字,默认是她)`;
  return line.speaker;
}

// ---- 语音:配对表 ----

type CellMeta = Pick<PairingCellOut, 'source' | 'guessed' | 'pending' | 'unstable'>;

/**
 * 一格的来源加小标:「旧结果 · 模型猜的 · 今天本来就不稳定」。
 * 叫法和小标都用插件页配对表那一份(plugins/pairingView.ts);这里只有主声音,按语音的叫法
 */
export function cellSourceText(c: CellMeta): string {
  return [pairingSourceName(c.source), ...cellFlags(c)].join(' · ');
}

/**
 * 主声音这一段是怎么挑的(设计 1.6.5):配对表配好的那一行,或者按名字挑。
 * records:表情认法是认词记录;sprite:这句显示的立绘(不是包里的表情是 null);row:表里配的那一行的名字(表里没有是 null);
 * cell:那一格的来源(还没读到是 undefined)
 */
export function voicePickText(o: { records: boolean; sprite: string | null; row: string | null; cell?: CellMeta }): string {
  if (!o.records || o.sprite === null) return '按名字挑';
  if (o.row === null) return `配对表里还没有「${o.sprite}」这张,先按名字挑`;
  return `配对表:${o.sprite} → ${o.row}${o.cell ? `(${cellSourceText(o.cell)})` : ''}`;
}
