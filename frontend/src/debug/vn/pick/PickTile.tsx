/**
 * 选角色的角色格:星语式卡面(10-23 用户定的,设计稿 pages/cardface.js 的 oratio):
 * 整张铺满、右上一个大圆角;卡外一圈错开的细线框(比卡大一点、往左上挪,线头在角上伸出去),
 * 名字左上、AnimaVN 小标右下,小四角星只给选中 / 指到的那张。
 * 选中是白色,不跟角色变(白天纸上纯白看不见,所以外面托一道墨线,样子在 vnPick.css)。
 * 不写作品名、不挂标签小签。
 */

import { spriteThumbUrl } from '../../lib/api';
import { dropTarget } from '../../importer/dropTarget';
import { FALLBACK_BACKGROUND } from '../fallbacks';
import type { PickDetail } from '../pickDetail';
import { titleSpriteStyle, type TitlePose } from '../titleArt';
import type { TitleCard } from '../VNTitle';

/** 脸一样大、头在同一高度,左上角要写名字所以脸往下放一点(设计稿 oratio 的 POSE) */
const TILE_POSE: TitlePose = { faceSize: 0.21, faceTop: 0.2, cx: 0.5 };
/** 格子高度(设计稿 px):限制放大倍数时要知道舞台多高 */
const TILE_H = 236;

const STAR_PATH = 'M137 17C137.5 22 138.5 23 143 23.5 138.5 24 137.5 25 137 30 136.5 25 135.5 24 131 23.5 135.5 23 136.5 22 137 17Z';

export function PickTile({
  card,
  detail,
  selected,
  current,
  fresh = false,
  onPick,
  onOpen,
}: {
  card: TitleCard;
  detail: PickDetail | undefined;
  selected: boolean;
  current: boolean;
  /** 刚导进来的:左下一个「刚导入」小签(墨色底白字,不跟角色变) */
  fresh?: boolean;
  onPick: () => void;
  onOpen: () => void;
}) {
  const sprite = detail?.sprite ?? null;
  const src = sprite ? spriteThumbUrl(sprite, 200) : null;
  const style = sprite && src ? titleSpriteStyle(detail?.face ?? null, sprite.face_scan?.height ?? null, TILE_POSE, TILE_H) : null;
  return (
    <button
      type="button"
      className={`pk-tile${selected ? ' on' : ''}${current ? ' cur' : ''}`}
      // 拖文件到这张卡上 = 给她加素材(先问一句)
      {...dropTarget(card.id, card.name)}
      onClick={onPick}
      onDoubleClick={onOpen}
      title={`${card.name}(双击直接进入)`}
      aria-pressed={selected}
    >
      <svg className="ofr" viewBox="-14 -14 160 264" aria-hidden="true">
        <path d="M-10 -6H130M-10 242H130M-6 -10V246M126 -10V246" />
        <path className="ost" d={STAR_PATH} />
      </svg>
      <span className="cl">
        <span className="art">
          {src && style ? (
            <>
              <img className="bg" src={detail?.bg ?? FALLBACK_BACKGROUND} alt="" draggable={false} loading="lazy" />
              <img className="sp" src={src} style={style} alt="" draggable={false} loading="lazy" />
            </>
          ) : card.avatar ? (
            <>
              <img className="bed" src={card.avatar} alt="" draggable={false} />
              <img className="av" src={card.avatar} alt="" draggable={false} />
            </>
          ) : (
            <>
              <img className="bg" src="/vn/ui/sky-pick.svg" alt="" draggable={false} />
              <img className="logo" src="/anima-logo.svg" alt="" draggable={false} />
            </>
          )}
        </span>
        <span className="cap">
          <b>{card.name}</b>
          <i className="ul" />
        </span>
        <img className="mk" src="/anima-logo.svg" alt="" draggable={false} />
      </span>
      {fresh && <em className="pk-new">刚导入</em>}
    </button>
  );
}
