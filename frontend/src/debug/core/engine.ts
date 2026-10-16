/**
 * 「表情认法」开关(素材架构第 1 期,设计稿 9「开关的规矩」):只在这一处。legacy = 今天的认法(名字和别名 → 本地模型,
 * 结果只记在这个页面里);records = 认词记录(名字和别名 → 认词记录 → 本地模型按固定算法认一次并记下来,第 1b 期起)。
 * 存在后端设置 core.timeline,手机和电脑读到同一份。舞台、语音、历史、存档、Jev 的起始表情都吃同一个时间线,一起切换。
 * 第 1 期结束后两期删掉旧算法和这个开关
 */
export type TimelineEngine = 'legacy' | 'records';

export const TIMELINE_SETTING_KEY = 'core.timeline';

export interface TimelineConfig {
  engine: TimelineEngine;
}

export function normalizeTimelineConfig(raw: unknown): TimelineConfig {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { engine: r.engine === 'records' ? 'records' : 'legacy' };
}
