/**
 * 选角色(10-04 定稿,画布「选角色」页 Pick-E3 / Pick-E4)。封面菜单的「角色」进来。
 *
 *   右边一块浮起的纸面板:搜索 / 排序 / 导入 + 角色卡网格。每张卡 = 默认背景 + 默认立绘(按脸摆)+ 名字;
 *   没立绘的酒馆卡退回卡面头像,头像也没有就是星空 + logo。不按作品分组。
 *   左边是选中 / 悬停的那位:大立绘、名字、最后一句、继续 / 新的故事 / 资料。
 *   她有背景 → 整页铺她的场景、面板是毛玻璃(E4);没有 → 夜空 + 纸面板(E3)。
 *   「资料」把面板换成她的卡:资料 / 开场白两页。
 *
 * 每张卡的立绘、背景、卡内容进来时按需去拉,拉过的记在模块里,下次进来直接有。
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  debugApi,
  sceneThumbUrl,
  spriteImageUrl,
  type PackSprite,
  type StoredCard,
} from '../lib/api';
import { relTime } from '../lib/time';
import { facesByCanvas, type FaceBox } from '../plugins/spriteLayout';
import { accentOf, spriteForMood, titleSpriteStyle, type Accent, type TitlePose } from './titleArt';
import type { TitleCard } from './VNTitle';
import './vnPick.css';

interface Props {
  cards: TitleCard[];
  currentCardId: string | null;
  /** 当前对话的最后一句、上次玩的时间(只有当前角色有) */
  lastLine: string | null;
  lastPlayed: string | null;
  onBack: () => void;
  /** 接着这位上次的对话 */
  onContinue: (id: string) => void;
  /** 给这位开一段新对话 */
  onNewStory: (id: string) => void;
  onImport?: () => void;
  onWantAvatar: (cardId: string) => void;
}

interface Detail {
  card: StoredCard | null;
  sprite: PackSprite | null;
  face: FaceBox | null;
  bg: string | null;
}

const cache = new Map<string, Detail>();
const pending = new Map<string, Promise<Detail>>();

async function loadDetail(id: string): Promise<Detail> {
  const hit = cache.get(id);
  if (hit) return hit;
  let p = pending.get(id);
  if (!p) {
    p = (async () => {
      const [card, sprites, bg] = await Promise.all([
        debugApi.getCard(id).catch(() => null),
        debugApi.listCardSprites(id).catch(() => [] as PackSprite[]),
        (async () => {
          const pack = await debugApi.getCardScenePack(id).catch(() => null);
          if (!pack) return null;
          const assets = await debugApi.listSceneAssets(pack).catch(() => []);
          const first = assets.find((a) => a.kind === 'bg' && a.enabled && a.has_file);
          return first ? sceneThumbUrl(first, 1024) : null;
        })(),
      ]);
      const usable = sprites.filter((s) => s.enabled && s.has_image);
      const sprite = spriteForMood(usable, 'idle') ?? usable[0] ?? null;
      const face = sprite ? (facesByCanvas([sprite]).get(sprite.id) ?? null) : null;
      const d: Detail = { card, sprite, face, bg };
      // 卡没读到(网络断了、后端在重启)不记下来:不然这次打开页面里再也不会重试
      if (card) cache.set(id, d);
      pending.delete(id);
      return d;
    })();
    pending.set(id, p);
  }
  return p;
}

/** 卡片里:脸一样大、头在同一高度 */
const TILE_POSE: TitlePose = { faceSize: 0.26, faceTop: 0.17, cx: 0.5 };
const HERO_POSE: { land: TitlePose; port: TitlePose } = {
  land: { faceSize: 0.2, faceTop: 0.13, cx: 0.3 },
  port: { faceSize: 0.1, faceTop: 0.09, cx: 0.5, floor: 0.5 },
};

const STAR = 'M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z';
const Star = ({ className, style }: { className?: string; style?: CSSProperties }) => (
  <svg className={className} style={style} viewBox="-10 -10 20 20" aria-hidden="true">
    <path d={STAR} />
  </svg>
);

/** 酒馆卡里的 {{char}} / {{user}}:资料页只是给人看,简单换掉 */
const fillMacros = (s: string, name: string) =>
  s.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, '你').replace(/<\/?[a-z][^>]*>/gi, '');

type Sort = 'recent' | 'name';

