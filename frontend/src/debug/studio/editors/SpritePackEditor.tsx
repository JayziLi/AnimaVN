/**
 * 一套立绘(立绘包)的编辑器:主区 = 顶上那一行(外面给)+ 实机预览舞台 + 表情差分网格,右栏 = 选中那张差分。
 * 不依赖卡:卡编辑器的立绘栏和素材管理页都用它,卡相关的东西(包页签、背景下拉、台词)由外面给。
 *
 * 包里的东西自己读写(差分列表、位置);每次改完把新列表经 PackSync 交给 DebugApp —— 是哪张卡的当前服装,
 * 游戏里马上换上。位置和插件页一样:先改内存、停手 400ms 再写库,换包 / 关掉时没写的立刻写。
 *
 * 外面用的时候按包换 key(<SpritePackEditor key={packId} …>),换一套立绘就是一个新的编辑器。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  debugApi,
  spriteImageUrl,
  type PackSprite,
  type SpriteEffect,
  type SpriteLayout,
  type SpritePayload,
} from '../../lib/api';
import { labelFromFile, uniqueLabel } from '../../lib/assetNames';
import { DEFAULT_SPRITE_LAYOUT, facesByCanvas, type SpriteStage } from '../../plugins/spriteLayout';
import { audioBus } from '../../vn/audioBus';
import { greetingLine } from '../cardInfo';
import { Stage } from '../../vn/ui/Stage';
import type { Notify, PackSync } from '../types';
import { Inspector } from '../ui';
import { SpriteFaceGrid, type UploadTile } from './SpriteFaceGrid';
import { SpriteInspector } from './SpriteInspector';
import { defaultSpriteId, selectAfterDelete } from './spriteEdit';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 立绘能用的图(和后端 sniff_image_mime 认的一样) */
export const SPRITE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const isImage = (f: File) => /^image\/(png|jpeg|webp|gif)$/.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name);

/** 每个包最多自动补一次找脸(和 useSpriteLayout 一样:服务器找不了的话,别每次打开都再问) */
const scanTried = new Set<string>();

export interface SpritePackEditorProps {
  packId: string;
  /** 主区顶上那一行(卡编辑器:类型小牌子 + 包下拉框 + ⋯;素材管理:包名、用量、在用的卡) */
  header: ReactNode;
  /** 所有角色共用的构图(useSpriteLayout 的 stage) */
  stage: SpriteStage;
  /** 舞台背景;null = 黑底 */
  previewBackground: { src: string; focus: number } | null;
  /** 舞台右上角那一排(背景下拉) */
  previewBadges?: ReactNode;
  /** 对话框:说话人 + 台词;台词空的时候用选中差分的描述,也没有就不出对话框 */
  previewLine: { speaker: string; text: string } | null;
  /** 绑着这套立绘的卡有几张(右栏「位置」的说明里写) */
  cardCount?: number;
  sync: PackSync;
  notify: Notify;
  /** 一进来就上传这些图(「上传图片新建一套」建好包以后交过来);nonce 变了才算新的一批 */
  incoming?: { nonce: number; files: File[] } | null;
  /** 收下了 incoming 那一批(开始传了):外面把它清掉,再切回这一套时不会重传 */
  onIncomingTaken?: () => void;
  /** 列表变了(张数、第一张):包页签的张数、小头像跟着换 */
  onSprites?: (packId: string, list: PackSprite[]) => void;
}

