/**
 * 一个场景包里「背景」那一半的编辑器:主区 = 顶上那一行(外面给)+ 实机预览舞台 + 背景网格,右栏 = 选中那张背景。
 * 不依赖卡:卡编辑器的背景栏和素材管理页都用它;默认 BGM 能选哪些曲子、叠什么立绘由外面给。
 *
 * 舞台(照 V4AttachBg):选中的背景;右上角两个开关 ——「叠上立绘」(当前服装的默认差分,摆法和立绘栏一样)、
 * 「手机竖屏」(画竖屏裁切框,左右拖改焦点);左下角是这张背景的默认 BGM(▶ 试听;游戏里不会换曲子的写「不换」)。
 * 包里的东西自己读写(useSceneAssets),每次改完经 PackSync 交给 DebugApp,这张卡绑着就同步进游戏。
 *
 * 外面按包换 key(<BackgroundPackEditor key={packId} …>)。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sceneFileUrl, sceneImageUrl, sceneThumbUrl, type SceneAsset } from '../../lib/api';
import { bgmPlayer, useBgm } from '../../vn/bgm';
import { Icon } from '../icons';
import { PlayButton, SoundBars } from '../PlayButton';
import { StagePreview, type StagePreviewSprite } from '../preview/StagePreview';
import type { Notify, PackSync } from '../types';
import { Btn, Inspector } from '../ui';
import { BackgroundInspector } from './BackgroundInspector';
import { bgmTag, defaultBgmOptions, sharedDeleteNote, type BgmChoice, type BgmTag } from './sceneEdit';
import { SCENE_ACCEPT, UPLOAD_STATE, useSceneAssets, type SceneUploadTile } from './useSceneAssets';

/** 舞台右上角两个开关:这次打开调试台里一直记着(换包、换栏回来还是原样) */
const stagePrefs = { sprite: true, phone: true };

export interface BackgroundPackEditorProps {
  packId: string;
  /** 主区顶上那一行(卡编辑器:类型小牌子 + 包页签 + ⋯;素材管理:包名、用量、绑定) */
  header: ReactNode;
  /** 默认 BGM 能选的曲子(卡编辑器:这张卡 BGM 栏绑的全部曲子);游戏里切到背景时只会换成这里面的 */
  bgmChoices: readonly BgmChoice[];
  /** 右栏「默认 BGM」下面那行说明 */
  bgmNote?: ReactNode;
  /** 「叠上立绘」叠的那张(当前服装的默认差分);不给就没有这个开关 */
  sprite?: StagePreviewSprite | null;
  /** 绑着这个包的卡有几张(两张以上删背景前要确认) */
  cardCount?: number;
  sync: PackSync;
  notify: Notify;
  /** 一进来就上传这些图(「上传图片新建一套」建好包以后交过来);nonce 变了才算新的一批 */
  incoming?: { nonce: number; files: File[] } | null;
  onIncomingTaken?: () => void;
  /** 列表变了:包页签的张数、缩略图跟着换 */
  onAssets?: (packId: string, list: SceneAsset[]) => void;
}

