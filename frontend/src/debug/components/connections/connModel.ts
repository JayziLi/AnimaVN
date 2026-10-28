/**
 * 局内菜单「模型」页(三栏)用的小函数:连接行的缩写和副标题、Jev 的一行状态、测试结果的文字。
 * 纯函数,不碰 React;ConnectionsGame.tsx 和测试都从这里拿。
 */

import type { ApiType, JevKeyStatus, ThinkingLevel } from '../../lib/api';

/** 连接表单里的字段(ConnectionsDrawer 和三栏版共用) */
export interface ConnFormState {
  name: string;
  api_type: ApiType;
  base_url: string;
  api_key: string;
  model: string;
  stream: boolean;
  thinking: ThinkingLevel | null;
}

export type ConnBusy = 'save' | 'delete' | 'refresh' | 'ping' | 'test' | null;

/** 连接行左边那格的字:名字去掉括号后的前两个字,拉丁字母大写(和左上「模型」小窗口同一个算法) */
export const connIcon = (name: string) => name.replace(/[（(].*$/, '').trim().slice(0, 2).toUpperCase() || '?';

const TYPE_NAME: Record<string, string> = {
  openai_compatible: 'OpenAI 兼容',
  anthropic: 'Anthropic',
  mock: 'Mock',
};

/** 连接行第二行:类型 · 模型名 */
export function connSub(c: { api_type: string; model: string }): string {
  return `${TYPE_NAME[c.api_type] ?? c.api_type} · ${c.model || '未设模型'}`;
}

/** 思考的五档(设计稿模型页是一个下拉,每档带一句它是什么);长说明在「?」里 */
export const THINK_OPTIONS: { value: ThinkingLevel | ''; name: string }[] = [
  { value: '', name: '默认(不传,跟服务走)' },
  { value: 'off', name: '关 —— 不思考,直接写正文' },
  { value: 'low', name: '低 —— 想得短' },
  { value: 'high', name: '高' },
  { value: 'max', name: '最大 —— 想得最多,也最慢' },
];

/** 字段下面那行淡字 */
export const NOTES = {
  think: '想得越少,正文出得越快,剧情和格式可能粗糙一点。',
  sameData: '与左上「模型」小窗口同一份数据,改动互通',
} as const;

export const TIPS = {
  think:
    '默认 = 不传,跟服务走。关 = 不思考,直接写正文。想得越少,正文出得越快,剧情和格式可能粗糙一点。DeepSeek、Kimi 都认;GLM-5.3 关不掉思考,只能选低 / 高 / 最大;中转站多半不认,报错就改回默认。',
  stream: '边生成边显示,思维链单独渲染。有些中转站不吃 stream=true,报错就关掉它。',
  key: '密钥已保存在后端,不会回传明文;留空则继续使用。',
  jev: 'Jev 是给立绘、背景、BGM、CG 标标签的判断模型,key 和地址在插件页「Jev 标注」里填。标的结果另存,不改模型原文。',
  test: '「连接」只测通不通;「发送测试消息」会真发一句,看模型回什么。',
  models: '从这条连接拉到的模型里选,选中就存进连接。',
  sameData: '和游戏左上的「模型」小窗口、调试台的连接抽屉是同一份数据,在哪边改都一样。',
} as const;

export const BASE_URL_HINTS: Record<ApiType, string> = {
  openai_compatible: 'https://api.openai.com/v1 · OpenRouter / Ollama 等兼容地址',
  anthropic: '留空使用官方 API',
  mock: '无需填写',
};

/** Jev 一行的状态:点 + 字。status 为 null = 还在问后端 */
export function jevLine(status: JevKeyStatus | null): { tone: 'ok' | 'missing' | 'wait'; text: string } {
  if (status === null) return { tone: 'wait', text: '正在问后端…' };
  if (!status.has_key) return { tone: 'missing', text: '还没填 key' };
  const relay = status.url_source && status.url_source !== 'default';
  return { tone: 'ok', text: relay ? '已填 key · 走中转' : '已填 key' };
}

/** 右栏测试结果。error 的 text 是后端原文(英文照旧,不翻) */
export type TestResult =
  | { kind: 'busy'; what: 'ping' | 'test' }
  | { kind: 'ok'; what: 'ping' | 'test'; text: string; ms: number }
  | { kind: 'error'; what: 'ping' | 'test'; text: string; ms: number };

/** 用时:不到 10 秒留一位小数 */
export function elapsed(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return s < 10 ? `${s.toFixed(1)} 秒` : `${Math.round(s)} 秒`;
}