export function SpritePackEditor({
  packId,
  header,
  stage,
  previewBackground,
  previewBadges,
  previewLine,
  cardCount,
  sync,
  notify,
  incoming,
  onIncomingTaken,
  onSprites,
}: SpritePackEditorProps) {
  const [sprites, setSprites] = useState<PackSprite[] | null>(null);
  const [layout, setLayout] = useState<SpriteLayout>(DEFAULT_SPRITE_LAYOUT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadTile[]>([]);
  const [reordering, setReordering] = useState(false);
  const [playKey, setPlayKey] = useState(0);

  // 回调里要最新的列表和外面给的函数(上传是一张张接着传的,中间列表一直在变)
  const latest = useRef<PackSprite[]>([]);
  const outer = useRef({ sync, onSprites, notify });
  useEffect(() => {
    outer.current = { sync, onSprites, notify };
  });

  /** 收下新列表:自己显示、交给 DebugApp(当前服装就同步进游戏)、告诉外面 */
  const commit = useCallback(
    (list: PackSprite[]) => {
      latest.current = list;
      setSprites(list);
      outer.current.sync.sprites(packId, list);
      outer.current.onSprites?.(packId, list);
    },
    [packId],
  );

  const reload = useCallback(async () => {
    try {
      commit(await debugApi.listSprites(packId));
    } catch {
      // 读不到就留着现在的;出错的那一下已经报过了
    }
  }, [commit, packId]);

  /** 跑一个改后端的操作;失败了报错、重新读一遍列表(本地可能已经先改了) */
  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      try {
        await fn();
        return true;
      } catch (e) {
        outer.current.notify('error', errText(e));
        await reload();
        return false;
      }
    },
    [reload],
  );

  // ---- 位置:先改内存,停手 400ms 写库 ----
  const layoutRef = useRef<SpriteLayout>(DEFAULT_SPRITE_LAYOUT);
  const layoutTimer = useRef<number | null>(null);
  const flushLayout = useCallback(() => {
    if (layoutTimer.current === null) return;
    window.clearTimeout(layoutTimer.current);
    layoutTimer.current = null;
    debugApi
      .putSpriteLayout(packId, layoutRef.current)
      .catch((e: unknown) => outer.current.notify('error', `立绘位置保存失败: ${errText(e)}`));
  }, [packId]);
  // 关掉、换包时没写的立刻写
  useEffect(() => flushLayout, [flushLayout]);
  const changeLayout = (next: SpriteLayout) => {
    layoutRef.current = next;
    setLayout(next);
    outer.current.sync.layout(packId, next);
    if (layoutTimer.current !== null) window.clearTimeout(layoutTimer.current);
    layoutTimer.current = window.setTimeout(flushLayout, 400);
  };

  // ---- 读进来 ----
  useEffect(() => {
    let alive = true;
    Promise.all([debugApi.listSprites(packId), debugApi.getSpriteLayout(packId)])
      .then(async ([list, l]) => {
        if (!alive) return;
        latest.current = list;
        setSprites(list);
        setLayout(l);
        layoutRef.current = l;
        setSelectedId(defaultSpriteId(list) ?? list[0]?.id ?? null);
        // 老立绘(或上传时服务器还没装 OpenCV)没找过脸:补一次
        if (!scanTried.has(packId) && list.some((s) => s.has_image && s.face_scan === null)) {
          scanTried.add(packId);
          try {
            const scanned = await debugApi.scanSpriteFaces(packId, false);
            if (alive) commit(scanned);
          } catch {
            // 找不了脸(没装 OpenCV)就按撑满高度摆,不打扰
          }
        }
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setSprites([]);
        outer.current.notify('error', `立绘读取失败: ${errText(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [packId, commit]);

  // ---- 差分 ----
  const replaceRow = (row: PackSprite) => commit(latest.current.map((s) => (s.id === row.id ? row : s)));

  const patch = (id: string, body: SpritePayload) =>
    run(async () => replaceRow(await debugApi.updateSprite(packId, id, body)));

  const rename = (id: string, label: string) => patch(id, { label });

  /** 入场动效:存完在舞台上放一次(选下拉也是点了一下,顺手解锁声音) */
  const setEffect = async (id: string, effect: SpriteEffect | null) => {
    audioBus.unlock();
    if ((await patch(id, { effect })) && effect) setPlayKey((k) => k + 1);
  };

  const preview = () => {
    audioBus.unlock();
    setPlayKey((k) => k + 1);
  };

  /** 点一张差分:舞台换成这一张,它设了入场动效的话顺手放一次(没设就只是换一张;点一下也顺手解锁声音) */
  const pick = (id: string) => {
    audioBus.unlock();
    setSelectedId(id);
    setPlayKey((k) => k + 1);
  };

  const reorder = (ids: string[]) => {
    const byId = new Map(latest.current.map((s) => [s.id, s]));
    const optimistic = ids.map((id) => byId.get(id)).filter((s): s is PackSprite => Boolean(s));
    // 先按新顺序摆上,存完以后以后端回来的为准
    setSprites(optimistic);
    latest.current = optimistic;
    setReordering(true);
    void run(async () => commit(await debugApi.reorderSprites(packId, ids))).finally(() => setReordering(false));
  };

  const makeDefault = (id: string) => reorder([id, ...latest.current.map((s) => s.id).filter((x) => x !== id)]);

  const remove = (id: string) =>
    void run(async () => {
      await debugApi.deleteSprite(packId, id);
      const ids = latest.current.map((s) => s.id);
      commit(latest.current.filter((s) => s.id !== id));
      setSelectedId(selectAfterDelete(ids, id));
      outer.current.sync.packs('sprite');
    });

  // ---- 上传:添加差分(多张)、替换图片(一张) ----
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter(isImage);
      if (images.length === 0) {
        outer.current.notify('error', '只支持 PNG / JPEG / WebP / GIF 图片');
        return;
      }
      const stamp = Date.now();
      const batch = images.map((file, i) => ({
        file,
        tile: { key: `${stamp}-${i}`, name: labelFromFile(file.name) || '差分', url: URL.createObjectURL(file), state: 'wait' as const },
      }));
      setUploads((u) => [...u, ...batch.map((b) => b.tile)]);
      const mark = (key: string, state: UploadTile['state']) =>
        setUploads((u) => u.map((t) => (t.key === key ? { ...t, state } : t)));
      const drop = (keys: string[]) => setUploads((u) => u.filter((t) => !keys.includes(t.key)));

      // 已经占用的名字(含别名),新的避开:微笑、微笑2…
      const taken = new Set(latest.current.flatMap((s) => [s.label, ...s.aliases]).map((n) => n.toLowerCase()));
      const failed: { tile: UploadTile; name: string }[] = [];
      let lastError = '';
      for (const { file, tile } of batch) {
        mark(tile.key, 'up');
        let created: PackSprite | null = null;
        try {
          created = await debugApi.createSprite(packId, { label: uniqueLabel(labelFromFile(file.name), '差分', taken) });
          const row = await debugApi.uploadSpriteImage(packId, created.id, file);
          commit([...latest.current, row]);
          drop([tile.key]);
          URL.revokeObjectURL(tile.url);
        } catch (e) {
          lastError = errText(e);
          failed.push({ tile, name: file.name });
          mark(tile.key, 'fail');
          // 建好了行、图没传上:别留一张空的
          if (created) await debugApi.deleteSprite(packId, created.id).catch(() => undefined);
        }
      }
      await reload();
      outer.current.sync.packs('sprite');
      const done = batch.length - failed.length;
      if (failed.length === 0) {
        outer.current.notify('ok', `已添加 ${done} 张差分 · 名字用的是文件名,改成 AI 好懂的词更准`);
      } else {
        const names = failed.map((f) => f.name);
        outer.current.notify(
          'error',
          `${done ? `传上了 ${done} 张;` : ''}${names.slice(0, 3).join('、')}${names.length > 3 ? ` 等 ${names.length} 张` : ''}没传上:${lastError}`,
        );
        window.setTimeout(() => {
          drop(failed.map((f) => f.tile.key));
          failed.forEach((f) => URL.revokeObjectURL(f.tile.url));
        }, 5000);
      }
    },
    [commit, packId, reload],
  );

  // 外面交过来的一批(新建一套时选的图):读完列表再传,一批只传一次(开发模式下 effect 会跑两遍)
  const handled = useRef<number | null>(null);
  const takenRef = useRef(onIncomingTaken);
  useEffect(() => {
    takenRef.current = onIncomingTaken;
  });
  const loaded = sprites !== null;
  useEffect(() => {
    if (!incoming || !loaded || handled.current === incoming.nonce) return;
    handled.current = incoming.nonce;
    takenRef.current?.();
    void addFiles(incoming.files);
  }, [incoming, loaded, addFiles]);

  const replaceImage = (id: string, file: File) =>
    void run(async () => replaceRow(await debugApi.uploadSpriteImage(packId, id, file)));

  // ---- 算出来的 ----
  const list = sprites ?? [];
  const faces = useMemo(() => facesByCanvas(sprites ?? []), [sprites]);
  const selected = list.find((s) => s.id === selectedId) ?? list[0] ?? null;
  const defaultId = defaultSpriteId(list);
  const src = selected ? spriteImageUrl(selected) : null;
  // 没有开场白可用时拿差分的说明当台词:里面的 {{char}} / {{user}} 也要换掉,别原样露出来
  const lineText =
    previewLine?.text ||
    (selected?.description ? greetingLine({ name: previewLine?.speaker ?? '', first_mes: selected.description }, '你') : '');
  const line = previewLine && lineText ? { speaker: previewLine.speaker, text: lineText } : null;
  const anyFx = list.some((s) => s.effect && (s.effect.motion || s.effect.bubble || s.effect.sound));
  const noFaces = list.some((s) => s.has_image) && faces.size === 0;

  return (
    <>
      <main className="st-main">
        {header}
        <Stage
          background={previewBackground}
          sprite={
            selected && src
              ? {
                  src,
                  face: faces.get(selected.id) ?? null,
                  layout,
                  stage,
                  effect: selected.effect,
                  playKey,
                }
              : null
          }
          line={line}
          editable="sprite"
          onLayout={(next) => changeLayout(next)}
          badges={previewBadges}
        />
        <div className="st-grid-head">
          <span className="st-grid-title">表情差分</span>
          <span className="st-grid-note">
            {sprites === null
              ? '读取中…'
              : list.length === 0
                ? '还没有 · 文件名就是差分名,比如 微笑.png'
                : `${list.length} 张 · 点击编辑 · 拖动排序${anyFx ? ' · ✦ = 设了入场动效' : ''}`}
          </span>
        </div>
        {sprites !== null && (
          <SpriteFaceGrid
            sprites={list}
            faces={faces}
            selectedId={selected?.id ?? null}
            onSelect={pick}
            onReorder={reorder}
            uploads={uploads}
            onAdd={() => addInput.current?.click()}
            locked={reordering || uploads.length > 0}
          />
        )}
        <input
          ref={addInput}
          type="file"
          accept={SPRITE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void addFiles(files);
          }}
        />
        <input
          ref={replaceInput}
          type="file"
          accept={SPRITE_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f && selected) replaceImage(selected.id, f);
          }}
        />
      </main>

      {selected ? (
        <SpriteInspector
          sprite={selected}
          face={faces.get(selected.id) ?? null}
          index={list.indexOf(selected) + 1}
          total={list.length}
          isDefault={selected.id === defaultId}
          layout={layout}
          noFaces={noFaces}
          cardCount={cardCount}
          onRename={(label) => rename(selected.id, label)}
          onPatch={(body) => void patch(selected.id, body)}
          onEffect={(fx) => void setEffect(selected.id, fx)}
          onPreview={preview}
          onMakeDefault={() => makeDefault(selected.id)}
          onLayout={changeLayout}
          onReplace={() => replaceInput.current?.click()}
          onDelete={() => remove(selected.id)}
        />
      ) : (
        <Inspector label="差分">
          <p className="st-inspector-hint">
            {sprites === null
              ? '读取中…'
              : '这套立绘还没有差分。点「添加差分」一次选几张图上传,文件名就是差分名;传完点一张在这里改描述、别名、入场动效和位置。'}
          </p>
        </Inspector>
      )}
    </>
  );
}