export function BackgroundPackEditor({
  packId,
  header,
  bgmChoices,
  bgmNote,
  sprite,
  cardCount,
  sync,
  notify,
  incoming,
  onIncomingTaken,
  onAssets,
}: BackgroundPackEditorProps) {
  const ops = useSceneAssets({ packId, kind: 'bg', sync, notify, incoming, onIncomingTaken, onAssets });
  const { list, items, selected } = ops;

  // ---- 舞台开关 ----
  const [showSprite, setShowSprite] = useState(stagePrefs.sprite);
  const [phone, setPhone] = useState(stagePrefs.phone);
  const toggleSprite = () => setShowSprite((v) => (stagePrefs.sprite = !v));
  const togglePhone = () => setPhone((v) => (stagePrefs.phone = !v));

  // ---- 焦点:拖的时候只改这里(舞台、滑块跟手),松手再写库 ----
  const [focusDraft, setFocusDraft] = useState<{ id: string; v: number } | null>(null);
  const focus = selected ? (focusDraft?.id === selected.id ? focusDraft.v : selected.focus_x) : 50;
  const changeFocus = (v: number, commit: boolean) => {
    if (!selected) return;
    const id = selected.id;
    if (!commit) {
      setFocusDraft({ id, v });
      return;
    }
    const next = Math.round(Math.min(100, Math.max(0, v)));
    setFocusDraft({ id, v: next });
    if (next === selected.focus_x) {
      setFocusDraft(null);
      return;
    }
    void ops.patch(id, { focus_x: next }).finally(() => setFocusDraft((d) => (d?.id === id ? null : d)));
  };

  // ---- 试听:舞台左下角(这张背景切过来时放的那首)、右栏(下拉里选的那首) ----
  const bgm = useBgm();
  const toggle = (url: string) => {
    if (bgm.preview === url) bgmPlayer.stopPreview();
    else bgmPlayer.startPreview(url);
  };
  // 离开这一栏、换包时停掉,还原成之前在放的
  useEffect(() => () => bgmPlayer.stopPreview(), []);

  // 这个包自己的曲子(BGM 栏没绑它时,默认 BGM 指着它们算「另一个包里的」,但名字、试听还是知道的)
  const ownTracks = useMemo(() => (list ?? []).filter((a) => a.kind === 'bgm'), [list]);
  const tagOf = (a: SceneAsset) => {
    const t = bgmTag(a, bgmChoices);
    // 指着这张卡没绑的曲子:是这个包自己的就写出曲名(游戏里还是不换)
    const own = t.state === 'foreign' ? ownTracks.find((x) => x.id === a.bgm_id) : undefined;
    return own ? { ...t, text: `${own.label}(没绑)` } : t;
  };

  // ---- 上传 ----
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const inputs = (
    <>
      <input
        ref={addInput}
        type="file"
        accept={SCENE_ACCEPT.bg}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void ops.addFiles(files);
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept={SCENE_ACCEPT.bg}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && selected) ops.replaceFile(selected.id, f);
        }}
      />
    </>
  );
  const pickFiles = () => addInput.current?.click();
  const uploading = ops.uploads.length > 0;

  // ---- 主区 ----
  const src = selected ? sceneImageUrl(selected) : null;
  const tag = selected ? tagOf(selected) : null;
  const chipUrl = tag?.state === 'ok' && tag.choice ? sceneFileUrl(tag.choice.asset) : null;
  const anyBgm = items.some((a) => a.bgm_id);

  const stage =
    list === null ? null : items.length === 0 && !uploading ? (
      <div className="st-empty">
        <span className="st-empty-icon">
          <Icon name="scene" size={26} />
        </span>
        <span className="st-empty-title">这套还没有背景</span>
        <span className="st-empty-note">一次选几张图上传,文件名就是背景名;横图(16:9)效果最好</span>
        <div className="st-empty-actions">
          <Btn icon="upload" onClick={pickFiles}>
            上传图片
          </Btn>
        </div>
      </div>
    ) : (
      <StagePreview
        background={src ? { src, focus } : null}
        sprite={showSprite && sprite ? sprite : null}
        editable={phone && src ? 'focus' : null}
        onFocus={changeFocus}
        badges={
          <span className="st-stage-toggles" role="group" aria-label="预览开关">
            {sprite && (
              <button type="button" className="st-stage-toggle" aria-pressed={showSprite} onClick={toggleSprite}>
                叠上立绘
              </button>
            )}
            <button type="button" className="st-stage-toggle" aria-pressed={phone} onClick={togglePhone}>
              手机竖屏
            </button>
          </span>
        }
        overlays={tag && <StageBgm tag={tag} url={chipUrl} playing={chipUrl !== null && bgm.preview === chipUrl} onToggle={toggle} />}
      />
    );

  // ---- 右栏 ----
  const chosenId = selected?.bgm_id ?? null;
  const chosen = chosenId
    ? (bgmChoices.find((c) => c.asset.id === chosenId)?.asset ?? ownTracks.find((t) => t.id === chosenId) ?? null)
    : null;
  const chosenUrl = chosen ? sceneFileUrl(chosen) : null;
  const foreignName = chosenId && !bgmChoices.some((c) => c.asset.id === chosenId) ? chosen?.label : undefined;

  return (
    <>
      <main className="st-main">
        {header}
        {stage}
        <div className="st-grid-head with-action">
          <span className="st-grid-title">背景</span>
          <span className="st-grid-note">
            {list === null
              ? '读取中…'
              : items.length === 0
                ? '还没有'
                : `${items.length} 张 · 点击编辑${anyBgm ? ' · ♪ 后面是这张的默认 BGM' : ''}`}
          </span>
          <span className="st-flex" />
          <Btn small icon="plus" onClick={pickFiles}>
            添加背景
          </Btn>
        </div>
        {list !== null && (items.length > 0 || uploading) && (
          <BackgroundGrid
            items={items}
            selectedId={selected?.id ?? null}
            defaultId={ops.defaultId}
            tagOf={tagOf}
            uploads={ops.uploads}
            onSelect={ops.setSelectedId}
          />
        )}
        {inputs}
      </main>

      {selected ? (
        <BackgroundInspector
          key={selected.id}
          asset={selected}
          index={items.indexOf(selected) + 1}
          total={items.length}
          isDefault={selected.id === ops.defaultId}
          busy={ops.busy}
          focus={focus}
          tag={tagOf(selected)}
          bgmOptions={defaultBgmOptions(bgmChoices, chosenId, foreignName)}
          bgmUrl={chosenUrl}
          bgmPlaying={chosenUrl !== null && bgm.preview === chosenUrl}
          bgmError={chosenUrl !== null && bgm.preview === chosenUrl ? bgm.error : null}
          bgmNote={bgmNote}
          deleteNote={sharedDeleteNote(cardCount, '张')}
          onToggleBgm={() => chosenUrl && toggle(chosenUrl)}
          onRename={(label) => ops.patch(selected.id, { label })}
          onPatch={(body) => void ops.patch(selected.id, body)}
          onMakeDefault={() => ops.makeDefault(selected.id)}
          onFocus={changeFocus}
          onReplace={() => replaceInput.current?.click()}
          onDelete={() => ops.remove(selected.id)}
        />
      ) : (
        <Inspector label="背景">
          <p className="st-inspector-hint">
            {list === null
              ? '读取中…'
              : '背景是对话时角色身后的场景。点「添加背景」一次选几张图上传,文件名就是背景名;传完点一张在这里改描述、别名、默认 BGM 和竖屏焦点。'}
          </p>
        </Inspector>
      )}
    </>
  );
}

