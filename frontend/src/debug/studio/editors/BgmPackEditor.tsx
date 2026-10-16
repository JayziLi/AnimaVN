/**
 * 一个场景包里「BGM」那一半的编辑器(没有画图,照背景栏的格局):主区 = 顶上那一行(外面给)+ 曲目表,
 * 右栏 = 选中那首。曲目表每行:▶ / ⏸ 试听、名字、别名、描述、封面曲 / 停用标记、被几张背景当默认、时长
 * (播放器解码过才知道,放过一次才显示)。
 *
 * 不依赖卡:卡编辑器的 BGM 栏和素材管理页都用它。封面曲记在包上,怎么改由外面给(卡编辑器走 useScenePlugin
 * 的 setTitleBgmOf,标题画面马上跟着换);「哪些背景切过来时放它」除了这个包自己的背景,还看外面给的那几个包
 * (背景的默认 BGM 可以指向别的包里的曲子)。
 *
 * 外面按包换 key(<BgmPackEditor key={packId} …>)。
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { sceneFileUrl, type SceneAsset } from '../../lib/api';
import { bgmPlayer, useBgm } from '../../vn/bgm';
import { Icon } from '../icons';
import { PlayButton } from '../PlayButton';
import type { Notify, PackSync } from '../types';
import { Btn, Chip, Inspector } from '../ui';
import { BgmInspector } from './BgmInspector';
import { coverTrack, defaultBgmUsers, formatDuration, sharedDeleteNote, type BgmUser } from './sceneEdit';
import { SCENE_ACCEPT, UPLOAD_STATE, useSceneAssets } from './useSceneAssets';

export interface BgmPackEditorProps {
  packId: string;
  /** 这个包的名字(「这些背景切过来时放它」里标背景在哪个包) */
  packName: string;
  /** 主区顶上那一行(卡编辑器:类型小牌子 + 包页签 + ⋯;素材管理:包名、用量、绑定) */
  header: ReactNode;
  /** 包上记的封面曲;null = 放排第一的那首 */
  titleBgmId: string | null;
  /** 改封面曲(null = 回到排第一的那首) */
  onTitleBgm: (bgmId: string | null) => void;
  /** 别的包里的背景(卡编辑器:这张卡背景栏绑的包):它们的默认 BGM 也可能是这里的曲子 */
  backgrounds?: readonly { packName: string; list: readonly SceneAsset[] }[];
  /** 绑着这个包的卡有几张(两张以上删曲子前要确认) */
  cardCount?: number;
  sync: PackSync;
  notify: Notify;
  /** 一进来就上传这些曲子(「上传曲子新建一套」建好包以后交过来);nonce 变了才算新的一批 */
  incoming?: { nonce: number; files: File[] } | null;
  onIncomingTaken?: () => void;
  /** 列表变了:包页签的首数跟着换 */
  onAssets?: (packId: string, list: SceneAsset[]) => void;
  /** 删了一首:别的包里把它当默认 BGM 的背景后端也清掉了,外面照着改手上的列表 */
  onRemoved?: (assetId: string) => void;
}

const NO_USERS: readonly BgmUser[] = [];

