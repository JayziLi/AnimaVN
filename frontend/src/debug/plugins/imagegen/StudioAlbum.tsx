/**
 * 卡编辑器素材页的「AI 生成」那一栏(生图卡带经扩展点 VnIllustrations.studio 交给内核,见 cartridges.ts):
 * 游戏里点画笔画的、自动出图画的图都先进相册;点 ☆ 收藏进「AI 生图 · 卡名」CG 包,游戏里 AI / Jev 才选得到。
 * 导入的现成 CG 在「CG」那一栏(用户要求两种分开放),收藏建的包只在这一栏的「已收藏」里看。
 *
 *   顶上  类型小牌子「AI 生成」+ 筛选(全部 / 手动 / 自动 / 已收藏)+ 右边「生图设置」(插件页卡带那一页,盖在上面)
 *   舞台  选中的图照生图设置里的「放在哪」摆(对话框上面 / 铺满屏幕),右上角下拉改的就是那一项;对话框是一句旁白
 *   相册  网格:缩略图、标题、手动 / 自动,右上角 ☆ 收藏 / ★ 已收藏;下面一排设置摘要(角色名、画风、参考图、自动出图)
 *   右栏  标题、时间 · 手动 / 自动 · 用时、画面描述、收藏状态、生成参数、提示词(复制);底部收藏、删除(点两下)
 *
 * 相册在 useImageGen 里(设置的「相册」页用同一份);收藏完 useImageGen 会让 DebugApp 重读这张卡的 CG 绑定,
 * 新的那张随 kept 回来。纯逻辑在 studioAlbumModel.ts。
 */

import { useEffect, useMemo, useState } from 'react';
import { apiUrl, sceneImageUrl, sceneThumbUrl } from '../../lib/api';
import { SCENE_WIDTHS } from '../../generated/contracts';
import { selectAfterDelete } from '../../studio/editors/spriteEdit';
import { Icon } from '../../studio/icons';
import { StagePreview } from '../../studio/preview/StagePreview';
import { TERMS } from '../../studio/terms';
import { Btn, DeleteBtn, HelpTip, Inspector, InspectorHead, Section, TypeLabel } from '../../studio/ui';
import type { StudioIllustrationContext } from '../cartridges';
import {
  ALBUM_FILTERS,
  albumCounts,
  albumEntries,
  albumNote,
  emptyNote,
  filterAlbum,
  keptText,
  metaLine,
  narrationOf,
  paramRows,
  pickEntry,
  PLACE_OPTIONS,
  placeName,
  promptText,
  settingsCells,
  triggerName,
  withCardName,
  type AlbumEntry,
  type AlbumFilter,
} from './studioAlbumModel';
import type { ImageGenStore } from './useImageGen';
import './studioAlbum.css';

/** 网格缩略图、右栏头的小图多宽 */
const THUMB_W = 320;

/** 一格的图:相册里的按指纹取,只在 CG 包里的按构图取 */
function srcOf(e: AlbumEntry, w: number): string | null {
  if (e.image) return e.image.sha ? apiUrl(`/api/blobs/${e.image.sha}?w=${w}`) : null;
  return e.cg ? sceneThumbUrl(e.cg, w) : null;
}

/** 舞台上的图:和游戏里一样宽 */
function stageSrcOf(e: AlbumEntry): string | null {
  if (e.image) return e.image.sha ? apiUrl(`/api/blobs/${e.image.sha}?w=${SCENE_WIDTHS.desktop}`) : null;
  return e.cg ? sceneImageUrl(e.cg) : null;
}

const titleOf = (e: AlbumEntry) => (e.image ? e.image.title.trim() || '(没有标题)' : (e.cg?.label ?? ''));

export interface StudioAlbumProps extends StudioIllustrationContext {
  store: ImageGenStore;
}

