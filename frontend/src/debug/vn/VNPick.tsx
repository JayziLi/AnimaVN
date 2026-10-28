/**
 * 选角色(10-23 定的新版,设计稿 flow.html#pick / kit/pick.js;手机竖屏照 phone.html#a)。封面菜单的「角色」进来。
 *
 *   电脑:左边一块照星海的纸面板(返回 · 角色 · 最近 / 名字 · 导入 · 搜索「名字、作者」· 3 列卡面),
 *        中间是选中的那位站着(背后是她的场景),右边名字 + 上次停在哪 + 一条一条的素材(「更多」去菜单里改)+ 继续 / 资料。
 *   手机:上面场景 + 大立绘 + 名字和继续 / 资料,下面一张斜切的纸放搜索和卡面;素材那几条放不下,点「资料」看。
 *   卡面是星语式(pick/PickTile.tsx),选中是白色,不跟角色变;不写作品名、不放角色台词、没有按标签筛选那一排。
 *   纸面跟设置里的「主题」(白 / 黑 / 玻璃,默认白):面板、右边资料、名字底下那层渐变一起换;玻璃时糊的只有垫的那张场景图。
 *   「资料」把面板换成她的卡:资料 / 开场白两页。
 *
 * 每张卡的立绘、背景、卡内容进来时按需去拉,拉过的记在模块里(pickDetail.ts),下次进来直接有;
 * 右边那几条(包名、声音、预设、人设)每次进来另拉(pick/pickBind.ts),因为随时会在菜单里被改。
 * 卡片是拖放落点:把文件拖到某张卡上 = 给她加素材;「导入」那一格和面板上的按钮走导入器(选文件)。
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { spriteImageUrl, spriteThumbUrl } from '../lib/api';
import { cachedPickDetails, hasPickDetail, loadPickDetail, type PickDetail as Detail } from './pickDetail';
import { PickIcon } from './pick/PickIcon';
import { PickTile } from './pick/PickTile';
import { loadPickBind, loadPickGlobals, type PickGlobals } from './pick/pickBind';
import { hasPlayed, lastLineText, matchCard, pickRows, sortCards, type PickBind, type PickMoreKind, type PickSort } from './pick/pickLogic';
import { boardScale, isPortrait, useBoxSize } from './pick/useBoxSize';
import { accentOf, titleSpriteStyle, type Accent, type TitlePose } from './titleArt';
import { popThemeClass } from './ui/logic';
import { useSceneGlass } from './ui/useSceneGlass';
import { usePaperTheme } from './usePaperTheme';
import type { TitleCard } from './VNTitle';
import './theme.css';
import './ui/ui.css';
import './vnPick.css';

interface Props {
  cards: TitleCard[];
  currentCardId: string | null;
  /** 当前对话上次玩的时间(只有当前角色有) */
  lastPlayed: string | null;
  onBack: () => void;
  /** 接着这位上次的对话(没玩过 = 开始) */
  onContinue: (id: string) => void;
  onImport?: () => void;
  onWantAvatar: (cardId: string) => void;
  /** 名字右边小号的「导出」:导出她的角色包(.animavn);不给就不画这个按钮 */
  onExport?: (id: string) => void;
  /** 右边每一条素材的「更多」:去菜单里能改这一样的那一页;不给就不画「更多」,那几条只读 */
  onMore?: (kind: PickMoreKind, id: string) => void;
  /** 刚导进来的那张(设计稿 kit/transfer.js:排在「最近」最前面、选中,格子左下一个「刚导入」小签) */
  freshId?: string | null;
  /** 当前这位停在哪个场景:名字下面那行「上次 · 客厅 · 3 周前 · 11 条」 */
  currentScene?: string | null;
}

/** 大立绘:电脑照设计稿 kit/pick.js 的 HERO_POSE,手机照 phone.js 的 PICK_POSE(下沿别露出半空的切边) */
const HERO_POSE: { land: TitlePose; port: TitlePose } = {
  land: { faceSize: 0.19, faceTop: 0.12, cx: 0.524 },
  port: { faceSize: 0.12, faceTop: 0.085, cx: 0.5, floor: 0.5 },
};