/** 舞台左下角:这张背景的默认 BGM。游戏里切过来会换的才能试听,不会换的写「不换」 */
function StageBgm({
  tag,
  url,
  playing,
  onToggle,
}: {
  tag: BgmTag;
  url: string | null;
  playing: boolean;
  onToggle: (url: string) => void;
}) {
  const why =
    tag.state === 'off'
      ? `「${tag.text}」停用了或没传文件,游戏里切到这张背景时不换曲子`
      : tag.state === 'foreign'
        ? '设的曲子在这张卡没绑的包里,游戏里切到这张背景时不换曲子'
        : undefined;
  return (
    <div className={`st-stage-bgm${url ? '' : ' idle'}`} title={why}>
      {url && <PlayButton size={26} playing={playing} onClick={() => onToggle(url)} />}
      <Icon name="music" size={14} />
      <span className="st-stage-bgm-text">默认 BGM · {url ? tag.text : '不换'}</span>
      {url && <SoundBars playing={playing} />}
    </div>
  );
}

/** 背景网格:16:9 缩略图 + 名字 + 「♪ 默认 BGM」;排第一的(没停用的)★ = 默认背景;正在传的先占一格 */
function BackgroundGrid({
  items,
  selectedId,
  defaultId,
  tagOf,
  uploads,
  onSelect,
}: {
  items: readonly SceneAsset[];
  selectedId: string | null;
  defaultId: string | null;
  tagOf: (a: SceneAsset) => BgmTag;
  uploads: readonly SceneUploadTile[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="st-bgs" role="group" aria-label="背景">
      {items.map((a) => {
        const selected = a.id === selectedId;
        const thumb = sceneThumbUrl(a, 320);
        const t = tagOf(a);
        return (
          <button
            key={a.id}
            type="button"
            aria-pressed={selected}
            className={`st-bg-tile${selected ? ' selected' : ''}${a.enabled ? '' : ' off'}`}
            title={a.description || a.label}
            onClick={() => onSelect(a.id)}
          >
            <span className="st-bg-thumb">
              {thumb ? <img src={thumb} alt="" draggable={false} loading="lazy" /> : <Icon name="image" size={18} />}
              {a.id === defaultId && (
                <span className="st-face-badge star" title="默认背景:开场时用">
                  <Icon name="star" size={11} fill />
                </span>
              )}
              {!a.enabled && <span className="st-bg-flag">停用</span>}
            </span>
            <span className="st-bg-name">{a.label}</span>
            <span className={`st-bg-bgm ${t.state}`}>
              <Icon name="music" size={11} />
              <span>{t.state === 'off' ? `${t.text}(不放)` : t.text}</span>
            </span>
          </button>
        );
      })}
      {uploads.map((u) => (
        <div key={u.key} className={`st-bg-tile uploading ${u.state}`} aria-label={`${u.name}:${UPLOAD_STATE[u.state]}`}>
          <span className="st-bg-thumb">
            {u.url && <img src={u.url} alt="" draggable={false} />}
            <span className="st-face-progress">
              {u.state === 'up' ? <span className="spinner tiny" /> : u.state === 'fail' ? <Icon name="alert" size={16} /> : null}
              <span>{UPLOAD_STATE[u.state]}</span>
            </span>
          </span>
          <span className="st-bg-name">{u.name}</span>
          <span className="st-bg-bgm none">
            <Icon name="music" size={11} />
            <span>不换</span>
          </span>
        </div>
      ))}
    </div>
  );
}