/** 不拿来展示 / 筛选的标签:本机测试卡都带,区分不了谁 */
const NOISE_TAGS = new Set(['本地测试', '视觉小说']);
const cleanTags = (tags: string[] | undefined) =>
  [...new Set((tags ?? []).map((t) => t.trim()).filter((t) => t && !NOISE_TAGS.has(t)))];

export function VNPick({
  cards,
  currentCardId,
  lastLine,
  lastPlayed,
  onBack,
  onContinue,
  onNewStory,
  onImport,
  onWantAvatar,
}: Props) {
  const [details, setDetails] = useState<Map<string, Detail>>(() => new Map(cache));
  const [cur, setCur] = useState<string | null>(currentCardId ?? cards[0]?.id ?? null);
  const [hot, setHot] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'info' | 'greet'>(null);
  const [portrait, setPortrait] = useState(() => window.innerWidth < window.innerHeight);

  useEffect(() => {
    const fit = () => setPortrait(window.innerWidth < window.innerHeight);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // 先拉选中的那位,再四个一批拉其他人
  useEffect(() => {
    let alive = true;
    const ids = cards.map((c) => c.id).filter((id) => !cache.has(id));
    if (cur && ids.includes(cur)) ids.unshift(...ids.splice(ids.indexOf(cur), 1));
    void (async () => {
      for (let i = 0; i < ids.length && alive; i += 4) {
        await Promise.all(
          ids.slice(i, i + 4).map((id) =>
            loadDetail(id).then((d) => {
              if (!alive) return;
              setDetails((m) => new Map(m).set(id, d));
              if (!d.sprite) onWantAvatar(id);
            }),
          ),
        );
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 输入法里按 Esc 是取消候选字
      if (e.key !== 'Escape' || e.isComposing) return;
      e.stopPropagation();
      if (sheet) setSheet(null);
      else onBack();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sheet, onBack]);

  const shownId = sheet ? cur : (hot ?? cur);
  const shown = cards.find((c) => c.id === shownId) ?? null;
  const d = shownId ? details.get(shownId) : undefined;

  const [accent, setAccent] = useState<Accent | null>(null);
  const accentSrc = d?.sprite ? spriteImageUrl(d.sprite) : null;
  useEffect(() => {
    if (!accentSrc) return;
    let alive = true;
    void accentOf(accentSrc).then((a) => alive && a && setAccent(a));
    return () => {
      alive = false;
    };
  }, [accentSrc]);

  const tagsOf = (id: string) => cleanTags(details.get(id)?.card?.tags);
  // 筛选用的标签:库里出现得最多的十个(只算拉到了的卡)
  const topTags = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of cards) for (const t of tagsOf(c.id)) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n.entries()]
      // 只有一张卡有的筛不出什么;每张卡都有的也一样
      .filter(([, k]) => (k > 1 || n.size <= 10) && k < cards.length)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, details]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = cards.filter((c) => {
      if (tagFilter && !tagsOf(c.id).includes(tagFilter)) return false;
      if (!q) return true;
      const card = details.get(c.id)?.card;
      return [c.name, card?.creator ?? '', ...(card?.tags ?? [])].some((s) => s.toLowerCase().includes(q));
    });
    if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    else {
      const t = (c: TitleCard) => (c.id === currentCardId ? '~' : (details.get(c.id)?.card?.updated_at ?? ''));
      rows.sort((a, b) => (t(a) < t(b) ? 1 : t(a) > t(b) ? -1 : 0));
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, details, query, sort, currentCardId, tagFilter]);

  const scene = Boolean(d?.bg);
  const isCurrent = shownId === currentCardId;
  const tags = shownId ? tagsOf(shownId) : [];
  const line = isCurrent ? lastLine : null;
  const meta = [
    tags[0],
    isCurrent && lastPlayed ? `上次 ${relTime(lastPlayed)}` : shown?.hasLastChat ? '有上次的对话' : '还没开始',
  ]
    .filter(Boolean)
    .join(' · ');
  const greetings = d?.card ? [d.card.first_mes, ...(d.card.alternate_greetings ?? [])].filter((g) => g.trim()) : [];

  const heroStyle =
    d?.sprite && spriteImageUrl(d.sprite)
      ? titleSpriteStyle(d.face, d.sprite.face_scan?.height ?? null, HERO_POSE[portrait ? 'port' : 'land'], 0)
      : null;

  const vars = { '--pk-acc': accent?.acc ?? 'var(--vn-accent)' } as CSSProperties;

  return (
    <div className={`vn-pick${scene ? ' scene' : ' night'}${portrait ? ' portrait' : ''}`} style={vars}>
      {/* 底:她的场景 / 夜空 */}
      <img className="pk-sky" src="/vn/ui/sky-pick.svg" alt="" draggable={false} />
      {d?.bg && <img key={d.bg} className="pk-scene" src={d.bg} alt="" draggable={false} />}
      <div className="pk-shade" />

      {/* 左:大立绘 */}
      <div className="pk-hero">
        {d?.sprite && heroStyle ? (
          <img
            key={d.sprite.id}
            className="pk-hero-spr"
            src={spriteImageUrl(d.sprite) ?? ''}
            style={heroStyle}
            alt={shown?.name ?? ''}
            draggable={false}
          />
        ) : shown?.avatar ? (
          <div key={shown.id} className="pk-hero-av">
            <img src={shown.avatar} alt={shown.name} draggable={false} />
          </div>
        ) : (
          <img key="none" className="pk-hero-none" src="/anima-logo.svg" alt="" draggable={false} />
        )}
      </div>
      <div className="pk-hero-shade" />

      <header className="pk-head pk-ui">
        <button className="pk-back" onClick={onBack} title="返回(Esc)">
          ← <span>Esc</span>
        </button>
        <h2>角色</h2>
        <span className="en">Heroine</span>
      </header>

      {shown && (
        <div className="pk-info pk-ui" key={shown.id}>
          {tags[0] && (
            <div className="pk-work">
              <Star />
              {tags[0]}
            </div>
          )}
          <div className="pk-name">{shown.name}</div>
          {line && <p className="pk-line">「{line}」</p>}
          <div className="pk-meta">{meta}</div>
          {tags.length > 1 && (
            <ul className="pk-chips" aria-label="标签">
              {tags.slice(1, 7).map((t) => (
                <li key={t}>{t}</li>
              ))}
              {tags.length > 7 && <li className="more">+{tags.length - 7}</li>}
            </ul>
          )}
          <div className="pk-actions">
            <button className="pk-primary" onClick={() => onContinue(shown.id)}>
              <Star />
              <span>{isCurrent || shown.hasLastChat ? '继续' : '开始'}</span>
            </button>
            {(isCurrent || shown.hasLastChat) && (
              <button className="pk-ghost" onClick={() => onNewStory(shown.id)}>
                新的故事
              </button>
            )}
            <button
              className={`pk-ghost small${sheet ? ' on' : ''}`}
              onClick={() => {
                setCur(shown.id);
                setSheet(sheet ? null : 'info');
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="7.5" />
                <path d="M10 9v5M10 6.2v.1" />
              </svg>
              资料
            </button>
          </div>
        </div>
      )}

      {/* 右:纸面板 */}
      <div className="pk-panel-wrap">
        <div className="pk-panel">
          <img className="pk-map" src="/vn/ui/map-right.svg" alt="" draggable={false} />
        </div>
      </div>

      {sheet && shown ? (
        <div className="pk-side pk-ui" key={`sheet-${shown.id}`}>
          <div className="pk-sheet-top">
            <button className="pk-link" onClick={() => setSheet(null)}>
              ← 全部角色
            </button>
            <nav className="pk-tabs">
              <button className={sheet === 'info' ? 'on' : ''} onClick={() => setSheet('info')}>
                资料
              </button>
              <button className={sheet === 'greet' ? 'on' : ''} onClick={() => setSheet('greet')}>
                开场白{greetings.length > 0 ? ` ${greetings.length}` : ''}
              </button>
            </nav>
          </div>
          <div className="pk-sheet-head">
            <span className="nm">{shown.name}</span>
            {d?.card?.creator && <span className="by">by {d.card.creator}</span>}
            {tags.length > 0 && (
              <div className="pk-tags">
                {tags.slice(0, 8).map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )}
          </div>
          <div className="pk-sheet-body pk-scroll">
            {!d ? (
              <p className="pk-empty">正在读取……</p>
            ) : !d.card ? (
              <p className="pk-empty">没读到这张卡(网络或后端出错了),返回再进来会重试</p>
            ) : sheet === 'info' ? (
              <>
                {[
                  ['简介', d.card.creator_notes],
                  ['描述', d.card.description],
                  ['性格', d.card.personality],
                  ['场景', d.card.scenario],
                ]
                  .filter(([, v]) => v?.trim())
                  .map(([k, v]) => (
                    <section key={k}>
                      <h4>{k}</h4>
                      <p>{fillMacros(v, shown.name)}</p>
                    </section>
                  ))}
              </>
            ) : greetings.length === 0 ? (
              <p className="pk-empty">这张卡没有写开场白</p>
            ) : (
              greetings.map((g, i) => (
                <section key={i} className="pk-greet">
                  <h4>{i === 0 ? '默认开场白' : `备选 ${i}`}</h4>
                  <p>{fillMacros(g, shown.name)}</p>
                </section>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="pk-side pk-ui" key="list">
          <div className="pk-tools">
            <label className="pk-search">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="M12.6 12.6 17 17" />
              </svg>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名字、标签、作者" />
            </label>
            <div className="pk-sort">
              {(
                [
                  ['recent', '最近'],
                  ['name', '名字'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
                  {label}
                </button>
              ))}
            </div>
            {onImport && (
              <button className="pk-import" onClick={onImport}>
                ＋ 导入
              </button>
            )}
          </div>
          {topTags.length > 0 && (
            <div className="pk-filter pk-scroll" role="toolbar" aria-label="按标签筛选">
              <button className={tagFilter === null ? 'on' : ''} onClick={() => setTagFilter(null)}>
                全部
              </button>
              {topTags.map((t) => (
                <button key={t} className={tagFilter === t ? 'on' : ''} onClick={() => setTagFilter(tagFilter === t ? null : t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="pk-grid-wrap pk-scroll">
            <div className="pk-grid">
              {list.map((c) => (
                <Tile
                  key={c.id}
                  card={c}
                  detail={details.get(c.id)}
                  selected={c.id === cur}
                  current={c.id === currentCardId}
                  onPick={() => setCur(c.id)}
                  onOpen={() => onContinue(c.id)}
                  onHover={(on) => setHot(on ? c.id : null)}
                />
              ))}
              {onImport && !query && !tagFilter && (
                <button className="pk-tile import" onClick={onImport}>
                  <span className="pk-tile-art">
                    <b>+</b>
                    <small>PNG / JSON</small>
                  </span>
                  <span className="pk-tile-name">导入角色卡</span>
                </button>
              )}
            </div>
            {list.length === 0 && <p className="pk-empty">{query || tagFilter ? '没有找到' : '库里还没有角色卡'}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({
  card,
  detail,
  selected,
  current,
  onPick,
  onOpen,
  onHover,
}: {
  card: TitleCard;
  detail: Detail | undefined;
  selected: boolean;
  current: boolean;
  onPick: () => void;
  onOpen: () => void;
  onHover: (on: boolean) => void;
}) {
  const sprite = detail?.sprite ?? null;
  const src = sprite ? spriteImageUrl(sprite) : null;
  const style = sprite && src ? titleSpriteStyle(detail?.face ?? null, sprite.face_scan?.height ?? null, TILE_POSE, 0) : null;
  const tavern = detail !== undefined && !sprite;
  return (
    <button
      className={`pk-tile${selected ? ' selected' : ''}`}
      onClick={onPick}
      onDoubleClick={onOpen}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      title={`${card.name}(双击直接进入)`}
    >
      <span className="pk-tile-art">
        {src && style ? (
          <>
            <img className="bg" src={detail?.bg ?? '/vn/bg/default.svg'} alt="" draggable={false} loading="lazy" />
            <img className="spr" src={src} style={style} alt="" draggable={false} loading="lazy" />
          </>
        ) : card.avatar ? (
          <img className="av" src={card.avatar} alt="" draggable={false} />
        ) : (
          <>
            <img className="bg" src="/vn/ui/sky-pick.svg" alt="" draggable={false} />
            <img className="logo" src="/anima-logo.svg" alt="" draggable={false} />
          </>
        )}
        {tavern && <span className="tav">酒馆卡</span>}
      </span>
      {(selected || current) && <Star className={`pk-tile-star${selected ? ' on' : ''}`} />}
      <span className="pk-tile-name">{card.name}</span>
      <span className="pk-tile-work">{cleanTags(detail?.card?.tags)[0] || ' '}</span>
    </button>
  );
}
