import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { sceneToneOf } from '../titleArt';
import { glassVars, type SceneTone } from './glass';

/**
 * 主题「玻璃」要的 --gl-* 变量,按这一幕的背景图算(写到 .vn-root 的 style 上)。
 * 不是玻璃主题、或没背景时不读图,返回 undefined;换了背景图才重算。
 */
export function useSceneGlass(on: boolean, bgSrc: string | null): CSSProperties | undefined {
  const [got, setGot] = useState<{ src: string; tone: SceneTone | null } | null>(null);
  useEffect(() => {
    if (!on || !bgSrc) return;
    let alive = true;
    void sceneToneOf(bgSrc).then((t) => {
      if (alive) setGot({ src: bgSrc, tone: t });
    });
    return () => {
      alive = false;
    };
  }, [on, bgSrc]);
  // 换背景时先留着上一幕的颜色,新的读到再换,卡片不闪
  const tone = got?.tone ?? null;
  return useMemo(() => (on ? (glassVars(tone) as CSSProperties) : undefined), [on, tone]);
}
