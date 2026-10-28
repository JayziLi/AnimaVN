/**
 * 插件页左栏的线条图标(设计稿 docs/design/unify/kit/icons.js 里插件页那 13 个:24×24、1.5 线宽、圆头、跟字色)。
 * 只有游戏皮的左栏用;名字对不上的页(以后新卡带)不画图标。
 */

const PATHS: Record<string, string> = {
  sprite:
    '<rect x="5.5" y="3.5" width="13" height="17" rx="2"/><circle cx="12" cy="9.5" r="2.6"/><path d="M7.8 20.5c.5-3.4 2.1-5.3 4.2-5.3s3.7 1.9 4.2 5.3"/>',
  voice: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18 6.7a7.5 7.5 0 0 1 0 10.6"/>',
  bg: '<path d="M3.5 18.5h17"/><path d="M5 18.5l5-7.5 3.6 5.2 2.2-2.7 3.7 5"/><circle cx="16.8" cy="7.2" r="1.8"/>',
  bgm: '<path d="M9.5 17V5.5l9-1.8V15"/><circle cx="7" cy="17" r="2.5"/><circle cx="16" cy="15" r="2.5"/>',
  cg: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M12 8.5c.4 2.1 1.4 3.1 3.5 3.5-2.1.4-3.1 1.4-3.5 3.5-.4-2.1-1.4-3.1-3.5-3.5 2.1-.4 3.1-1.4 3.5-3.5z"/>',
  lang: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.4 5.2 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.2-3.4-8.5s1-6.1 3.4-8.5z"/>',
  imagegen:
    '<path d="M20 4c-3.3 1.4-7 4.9-9.2 7.8l1.4 1.4C15.1 11 18.6 7.3 20 4z"/><path d="M10.3 12.6c-2.2 0-3.9 1.6-4 3.8-.1 1.4-.8 2.5-2.3 3.1 1.3.8 3 1 4.6.6 2.4-.6 3.8-2.7 3.4-5.3z"/>',
  jev: '<path d="M3.5 11.6V5a1.5 1.5 0 0 1 1.5-1.5h6.6l8.6 8.5-8.2 8.2z"/><circle cx="8" cy="8" r="1.4"/>',
  tts: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h5.5M11 16.5h5.5"/>',
  autofill:
    '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M16.5 13.5v6M13.5 16.5h6"/>',
  engine:
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.2 15.2l5 5"/><path d="M8.2 11.6c1.2 1.3 3.4 1.3 4.6 0"/><path d="M8.6 8.6h.01M12.4 8.6h.01"/>',
  sfx: '<path d="M4 12h1.5M7.5 9v6M10.5 5.5v13M13.5 8.5v7M16.5 10v4M19.5 11.2v1.6"/>',
  tone: '<path d="M5.5 19v-3M10 19v-6.5M14.5 19v-10M19 19V5.5"/>',
};

export function NavIcon({ id, size = 18 }: { id: string; size?: number }) {
  const d = PATHS[id];
  if (!d) return <span className="dw-ic-blank" style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <svg
      className="dw-ic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}
