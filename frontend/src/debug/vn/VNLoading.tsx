/**
 * 素材等待页:进游戏、换角色、换立绘包时,图还没到齐就先盖着它(什么时候露、等多久见 assetGate.ts)。
 *
 * 10-04 定稿样式(画布 Menu-Loading):夜空(上次那张背景下好了就淡淡叠上去),左边站着她,
 * 左上 logo;右边「接下来 · 地点」、她最后一句、一道带星星的进度线、逐项的准备清单、一条小贴士。
 * 立绘本身也在等的东西里:下好了才淡入,没好之前先只有夜空。不放大字和装饰数字(用户的审美偏好)。
 */

import { useState, type CSSProperties } from 'react';
import type { GateProgress } from './assetGate';
import { useSettledView } from './assetGate';
import './vnLoading.css';

interface Props {
  charName: string;
  /** 按脸裁的小头像;没有立绘时站在左边的是它(读不到换卡面头像,再没有就写名字的第一个字) */
  faceSrc: string | null;
  /** 卡面头像:不预先拉,小头像读不到时 onFaceMissing 要了才有 */
  avatar: string | null;
  onFaceMissing: () => void;
  /** 已经下好的背景,淡淡叠在夜空上;还没下好是 null */
  backdrop: string | null;
  /** 默认表情的立绘(地址 + 按脸摆好的行内样式);没有立绘是 null */
  sprite?: { src: string; style: CSSProperties } | null;
  /** 接下来的地点(上次停下的那张背景的名字) */
  place?: string;
  /** 她最后说的一句 */
  line?: string | null;
  progress: GateProgress[];
  fraction: number;
  slow: boolean;
  onSkip: () => void;
}

const TIPS = [
  '对话框最下面随时可以打字插话,不用等她说完。',
  '她说完了,画面正中会弹出输入条 —— 轮到你了。',
  '菜单「角色」里能给她换立绘包、声音和场景包,换了马上生效。',
  '设置 → 外观 可以换封面、对话框皮肤和对话框文字的字体。',
  '在封面上点一下她,她会有反应。',
  '读档页把鼠标移到存档上,能看到那一刻的场景和她的表情。',
];

const STAR = 'M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z';
const Star = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="-10 -10 20 20" aria-hidden="true">
    <path d={STAR} />
  </svg>
);
const Check = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="ok">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/** 夜空上几颗闪的星:位置照画板 */
const TWINKLES: [number, number, number][] = [
  [12.2, 15.8, 14],
  [41.9, 35.3, 12],
  [1.9, 36.5, 12],
  [9.4, 46.9, 11],
  [55.4, 28.6, 10],
  [49.6, 95, 12],
];

export function VNLoading({
  charName,
  faceSrc,
  avatar,
  onFaceMissing,
  backdrop,
  sprite = null,
  place,
  line,
  progress,
  fraction,
  slow,
  onSkip,
}: Props) {
  const [stage, setStage] = useState<'face' | 'avatar' | 'none'>(faceSrc ? 'face' : 'avatar');
  const src = stage === 'face' ? faceSrc : stage === 'avatar' ? avatar : null;
  const fail = () => {
    if (stage === 'face') {
      setStage('avatar');
      onFaceMissing();
    } else {
      setStage('none');
    }
  };
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  // 立绘整张下好了才露出来,半截的不显示
  const shown = useSettledView({ key: sprite?.src ?? '', src: sprite?.src ?? '', style: sprite?.style ?? {} });
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const pending = progress.find((g) => g.done < g.total);

  return (
    <div className="vn-gate vn-ld" role="status" aria-live="polite" aria-label={`正在准备${charName}的素材`}>
      <img className="vn-ld-sky" src="/vn/ui/sky-pick.svg" alt="" draggable={false} />
      {backdrop && <img className="vn-ld-bg" src={backdrop} alt="" draggable={false} />}
      <div className="vn-ld-shade" />
      {TWINKLES.map(([x, y, s], i) => (
        <span
          key={i}
          className="vn-ld-twinkle"
          style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, animationDelay: `${i * 0.7}s` }}
        >
          <Star />
        </span>
      ))}

      <div className="vn-ld-stage">
        {shown.src ? (
          <img className="vn-ld-spr" src={shown.src} style={shown.style} alt={charName} draggable={false} />
        ) : !sprite ? (
          <div className="vn-ld-face">
            {src ? (
              <img src={src} alt="" draggable={false} onError={fail} />
            ) : (
              <span>{charName.slice(0, 1) || '?'}</span>
            )}
          </div>
        ) : null}
      </div>

      <div className="vn-ld-lockup">
        <img className="mark" src="/anima-logo.svg" alt="" draggable={false} />
        <img className="word" src="/vn/ui/wordmark.png" alt="AnimaVN" draggable={false} />
      </div>

      <div className="vn-ld-info">
        <div className="vn-ld-next">
          <Star />
          接下来
        </div>
        <div className="vn-ld-place">{place || charName}</div>
        {line && <p className="vn-ld-line">「{line}」</p>}

        <div className="vn-ld-bar" aria-label={`${pct}%`}>
          <i style={{ width: `${pct}%` }} />
          <svg className="vn-ld-bar-star" style={{ left: `${pct}%` }} viewBox="-10 -10 20 20" aria-hidden="true">
            <path d={STAR} />
          </svg>
        </div>

        <ul className="vn-ld-list">
          {progress.map((g) => {
            const done = g.done >= g.total;
            return (
              <li key={g.kind} className={done ? 'done' : g === pending ? 'now' : ''}>
                {done ? <Check /> : <Star className="star" />}
                {g.kind}
                <span className="n">
                  {g.done}/{g.total}
                </span>
              </li>
            );
          })}
          {progress.length === 0 && (
            <li className="now">
              <Star className="star" />
              正在准备 · {charName}
            </li>
          )}
        </ul>

        {slow ? (
          <button type="button" className="vn-ld-skip" onClick={onSkip}>
            网络有点慢 · 先进去,剩下的边玩边下
          </button>
        ) : (
          <div className="vn-ld-tip">
            <b>小贴士</b>
            {tip}
          </div>
        )}
      </div>
    </div>
  );
}
