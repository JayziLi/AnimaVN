/**
 * 局内菜单上写对话的地方:面板左上那行小字(设计稿「星绘 · 夜路 · 10-18」= 角色 · 现在的场景 · 日子)、存档格上的名字。
 * 对话的默认名是后端照酒馆起的「卡名 - 2026-10-27@16h44m21s425ms」(分支再挂「 - Branch #N」),原样印出来就是一串存档号;
 * 这里认出默认名,拆成 卡名 / 日子(月-日)/ 第几个分支。玩家自己改过的名字原样用。
 */

export interface ChatNameParts {
  /** 「 - 时间戳」前面那段(一般是卡名) */
  base: string;
  /** 月-日,比如 10-27 */
  date: string;
  /** 分支号;不是分支是 null */
  branch: number | null;
}

const AUTO_NAME = /^(.*?) - \d{4}-(\d{2})-(\d{2})@\d{1,2}h\d{1,2}m\d{1,2}s\d{1,3}ms(?: - Branch #(\d+))?$/;

/** 认默认名;玩家改过的名字返回 null */
export function parseChatName(name: string): ChatNameParts | null {
  const m = AUTO_NAME.exec(name.trim());
  if (!m) return null;
  return { base: m[1], date: `${m[2]}-${m[3]}`, branch: m[4] ? Number(m[4]) : null };
}

/** 存档格上的名字:默认名写成卡名(分支带「分支 N」),改过的原样 */
export function chatLabel(name: string, charName: string): string {
  const p = parseChatName(name);
  if (!p) return name.trim();
  const base = p.base || charName;
  return p.branch ? `${base} · 分支 ${p.branch}` : base;
}

/** 面板左上那行小字:角色 · 场景 · 日子(对话改过名就把名字放在场景后面);last = 从封面打开,写「上次 夜路」 */
export function menuCrumb(charName: string, chatName: string, scene?: string | null, last = false): string {
  const parts: string[] = [charName || '还没选角色'];
  if (scene) parts.push(last ? `上次 ${scene}` : scene);
  const p = parseChatName(chatName);
  if (p) {
    if (p.base && p.base !== charName) parts.push(p.base);
    if (p.branch) parts.push(`分支 ${p.branch}`);
    parts.push(p.date);
  } else if (chatName.trim() && chatName.trim() !== charName) {
    parts.push(chatName.trim());
  }
  return parts.join(' · ');
}

/** 别处(相册的组头、「画在哪个存档」)写存档名:默认名写成「卡名 · 10-27」(分支带「分支 N」),改过的原样 */
export function saveTitle(name: string): string {
  const p = parseChatName(name);
  if (!p) return name.trim();
  return [p.base, p.branch ? `分支 ${p.branch}` : '', p.date].filter(Boolean).join(' · ');
}