export function BgmPackEditor({
  packId,
  packName,
  header,
  titleBgmId,
  onTitleBgm,
  backgrounds,
  cardCount,
  sync,
  notify,
  incoming,
  onIncomingTaken,
  onAssets,
  onRemoved,
}: BgmPackEditorProps) {
  const ops = useSceneAssets({ packId, kind: 'bgm', sync, notify, incoming, onIncomingTaken, onAssets, onRemoved });
  const { list, items, selected } = ops;

  // ---- 试听 ----
  const bgm = useBgm();
  const toggle = (url: string) => {
    if (bgm.preview === url) bgmPlayer.stopPreview();
    else bgmPlayer.startPreview(url);
  };
  // 离开这一栏、换包时停掉,还原成之前在放的
  useEffect(() => () => bgmPlayer.stopPreview(), []);

  // ---- 算出来的 ----
  const users = useMemo(
    () => defaultBgmUsers([...(backgrounds ?? []), { packName, list: list ?? [] }]),
    [backgrounds, packName, list],
  );
  const cover = coverTrack(items, titleBgmId);

  // ---- 上传 ----
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const pickFiles = () => addInput.current?.click();
  const uploading = ops.uploads.length > 0;

  return (
    <>
      <main className="st-main">
        {header}
        <section className="st-tracks" aria-label="曲子">
          <div className="st-grid-head with-action st-tracks-head">
            <span className="st-grid-title">曲子</span>
            <span className="st-grid-note">
              {list === null ? '读取中…' : items.length === 0 ? '还没有' : `${items.length} 首 · 点击编辑 · ▶ 试听`}
            </span>
            <span className="st-flex" />
            <Btn small icon="plus" onClick={pickFiles}>
              添加曲子
            </Btn>
          </div>
          {items.map((a, i) => {
            const url = sceneFileUrl(a);
            const on = url !== null && bgm.preview === url;
            const used = users.get(a.id) ?? NO_USERS;
            const isCover = cover?.id === a.id;
            const sel = a.id === selected?.id;
            return (
              <div
                key={a.id}
                className={`st-track${sel ? ' selected' : ''}${a.enabled ? '' : ' off'}`}
                onClick={() => ops.setSelectedId(a.id)}
              >
                <PlayButton
                  kind="ghost"
                  size={28}
                  playing={on}
                  disabled={!url}
                  label={url ? undefined : '还没传文件'}
                  onClick={() => url && toggle(url)}
                />
                <button
                  type="button"
                  className="st-track-name"
                  aria-pressed={sel}
                  title={a.description || a.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    ops.setSelectedId(a.id);
                  }}
                >
                  <span className="st-track-index">{i + 1}</span>
                  <span className="st-track-label">{a.label}</span>
                </button>
                <span className="st-track-aliases">
                  {a.aliases.length > 0 ? a.aliases.slice(0, 3).map((x) => <span key={x} className="st-track-alias">{x}</span>) : '—'}
                  {a.aliases.length > 3 && <span className="st-track-more">+{a.aliases.length - 3}</span>}
                </span>
                <span className="st-track-desc">{a.description || (a.has_file ? '' : '还没传文件')}</span>
                <span className="st-track-marks">
                  {isCover && cover && (
                    <span title={cover.explicit ? '标题画面放这首' : '没选封面曲:标题画面放排第一的这首'}>
                      <Chip strong={cover.explicit}>{cover.explicit ? '封面曲' : '封面曲 · 排第一'}</Chip>
                    </span>
                  )}
                  {!a.enabled && <Chip>停用</Chip>}
                  {used.length > 0 && (
                    <span className="st-track-used" title={used.map((u) => u.label).join('、')}>
                      被 {used.length} 张背景用作默认
                    </span>
                  )}
                </span>
                <span className="st-track-time">{url ? formatDuration(bgm.durations[url]) : ''}</span>
              </div>
            );
          })}
          {ops.uploads.map((u) => (
            <div key={u.key} className={`st-track uploading ${u.state}`} aria-label={`${u.name}:${UPLOAD_STATE[u.state]}`}>
              <span className="st-track-spin">
                {u.state === 'up' ? <span className="spinner tiny" /> : u.state === 'fail' ? <Icon name="alert" size={15} /> : null}
              </span>
              <span className="st-track-name static">
                <span className="st-track-label">{u.name}</span>
              </span>
              <span className="st-track-desc">{UPLOAD_STATE[u.state]}</span>
            </div>
          ))}
          {list !== null && items.length === 0 && !uploading && (
            <div className="st-tracks-empty">
              <span>这套还没有曲子 · 一次选几首上传,文件名就是曲名</span>
              <Btn small icon="upload" onClick={pickFiles}>
                上传曲子
              </Btn>
            </div>
          )}
        </section>
        <p className="st-tracks-tip">
          按气氛起名(日常、温馨、紧张、伤感…),AI 看名字和描述挑曲子;真正的曲名写在描述里。建议用 MP3,iPhone 放不了 OGG。
        </p>
        <input
          ref={addInput}
          type="file"
          accept={SCENE_ACCEPT.bgm}
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
          accept={SCENE_ACCEPT.bgm}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f && selected) ops.replaceFile(selected.id, f);
          }}
        />
      </main>

      {selected ? (
        (() => {
          const url = sceneFileUrl(selected);
          const on = url !== null && bgm.preview === url;
          const coverName = cover?.explicit ? items.find((t) => t.id === cover.id)?.label : undefined;
          return (
            <BgmInspector
              key={selected.id}
              asset={selected}
              index={items.indexOf(selected) + 1}
              total={items.length}
              cover={cover?.id === selected.id ? cover : null}
              otherCover={cover?.explicit && cover.id !== selected.id ? (coverName ?? null) : null}
              playing={on}
              error={on ? bgm.error : null}
              duration={url ? formatDuration(bgm.durations[url]) : ''}
              users={users.get(selected.id) ?? NO_USERS}
              deleteNote={sharedDeleteNote(cardCount, '首')}
              onToggle={() => url && toggle(url)}
              onRename={(label) => ops.patch(selected.id, { label })}
              onPatch={(body) => void ops.patch(selected.id, body)}
              onCover={(on) => onTitleBgm(on ? selected.id : null)}
              onReplace={() => replaceInput.current?.click()}
              onDelete={() => ops.remove(selected.id)}
            />
          );
        })()
      ) : (
        <Inspector label="曲子">
          <p className="st-inspector-hint">
            {list === null
              ? '读取中…'
              : 'BGM 是对话时放的背景音乐。点「添加曲子」一次选几首上传,文件名就是曲名;传完点一首在这里改描述、别名,设成标题画面的封面曲。'}
          </p>
        </Inspector>
      )}
    </>
  );
}