/** 酒馆卡里的 {{char}} / {{user}}:资料页只是给人看,简单换掉 */
const fillMacros = (s: string, name: string) =>
  s.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, '你').replace(/<\/?[a-z][^>]*>/gi, '');

/** 换场景:新的一张叠上去淡入,淡完再摘旧的(不露底) */
function useLayers(src: string | null): { key: number; src: string | null }[] {
  const [layers, setLayers] = useState(() => [{ key: 0, src }]);
  const last = layers[layers.length - 1];
  if (last.src !== src) setLayers([...layers.slice(-1), { key: last.key + 1, src }]);
  useEffect(() => {
    if (layers.length < 2) return;
    const t = window.setTimeout(() => setLayers((l) => l.slice(-1)), 340);
    return () => window.clearTimeout(t);
  }, [layers]);
  return layers;
}

export function VNPick({
  cards,
  currentCardId,
  lastPlayed,
  onBack,
  onContinue,
  onImport,
  onWantAvatar,
  onExport,
  onMore,
  freshId = null,
  currentScene = null,
}: Props) {
  const [details, setDetails] = useState<Map<string, Detail>>(cachedPickDetails);
  const [cur, setCur] = useState<string | null>(
    (freshId && cards.some((c) => c.id === freshId) ? freshId : null) ?? currentCardId ?? cards[0]?.id ?? null,
  );
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PickSort>('recent');
  const [sheet, setSheet] = useState<null | 'info' | 'greet'>(null);
  // 选角色开着时导进来一张(等卡列表里有了它):选中它、收起资料、清掉搜索(在列表里看得到它)
  const [seenFresh, setSeenFresh] = useState(freshId);
  if (freshId !== seenFresh && (!freshId || cards.some((c) => c.id === freshId))) {
    setSeenFresh(freshId);
    if (freshId) {
      setCur(freshId);
      setSheet(null);
      setQuery('');
    }
  }
  const [globals, setGlobals] = useState<PickGlobals | null>(null);
  const [binds, setBinds] = useState<Map<string, PickBind>>(() => new Map());

  const rootRef = useRef<HTMLDivElement>(null);
  const box = useBoxSize(rootRef);
  const portrait = isPortrait(box);
  const k = boardScale(box);
  const theme = usePaperTheme();
  const paper = popThemeClass(theme);

  // 先拉选中的那位,再四个一批拉其他人
  useEffect(() => {
    let alive = true;
    const ids = cards.map((c) => c.id).filter((id) => !hasPickDetail(id));
    if (cur && ids.includes(cur)) ids.unshift(...ids.splice(ids.indexOf(cur), 1));
    void (async () => {
      for (let i = 0; i < ids.length && alive; i += 4) {
        await Promise.all(
          ids.slice(i, i + 4).map((id) =>
            loadPickDetail(id).then((d) => {
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

  // 右边那几条要的全局表(包名、声音名这些),进来拉一次;导进来一张(多了包、声音)再拉一次,那张的绑定重读
  useEffect(() => {
    let alive = true;
    void loadPickGlobals().then((g) => {
      if (!alive) return;
      setGlobals(g);
      if (freshId)
        setBinds((m) => {
          const next = new Map(m);
          next.delete(freshId);
          return next;
        });
    });
    return () => {
      alive = false;
    };
  }, [freshId]);

  const d = cur ? details.get(cur) : undefined;
  // 选中的那位:等她的卡读到了(要里面记的上次对话)再拉她绑着的东西
  useEffect(() => {
    if (!cur || !globals || !d || binds.has(cur)) return;
    let alive = true;
    void loadPickBind(cur, d.card?.last_chat_id ?? null, globals).then((b) => alive && setBinds((m) => new Map(m).set(cur, b)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, globals, d]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 输入法里按 Esc 是取消候选字
      if (e.key !== 'Escape' || e.isComposing) return;
      // 导入 / 导出的框开着:这一下归框(关框),选角色不退
      if (document.querySelector('.tf-host, .st-modal-backdrop')) return;
      e.stopPropagation();
      if (sheet) setSheet(null);
      else onBack();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sheet, onBack]);

  const shown = cards.find((c) => c.id === cur) ?? null;

  // 点缀色:只点在面板标题下那一小段细线、纸上的开关焦点框这类地方,从选中那位的立绘取(选中本身是白色)
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

  const list = useMemo(() => {
    const rows = cards
      .filter((c) => matchCard(c.name, details.get(c.id)?.card?.creator, query))
      .map((c) => ({ ...c, updatedAt: details.get(c.id)?.card?.updated_at ?? '' }));
    const sorted = sortCards(rows, sort, currentCardId);
    // 刚导进来的那张排在「最近」最前面
    const at = sort === 'recent' && freshId ? sorted.findIndex((c) => c.id === freshId) : -1;
    return at > 0 ? [sorted[at], ...sorted.slice(0, at), ...sorted.slice(at + 1)] : sorted;
  }, [cards, details, query, sort, currentCardId, freshId]);

  const bg = d?.bg ?? null;
  const layers = useLayers(bg);
  // 玻璃主题:颜色按选中这位的场景算,面板糊的是这张场景图
  const glass = useSceneGlass(theme === 'glass', bg);
  const isCurrent = cur === currentCardId;
  const played = shown ? hasPlayed(isCurrent, shown.hasLastChat) : false;
  const bind = cur ? binds.get(cur) : undefined;
  const last = shown ? lastLineText({ isCurrent, hasLastChat: shown.hasLastChat, lastPlayed, bind, scene: currentScene }) : '';
  const rows = pickRows(bind, d?.spriteCount ?? 0);
  const greetings = d?.card ? [d.card.first_mes, ...(d.card.alternate_greetings ?? [])].filter((g) => g.trim()) : [];

  const heroStyle =
    d?.sprite && spriteImageUrl(d.sprite)
      ? titleSpriteStyle(d.face, d.sprite.face_scan?.height ?? null, HERO_POSE[portrait ? 'port' : 'land'], box.h)
      : null;

  const vars = {
    '--u': `${k}px`,
    '--k': k,
    ...(accent ? { '--av-acc': accent.acc, '--av-acc-deep': accent.deep } : {}),
    ...(theme === 'glass' && bg ? { '--gl-bg': `url("${bg}")` } : {}),
    ...glass,
  } as CSSProperties;

  const go = () => shown && onContinue(shown.id);
  const toggleSheet = () => setSheet(sheet ? null : 'info');

  // ---- 几块两种布局共用的零件 ----
  const backBtn = (
    <button type="button" className="av-btn pk-back" onClick={onBack} title="返回(Esc)" aria-label="返回封面">
      <PickIcon name="back" size={16} />
      {portrait ? <span>封面</span> : <kbd className="av-kbd">Esc</kbd>}
    </button>
  );
  const sortSeg = (
    <div className="av-seg pk-sort" role="radiogroup" aria-label="排序">
      {(
        [
          ['recent', '最近'],
          ['name', '名字'],
        ] as const
      ).map(([key, label]) => (
        <button key={key} type="button" role="radio" aria-checked={sort === key} className={sort === key ? 'on' : ''} onClick={() => setSort(key)}>
          {label}
        </button>
      ))}
    </div>
  );
  const importBtn = onImport && (
    <button type="button" className={portrait ? 'av-btn primary pk-import' : 'av-btn sm pk-import'} onClick={onImport}>
      <PickIcon name="plus" size={14} />
      导入
    </button>
  );
  const searchBox = (
    <label className="pk-search">
      {/* 放大镜只有手机竖屏有(phone.html 的 .pf-sbox);桌面照组件库 .av-input,不带图标 */}
      {portrait && <PickIcon name="search" size={16} />}
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名字、作者" aria-label="搜索角色" />
    </label>
  );
  const grid = (
    <>
      <div className="pk-grid">
        {list.map((c) => (
          <PickTile
            key={c.id}
            card={c}
            detail={details.get(c.id)}
            selected={c.id === cur}
            current={c.id === currentCardId}
            fresh={c.id === freshId}
            onPick={() => setCur(c.id)}
            onOpen={() => onContinue(c.id)}
          />
        ))}
        {onImport && !query.trim() && (
          <button type="button" className="pk-tile add" onClick={onImport}>
            <span className="cl">
              <span className="art">
                <PickIcon name="plus" size={30} />
                <small>卡 · 立绘 · 背景</small>
              </span>
              <span className="cap">
                <b>导入</b>
              </span>
            </span>
          </button>
        )}
      </div>
      {list.length === 0 && <p className="pk-empty">{query.trim() ? '没有找到' : '库里还没有角色卡'}</p>}
    </>
  );
  // 「资料」:面板换成她的卡(资料 / 开场白)
  const sheetView =
    shown &&
    sheet !== null ? (
      <div className="pk-sheet-in" key={`sheet-${shown.id}`}>
        <div className="top">
          <button type="button" className="av-btn ghost pk-all" onClick={() => setSheet(null)}>
            <PickIcon name="back" size={16} />
            全部角色
          </button>
          <div className="pk-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={sheet === 'info'} className={sheet === 'info' ? 'on' : ''} onClick={() => setSheet('info')}>
              <span className="zh">资料</span>
              <span className="en">Profile</span>
            </button>
            <button type="button" role="tab" aria-selected={sheet === 'greet'} className={sheet === 'greet' ? 'on' : ''} onClick={() => setSheet('greet')}>
              <span className="zh">开场白</span>
              <span className="en">Greeting</span>
              {greetings.length > 0 && <span className="n">{greetings.length}</span>}
            </button>
          </div>
        </div>
        <div className="hd">
          {shown.avatar && <img src={shown.avatar} alt="" draggable={false} />}
          <b>{shown.name}</b>
          {d?.card?.creator && <span className="by">by {d.card.creator}</span>}
        </div>
        <div className="bd">
          {!d ? (
            <p className="pk-empty">正在读取……</p>
          ) : !d.card ? (
            <p className="pk-empty">没读到这张卡(网络或后端出错了),返回再进来会重试</p>
          ) : sheet === 'info' ? (
            [
              ['简介', d.card.creator_notes],
              ['描述', d.card.description],
              ['性格', d.card.personality],
              ['场景', d.card.scenario],
            ]
              .filter(([, v]) => v?.trim())
              .map(([title, v]) => (
                <section key={title}>
                  <h4>{title}</h4>
                  <p>{fillMacros(v, shown.name)}</p>
                </section>
              ))
          ) : greetings.length === 0 ? (
            <p className="pk-empty">这张卡没有写开场白</p>
          ) : (
            greetings.map((g, i) => (
              <section key={i}>
                <h4>{i === 0 ? '默认开场白' : `备选 ${i}`}</h4>
                <p>{fillMacros(g, shown.name)}</p>
              </section>
            ))
          )}
        </div>
      </div>
    ) : null;

  const exportBtn = shown && onExport && (
    <button type="button" className="av-btn sm pk-export" onClick={() => onExport(shown.id)} title="导出她的角色包(.animavn):卡、绑着的立绘 / 场景 / 声音">
      <PickIcon name="upload" size={15} />
      导出
    </button>
  );
  const playBtn = (
    <button type="button" className="av-btn primary pk-go" onClick={go}>
      <svg className="av-star" viewBox="-10 -10 20 20" aria-hidden="true">
        <path d="M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z" fill="currentColor" />
      </svg>
      {played ? '继续' : '开始'}
    </button>
  );
  const infoBtn = (
    <button type="button" className={`av-btn pk-info-btn${sheet ? ' on' : ''}`} onClick={toggleSheet} aria-pressed={sheet !== null}>
      {portrait && <PickIcon name="info" size={15} />}
      资料
    </button>
  );

  const heroNode = (
    <div className="pk-hero">
      {d?.sprite && heroStyle ? (
        <img key={d.sprite.id} className="av-spr pk-hero-spr" src={spriteImageUrl(d.sprite) ?? ''} style={heroStyle} alt={shown?.name ?? ''} draggable={false} />
      ) : shown?.avatar ? (
        // 没有立绘的卡(酒馆卡):中间放一张「相片」—— 纸边 + 卡面头像
        <div key={shown.id} className="pk-print">
          <div className="win">
            <img className="bed" src={shown.avatar} alt="" draggable={false} />
            <img className="im" src={shown.avatar} alt={shown.name} draggable={false} />
          </div>
        </div>
      ) : (
        <img key="none" className="pk-hero-none" src="/anima-logo.svg" alt="" draggable={false} />
      )}
    </div>
  );
  // 只有卡图、没场景(刚从酒馆导入的):卡图放大糊开垫底;立绘也没有、场景也没有的卡才是夜空
  const bare = !bg && !d?.sprite && shown?.avatar ? shown.avatar : null;
  const bgNode = (
    <div className="pk-bgs">
      {layers.map((l, i) =>
        l.src ? (
          <img key={l.key} className={`pk-scene${i === layers.length - 1 && layers.length > 1 ? ' in' : ''}`} src={l.src} alt="" draggable={false} />
        ) : bare ? (
          <div key={`bare-${shown?.id}`} className="pk-bare">
            <img src={bare} alt="" draggable={false} />
          </div>
        ) : (
          <img key={l.key} className="pk-sky" src="/vn/ui/sky-pick.svg" alt="" draggable={false} />
        ),
      )}
    </div>
  );

  if (portrait) {
    return (
      <div ref={rootRef} className="vn-pick portrait" style={vars}>
        {bgNode}
        {heroNode}
        <div className="pk-pkshade" />
        <div className="pk-top pk-ui">
          {backBtn}
          <div className="pk-ttl">
            <span className="zh">角色</span>
            <span className="en">Heroine</span>
          </div>
        </div>
        {shown && (
          <div className="pk-info pk-ui" key={shown.id}>
            <div className="pk-nmrow">
              <div className="nm">{shown.name}</div>
              {exportBtn}
            </div>
            <div className="pk-last">{last}</div>
            <div className="pk-btns">
              {playBtn}
              {infoBtn}
            </div>
          </div>
        )}
        <div className="pk-sheetwrap pk-ui">
          <div className={`pk-panel pk-sheet ${paper}`}>
            <i className="cut" />
            <div className="pk-sheetin">
              {sheetView ?? (
                <>
                  <div className="pk-tools">
                    {searchBox}
                    {importBtn}
                  </div>
                  <div className="pk-chips">{sortSeg}</div>
                  <div className="pk-list">{grid}</div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="vn-pick" style={vars}>
      {bgNode}
      <div className={`pk-veil ${paper}`} />
      {heroNode}
      <div className="pk-ui">
        <section className={`pk-panel ${paper}`}>
          <header className="pk-phead">
            {backBtn}
            <h2>角色</h2>
            <span className="en">Heroine</span>
            <span className="sp" />
            {sheet === null && (
              <>
                {sortSeg}
                {importBtn}
                {searchBox}
              </>
            )}
          </header>
          <div className="pk-side">{sheetView ?? <div className="pk-list">{grid}</div>}</div>
        </section>
        {shown && (
          <div className={`pk-info ${paper}`} key={shown.id}>
            <div className="pk-nmrow">
              <div className="nm">{shown.name}</div>
              {exportBtn}
            </div>
            <div className="rule" />
            <div className="pk-last">{last}</div>
            <div className="pk-rows">
              {rows.map((r) => {
                const body = (
                  <>
                    <span className="k">
                      <b>{r.k}</b>
                      <i>{r.en}</i>
                    </span>
                    <span className="v">
                      <span>{r.v}</span>
                      {r.sub && <small>{r.sub}</small>}
                      {r.kind === 'sprite' && d && d.heads.length > 0 && (
                        <span className="pk-faces">
                          {d.heads.map((h) => {
                            const src = spriteThumbUrl(h.sprite, 80);
                            return (
                              <span key={h.sprite.id}>
                                {src && (
                                  <img
                                    src={src}
                                    style={titleSpriteStyle(h.face, h.sprite.face_scan?.height ?? null, { faceSize: 0.62, faceTop: 0.18, cx: 0.5 }, 22)}
                                    alt=""
                                    draggable={false}
                                    loading="lazy"
                                  />
                                )}
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </span>
                    {onMore && (
                      <span className="more">
                        更多
                        <PickIcon name="forward" size={14} />
                      </span>
                    )}
                  </>
                );
                return onMore ? (
                  <button key={r.kind} type="button" className="pk-row" onClick={() => onMore(r.kind, shown.id)} title={`去菜单里改${r.k}`}>
                    {body}
                  </button>
                ) : (
                  <div key={r.kind} className="pk-row">
                    {body}
                  </div>
                );
              })}
            </div>
            <div className="pk-btns">
              {playBtn}
              {infoBtn}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
