/**
 * 全局拖放层(画布 Drop 那张):窗口任何地方拖进文件就盖上「松手就导入」;
 * 拖到落点(dropTarget.ts:卡片列表的卡、选角页的卡、卡编辑器左栏和某一栏)上时,四周压暗、那一块描边,
 * 旁边一颗「松手:给刻晴加素材」。
 *
 * - 只认带文件的拖动(types 里有 Files):立绘差分、CG 构图的拖动排序是文字拖动,不管。
 * - 事件挂在窗口上;遮罩不接指针,拖动事件照样落在底下的元素上,从那里往上找最近的落点。
 * - 进进出出子元素会成对地来 dragenter / dragleave,用计数判断真的拖出了窗口,遮罩不会一闪一闪;
 *   拖出窗口时偶尔收不到最后那个 dragleave,1.5 秒没有 dragover 就当拖走了。
 * - blocked(上一批还在导入)时照样接住(不然浏览器会把文件当网页打开),松手只提示一句。
 * - 手机上没有拖放,这一层不出现;导入走各处的「导入」按钮。
 * - 游戏开着时是纸(GameFrame;落点上的小签是墨底白字的小方签,不用角色色、不是胶囊),调试台里照旧深色。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inGame } from '../components/export/inGame';
import { Icon } from '../studio/icons';
import { popThemeClass } from '../vn/ui/logic';
import { currentPaperTheme } from '../vn/vnSettings';
import { collectDrop, type DroppedFile } from './collectDrop';
import { DROP_SELECTOR, dropLabel, readDropTarget, type ImportTarget } from './dropTarget';
import './importer.css';

interface Props {
  /** 现在不能导入的原因(上一批还在导入);null = 能 */
  blocked: string | null;
  onDrop: (files: DroppedFile[], target: ImportTarget) => void;
  /** blocked 时松手 */
  onRefuse: (reason: string) => void;
}

interface Hot {
  el: Element;
  target: ImportTarget;
  rect: { left: number; top: number; width: number; height: number };
}

/** 落点四周留的空;描边离窗口边至少这么远 */
const PAD = 4;
const EDGE = 2;
const TAG_H = 36;
const TAG_GAP = 10;
/** 多久没有 dragover 就当拖走了 */
const IDLE_MS = 1500;

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** 屏幕上看得见(没被别的东西盖住)的落点有哪几种:决定遮罩底下那句提示 */
function visibleTargets(): { cards: boolean; slots: boolean } {
  const out = { cards: false, slots: false };
  const all = Array.from(document.querySelectorAll(DROP_SELECTOR)).slice(0, 80);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= window.innerHeight) continue;
    const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + Math.min(r.height / 2, 24)));
    // 被视觉小说、卡编辑器盖住的不算
    if (!el.contains(document.elementFromPoint(x, y))) continue;
    if (el.hasAttribute('data-drop-kind')) out.slots = true;
    else out.cards = true;
  }
  return out;
}

function sameRect(a: Hot['rect'], b: Hot['rect']) {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

export function DropLayer({ blocked, onDrop, onRefuse }: Props) {
  const [active, setActive] = useState(false);
  const [hot, setHot] = useState<Hot | null>(null);
  const [hints, setHints] = useState({ cards: false, slots: false });
  const latest = useRef({ blocked, onDrop, onRefuse });
  useEffect(() => {
    latest.current = { blocked, onDrop, onRefuse };
  });

  useEffect(() => {
    let depth = 0;
    let idle = 0;
    const reset = () => {
      depth = 0;
      window.clearTimeout(idle);
      setActive(false);
      setHot(null);
    };
    const keepAlive = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(reset, IDLE_MS);
    };
    const track = (e: DragEvent) => {
      const el = e.target instanceof Element ? e.target.closest(DROP_SELECTOR) : null;
      if (!el) {
        setHot(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
      setHot((prev) => (prev && prev.el === el && sameRect(prev.rect, rect) ? prev : { el, target: readDropTarget(el), rect }));
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      if (depth === 1) {
        setActive(true);
        setHints(visibleTargets());
      }
      track(e);
      keepAlive();
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // 不拦下来,浏览器松手时会把文件当网页打开
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setActive(true);
      track(e);
      keepAlive();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth -= 1;
      if (depth <= 0) reset();
    };
    const onDropEvent = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const el = e.target instanceof Element ? e.target.closest(DROP_SELECTOR) : null;
      const target = readDropTarget(el);
      reset();
      const { blocked: reason, onDrop: take, onRefuse: refuse } = latest.current;
      if (reason) {
        refuse(reason);
        return;
      }
      // collectDrop 在这一下同步拿 entry(事件处理完 items 就作废了),之后慢慢读文件夹
      if (e.dataTransfer) void collectDrop(e.dataTransfer).then((files) => take(files, target));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDropEvent);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDropEvent);
      window.clearTimeout(idle);
    };
  }, []);

  if (!active) return null;
  const game = inGame();
  return createPortal(
    <div className={`imp-drop${hot ? ' hot' : ''}${blocked ? ' blocked' : ''}${game ? ' ingame' : ''}`} aria-hidden="true">
      {hot ? (
        <Spot hot={hot} label={blocked ?? dropLabel(hot.target)} />
      ) : game ? (
        <GameFrame blocked={blocked} />
      ) : (
        <Frame blocked={blocked} hints={hints} />
      )}
    </div>,
    document.body,
  );
}

