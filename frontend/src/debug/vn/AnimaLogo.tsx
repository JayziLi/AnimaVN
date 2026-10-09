/**
 * AnimaVN 的 logo：仰头伸手够星星的少女 + 新月。源文件和做法在桌面「logo设计」。
 * mark  = 白 + 浅灰、透明底，放在深色背景上（loading、菜单、登录页）
 * badge = 深色圆角底的整枚图标（和 favicon 同一个文件），放在浅色背景上也看得见
 * 动画和羽毛共用 breathe / drift 两个类名。思考中、生成中那种十几像素的小图标还是用羽毛：logo 缩到那么小就糊了
 */
export function AnimaLogo({
  className = '',
  size = 28,
  variant = 'mark',
}: {
  className?: string;
  size?: number;
  variant?: 'mark' | 'badge';
}) {
  return (
    <img
      className={`vn-logo ${variant} ${className}`}
      src={variant === 'badge' ? '/favicon.svg?v=72' : '/anima-logo.svg?v=72'}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