export function StudioAlbum({ store, cardName, kept, openSettings }: StudioAlbumProps) {
  const { album, albumError, reloadAlbum, config, changeConfig } = store;
  const [filter, setFilter] = useState<AlbumFilter>('all');
  const [pick, setPick] = useState<string | null>(null);
  // 正在收藏的那张(按钮先变「收藏中…」,别连点);刚收藏、CG 绑定还没重读回来的 CG id
  const [keeping, setKeeping] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // 进来时重读一次:游戏里、别的设备上刚画的
  useEffect(() => {
    void reloadAlbum();
  }, [reloadAlbum]);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const entries = useMemo(() => (album ? albumEntries(album, kept, pending) : []), [album, kept, pending]);
  const counts = albumCounts(entries);
  const list = filterAlbum(entries, filter);
  const shown = pickEntry(list, pick);

  const keepOne = async (e: AlbumEntry) => {
    if (!e.image || e.kept || keeping) return;
    setKeeping(e.key);
    const k = await store.keep(e.image.id);
    setKeeping(null);
    if (k) setPending((s) => new Set(s).add(k.asset_id));
  };

  const remove = async (e: AlbumEntry) => {
    if (!e.image) return;
    const next = selectAfterDelete(
      list.map((x) => x.key),
      e.key,
    );
    if (await store.removeImage(e.image.id)) setPick(next);
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => store.notify('error', '复制失败:浏览器不让读写剪贴板,手动选中复制吧'),
    );
  };

  // ---- 主区 ----

  const loading = album === null && !albumError;
  const stageNote = albumError
    ? `相册读取失败:${albumError}`
    : loading
      ? '读取中…'
      : !shown
        ? emptyNote(entries.length === 0 ? 'all' : filter)
        : null;
  const stageSrc = shown ? stageSrcOf(shown) : null;

  const placeChip = (
    <label className="st-stage-chip st-stage-pick" title={TERMS.place}>
      <span>放在哪:{placeName(config.place)}</span>
      <Icon name="chev" size={14} />
      <select
        aria-label="图在游戏里放哪"
        value={config.place}
        onChange={(ev) => changeConfig({ ...config, place: ev.target.value === 'screen' ? 'screen' : 'above' })}
      >
        {PLACE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );

  const main = (
    <main className="st-main sa-main">
      <div className="st-slot-bar sa-bar">
        <TypeLabel slot="ai" />
        <div className="sa-seg" role="radiogroup" aria-label="筛选相册">
          {ALBUM_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={filter === f.key}
              className={`sa-seg-btn${filter === f.key ? ' on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.name} {counts[f.key]}
            </button>
          ))}
        </div>
        <span className="st-flex" />
        <Btn icon="preset" onClick={openSettings}>
          生图设置
        </Btn>
      </div>

      <StagePreview
        background={null}
        cg={stageSrc ? { src: stageSrc, focus: 50, mode: config.place } : null}
        line={shown ? { speaker: '旁白', text: narrationOf(shown), narration: true } : null}
        badges={placeChip}
        overlays={stageNote ? <div className="sa-stage-note">{stageNote}</div> : null}
      />

      <div className="sa-album-head">
        <span className="st-grid-title">相册</span>
        <HelpTip text={TERMS.gen} />
        <span className="st-grid-note">{album === null ? '读取中…' : albumNote(counts.all, cardName)}</span>
      </div>
      {album !== null &&
        (list.length > 0 ? (
          <div className="sa-grid" role="listbox" aria-label="相册">
            {list.map((e) => {
              const selected = e.key === shown?.key;
              const src = srcOf(e, THUMB_W);
              return (
                <div key={e.key} className={`sa-tile${selected ? ' selected' : ''}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="sa-tile-main"
                    title={e.image?.description || e.cg?.description || undefined}
                    onClick={() => setPick(e.key)}
                  >
                    <span className="sa-thumb">
                      {src ? (
                        <img src={src} alt="" draggable={false} loading="lazy" />
                      ) : (
                        <span className="sa-thumb-none">
                          <Icon name="image" size={18} />
                        </span>
                      )}
                    </span>
                    <span className="sa-tile-name">{titleOf(e)}</span>
                    <span className="sa-tile-sub">{e.image ? triggerName(e.image.trigger) : '只在 CG 包里'}</span>
                  </button>
                  <button
                    type="button"
                    className={`sa-star${e.kept ? ' on' : ''}`}
                    aria-label={e.kept ? '已收藏' : `收藏「${titleOf(e)}」进 CG 包`}
                    title={e.kept ? '已收藏进 CG 包' : '收藏进 CG 包'}
                    disabled={e.kept || !e.image || keeping !== null}
                    onClick={() => void keepOne(e)}
                  >
                    {keeping === e.key ? <span className="spinner tiny" /> : <Icon name="star" size={12} fill={e.kept} strokeWidth={2} />}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          entries.length > 0 && <div className="sa-grid-empty">{emptyNote(filter)}</div>
        ))}

      <div className="sa-strip">
        {settingsCells(config, store.prefs).map((c) => (
          <div key={c.label} className="sa-cell">
            <span className="sa-cell-label">
              {c.label}
              {c.help && <HelpTip text={c.help} />}
            </span>
            <span className="sa-cell-value" title={c.value}>
              {c.value}
            </span>
          </div>
        ))}
      </div>
    </main>
  );

  // ---- 右栏 ----

  if (!shown) {
    return (
      <>
        {main}
        <Inspector label="AI 生成" head={<InspectorHead title="AI 生成" />}>
          <Section title="相册" help={TERMS.gen} first />
          <p className="st-inspector-hint sa-intro">
            游戏里点对话框旁边的画笔(右键 / 长按先设置),或者开着自动出图,画出来的图都先进这里的相册。
          </p>
          <p className="st-inspector-hint sa-intro">
            点图右上角的 ☆ 收藏进「AI 生图 · {cardName.trim() || '卡名'}」CG 包,游戏里 AI / Jev 才选得到它;导入的现成 CG 在「CG」那一栏。
          </p>
        </Inspector>
      </>
    );
  }

  const { image } = shown;
  const thumb = srcOf(shown, THUMB_W);
  const prompt = image ? promptText(image) : '';
  const description = image ? image.description.trim() : (shown.cg?.description.trim() ?? '');

  return (
    <>
      {main}
      <Inspector
        label={`这张图「${titleOf(shown)}」`}
        head={
          <InspectorHead
            media={
              thumb ? (
                <img className="st-ihead-media wide sa-ihead-media" src={thumb} alt="" draggable={false} />
              ) : (
                <span className="st-ihead-media wide sa-ihead-media sa-thumb-none">
                  <Icon name="image" size={18} />
                </span>
              )
            }
            title={<span title={titleOf(shown)}>{titleOf(shown)}</span>}
            badge={<span>{image ? metaLine(image) : '只在 CG 包里'}</span>}
          />
        }
        footer={
          image ? (
            <>
              <Btn small icon="star" disabled={shown.kept || keeping !== null} onClick={() => void keepOne(shown)}>
                {shown.kept ? '已收藏' : keeping === shown.key ? '收藏中…' : '收藏进 CG 包'}
              </Btn>
              <span className="st-flex" />
              <DeleteBtn
                small
                label="删除"
                armedLabel={shown.kept ? '再点一下删除记录' : '再点一下删除'}
                onConfirm={() => void remove(shown)}
              />
            </>
          ) : undefined
        }
      >
        {description && <p className="sa-desc">{description}</p>}
        <div className={`sa-kept${shown.kept ? ' on' : ''}`}>
          <Icon name="star" size={15} fill={shown.kept} strokeWidth={1.6} />
          <span className="sa-kept-text">{keptText(shown)}</span>
          <HelpTip text={withCardName(TERMS.keep, cardName)} />
        </div>
        {image ? (
          <>
            <Section title="生成参数" />
            <div className="sa-params">
              {paramRows(image).map((r) => (
                <div key={r.label} className="sa-param">
                  <span className="sa-param-k">{r.label}</span>
                  <span className="sa-param-v">{r.value}</span>
                </div>
              ))}
            </div>
            <Section
              title="提示词"
              right={
                prompt ? (
                  <button type="button" className="st-link" onClick={() => copy(prompt)}>
                    {copied ? '已复制' : '复制'}
                  </button>
                ) : undefined
              }
            />
            <pre className="sa-prompt">{prompt || '(没有记下来)'}</pre>
          </>
        ) : (
          <p className="st-inspector-hint">
            相册里没有这张的记录(删掉了,或者太早没列出来),生成参数和提示词看不到了。它还在 CG 包里,游戏里照样能选。
          </p>
        )}
      </Inspector>
    </>
  );
}