/**
 * 游戏里(设计稿 kit/transfer.js 的 drop,10-23 用户「拖进来直接导」):选角色开着时左边纸面板的格子区变成接收区 ——
 * 盖住格子的虚线框「松手就导入」(格子淡到四成,场景和她压暗一点);别的画面上是正中一张纸卡。不写说明。
 */
function GameFrame({ blocked }: { blocked: string | null }) {
  const side = document.querySelector('.vn-pick:not(.portrait) .pk-side');
  const r = side?.getBoundingClientRect();
  const title = blocked ? '上一批还在导入' : '松手就导入';
  const zone = r && r.width > 0 ? { left: r.left + 16, top: r.top + 12, width: r.width - 32, height: r.height - 28 } : null;
  // 压暗的是场景和她;左边那块纸面板不压(接收区就在上面)
  const p = zone ? side?.closest('.pk-panel')?.getBoundingClientRect() : null;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const hole = p ? { clipPath: `path(evenodd, 'M0 0H${W}V${H}H0Z M${p.left} ${p.top}h${p.width}v${p.height}h${-p.width}Z')` } : undefined;
  return (
    <div className="imp-gdrop">
      <div className="imp-gdrop-dim" style={hole} />
      <div className={`imp-gdrop-zone ${popThemeClass(currentPaperTheme(), true)}${zone ? '' : ' card'}`} style={zone ?? undefined}>
        <Icon name="upload" size={30} />
        <b>{title}</b>
      </div>
    </div>
  );
}

function Frame({ blocked, hints }: { blocked: string | null; hints: { cards: boolean; slots: boolean } }) {
  const hint = hints.slots
    ? '拖到某一栏 = 都按那一栏的类型导入;拖到左栏 = 给这张卡加素材'
    : hints.cards
      ? '拖到某张卡上 = 直接给她加素材'
      : null;
  return (
    <div className="imp-drop-frame">
      <div className="imp-drop-card">
        <span className="imp-drop-icon">
          <Icon name="upload" size={24} />
        </span>
        <div className="imp-drop-title">{blocked ? '上一批还在导入' : '松手就导入'}</div>
        <div className="imp-drop-sub">
          {blocked ?? '新的角色卡(PNG、JSON)、一包立绘、背景、曲子、CG 文件夹,混在一起拖进来也行。'}
        </div>
        {!blocked && hint && <div className="imp-drop-hint">{hint}</div>}
      </div>
    </div>
  );
}

function Spot({ hot, label }: { hot: Hot; label: string }) {
  const { left, top, width, height } = hot.rect;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  // 四周留一点空,但描边不出窗口(卡编辑器的主区贴着窗口右边和底边)
  const x0 = Math.max(EDGE, left - PAD);
  const y0 = Math.max(EDGE, top - PAD);
  const x1 = Math.min(vw - EDGE, left + width + PAD);
  const y1 = Math.min(vh - EDGE, top + height + PAD);
  const spot = { left: x0, top: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  // 标签放在落点下面;下面放不下放上面;都放不下(落点占满一整栏)就放在落点里的底部
  const below = spot.top + spot.height + TAG_GAP;
  const above = spot.top - TAG_GAP - TAG_H;
  const tagTop = below + TAG_H <= vh - 8 ? below : above >= 8 ? above : spot.top + spot.height - TAG_H - 12;
  // 横向对着落点中间,量出宽度以后夹在窗口里
  const tag = useRef<HTMLDivElement | null>(null);
  const [tagW, setTagW] = useState(0);
  useLayoutEffect(() => {
    setTagW(tag.current?.offsetWidth ?? 0);
  }, [label]);
  const tagLeft = Math.max(8, Math.min(vw - tagW - 8, spot.left + spot.width / 2 - tagW / 2));
  return (
    <>
      <div className="imp-drop-spot" style={spot} />
      <div
        ref={tag}
        className="imp-drop-tag"
        style={{ top: tagTop, left: tagLeft, maxWidth: vw - 16, visibility: tagW ? undefined : 'hidden' }}
      >
        <Icon name="upload" size={16} />
        {label}
      </div>
    </>
  );
}
