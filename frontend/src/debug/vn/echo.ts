/** 玩家发的话在画面上怎么露出来:回看时弹成选项、发出去那一刻浮一下(第 5 段)。 */

/**
 * 当时玩家发的话弹成选项时的样子:「——」开头的行是写给模型的提示(——场景切换为逛街),
 * 不放进去;整行是一句带引号的台词就去掉引号;空行收掉。剩下是空的就不弹
 */
export const playerSaid = (raw: string) =>
  raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('——'))
    .map((l) => (/^[「『“”"].*[」』“”"]$/.test(l) ? l.slice(1, -1) : l))
    .join('\n');

/** 发出去那句浮多久:字少 1.8s,每多一个字多 60ms,最多 3.2s(设计稿 kit/scene.js 的 showEcho) */
export const echoHoldMs = (text: string) => Math.min(3200, Math.max(1800, 1200 + [...text].length * 60));
