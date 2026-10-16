/**
 * 测试环境的小牌子(红底白字):构建时设了 VITE_ENV_LABEL(比如「测试版 · 库副本」)才有,
 * 正式环境不设就什么都不画。调试台顶栏左上角、卡编辑器顶栏、视觉小说左上角各一个 ——
 * 用户在测试页当正式版玩过半天,得一眼看出来这不是正式版。
 */

const LABEL = (import.meta.env.VITE_ENV_LABEL ?? '').trim();

/** floating = 固定在窗口左上角(视觉小说里用,盖在游戏画面上、不挡点击) */
export function EnvBadge({ floating }: { floating?: boolean }) {
  if (!LABEL) return null;
  return (
    <span className={`env-badge${floating ? ' floating' : ''}`} title="这是测试环境,不是正式版">
      {LABEL}
    </span>
  );
}
