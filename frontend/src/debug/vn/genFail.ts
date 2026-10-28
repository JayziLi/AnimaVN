/**
 * 模型报错纸卡(ModelError.tsx)用的纯逻辑:从报错原文挑一个短标题、该突出哪个按钮、原文只留第一行。
 * 报错原文是后端 / 浏览器给的什么就是什么,这里不改写;只是挑标题。
 */

/** 生成失败时 DebugApp 交给游戏的东西 */
export interface GenFail {
  /** 报错原文(模型服务的英文原话,原样给) */
  message: string;
  /** 当前连接的名字 */
  connection: string;
  /** 当前模型 */
  model: string;
  /** 这条连接拉到过的模型 */
  models: string[];
  /** 重试:把你说的那句再发一遍 */
  onRetry: () => void;
  /** 换模型:改当前连接的模型,马上重新生成 */
  onPickModel: (model: string) => void;
}

/**
 * 短标题。按状态码和关键词挑,挑不出来是「没拿到回复」。
 * 后端的报错现在是英文原话(「429 Too Many Requests: …」「Cannot connect to …」),所以认英文;
 * 中文关键词留着:旧后端、公网版的审核掐断还是中文。
 */
export function errorTitle(message: string): string {
  const m = message;
  // 公网版审核掐断(整条撤掉)
  if (/anima检测到/.test(m)) return '这条回复被撤回了';
  // 连接本身没设好(没配 key / 没填模型名 / 没有启用的连接 / 连接找不到):排在 404 前,别被 "not found" 抢走
  if (
    /no active connection|connection not found|has no (api key|model name)|还没有(配置|填写)|没有启用的 ?API|连接不存在/i.test(
      m,
    )
  )
    return '连接还没设好';
  // 原文以「Cannot connect」开头 = 根本没连上(后面跟的 403 之类是代理 / 网关回的),别被状态码抢走
  if (/^\s*cannot connect/i.test(m)) return '连不上模型';
  // 429 的原文里可能带 billing / balance,所以先认状态码;但 OpenAI 用 429 报「额度用完」,那是余额
  if (/exceeded your current quota|insufficient_quota/i.test(m)) return '余额不足';
  if (/\b429\b|rate.?limit|too many requests|限流/i.test(m)) return '请求太频繁';
  if (/\b401\b|invalid.*key|incorrect api key|unauthorized|密钥无效/i.test(m)) return '密钥不对';
  if (/\b402\b|insufficient|balance|payment required|余额不足/i.test(m)) return '余额不足';
  if (/\b403\b|forbidden|permission|没有权限/i.test(m)) return '没有权限';
  if (/\b404\b|not.?found|does not exist|不存在/i.test(m)) return '找不到这个模型';
  // 「Cannot connect」排在超时前:连不上的原因里偶尔也带 timed out
  if (/cannot connect|无法连接|failed to fetch|network|ECONN|fetch failed|ERR_/i.test(m)) return '连不上模型';
  if (/timed? ?out|timeout|超时/i.test(m)) return '模型没有响应';
  if (/\b5\d\d\b|empty response|interrupted|ended unexpectedly|空响应|中断/i.test(m))
    return '模型那边出错了';
  return '没拿到回复';
}

/** 该突出哪个按钮:密钥 / 余额 / 找不到模型这类重试也没用,先换模型;其余先重试 */
export function errorMain(message: string): 'retry' | 'model' {
  const t = errorTitle(message);
  return t === '密钥不对' || t === '余额不足' || t === '找不到这个模型' || t === '没有权限' ? 'model' : 'retry';
}

/** 纸卡上只放一行原文;完整的在「看详细」里 */
export function firstLine(message: string): string {
  return message.split('\n').find((l) => l.trim())?.trim() ?? message.trim();
}

/** 你说的那句:去掉写给模型的「——」提示行,空行收掉(和翻历史时弹成选项的那套一样) */
export function userSaid(raw: string): string {
  const out = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('——'))
    .map((l) => (/^[「『“”"].*[」』“”"]$/.test(l) ? l.slice(1, -1) : l))
    .join('\n');
  return out || raw.trim();
}

/** 对话区要不要停在你说的那句:生成失败了、而且最后一条还是你说的(没有回复可以翻) */
export const holdsUserLine = (failed: boolean, lastRole: string | undefined): boolean => failed && lastRole === 'user';
