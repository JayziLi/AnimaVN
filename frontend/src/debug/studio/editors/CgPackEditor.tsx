/**
 * 一个 CG 包(导入的现成 CG)的编辑器:主区 = 顶上那一行(外面给)+ 实机预览舞台 + 构图网格,
 * 右栏 = 选中的那张构图(CgInspector)。不依赖卡:卡编辑器的 CG 栏和素材管理页都用它,
 * 卡相关的东西(包页签、⋯、当前服装的差分名)由外面给。
 *
 * 舞台照游戏里摆:选中的构图(在右栏点了一张表情差分就换成那张)裁满整块(cover),焦点用构图的;
 * 对话框是一句旁白(构图描述截短)。右上角「手机竖屏」打开竖屏框,拖右栏的焦点滑块时也临时画出来。
 *
 * 包里的东西自己读写(/api/cg-packs/{id}/assets…);每次改完把整份列表经 PackSync.scene 交给 DebugApp ——
 * 当前卡绑着这个包的话,游戏里马上换上。外面按包换 key(<CgPackEditor key={packId} …>)。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { debugApi, sceneImageUrl, type SceneAsset, type SceneAssetPatch } from '../../lib/api';
import { labelFromFile, uniqueLabel } from '../../lib/assetNames';
import { cgForms } from '../../plugins/forms';
import { cgsOf } from '../../plugins/scene';
import { Icon } from '../icons';
import { Stage } from '../../vn/ui/Stage';
import type { Notify, PackSync } from '../types';
import { ConfirmDialog, Inspector, PromptDialog } from '../ui';
import {
  cgNarration,
  freeEmotions,
  groupCgs,
  orderCgs,
  replaceRows,
  resolvePick,
  stageFrameOf,
  takenNames,
  variantPromptLabel,
  withoutCg,
  type CgPick,
} from './cgEdit';
import { CgGrid } from './CgGrid';
import { CgInspector } from './CgInspector';
import type { UploadTile } from './SpriteFaceGrid';
import { selectAfterDelete } from './spriteEdit';
import './cgPackEditor.css';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** CG 能用的图(和后端 sniff_image_mime 认的一样) */
export const CG_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const isImage = (f: File) => /^image\/(png|jpeg|webp|gif)$/.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name);

/** 拖完焦点滑块以后竖屏框再留多久 */
const BAND_LINGER_MS = 1500;

const NO_EMOTIONS: readonly string[] = [];

type VariantUpload = UploadTile & { cgId: string };

type Dialog =
  | { kind: 'delete'; id: string }
  | { kind: 'variant'; cgId: string; file: File }
  | null;

export interface CgPackEditorProps {
  packId: string;
  /** 主区顶上那一行(卡编辑器:类型小牌子 + 包下拉框 + ⋯;素材管理:包名、用量、在用的卡) */
  header: ReactNode;
  /** 绑着这个包的卡有几张:两张以上,删构图前弹确认框写出来 */
  cardCount?: number;
  /** 当前服装启用的差分名:差分对不对得上、还缺哪些表情、形态编辑器用不用得上。素材管理页不带卡时不给 */
  emotions?: readonly string[];
  sync: PackSync;
  notify: Notify;
  /** 一进来就当构图上传这些图(「上传图片新建一个 CG 包」建好包以后交过来);nonce 变了才算新的一批 */
  incoming?: { nonce: number; files: File[] } | null;
  /** 收下了 incoming 那一批(开始传了):外面把它清掉,再切回这个包时不会重传 */
  onIncomingTaken?: () => void;
  /** 列表变了(构图张数、第一张):包页签的张数、缩略图跟着换 */
  onAssets?: (packId: string, list: SceneAsset[]) => void;
}

export function CgPackEditor({
  packId,
  header,
  cardCount = 0,
  emotions = NO_EMOTIONS,
  sync,
  notify,
  incoming,
  onIncomingTaken,
  onAssets,
}: CgPackEditorProps) {
  const [list, setList] = useState<SceneAsset[] | null>(null);
  const [pick, setPick] = useState<CgPick | null>(null);
  const [uploads, setUploads] = useState<UploadTile[]>([]);
  const [variantUploads, setVariantUploads] = useState<VariantUpload[]>([]);
  const [reordering, setReordering] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  // 竖屏框:右上角开关常开,或者正在拖焦点滑块
  const [phone, setPhone] = useState(false);
  const [focusing, setFocusing] = useState(false);

  // 回调里要最新的列表和外面给的函数(上传是一张张接着传的,中间列表一直在变)
  const latest = useRef<SceneAsset[]>([]);
  const outer = useRef({ sync, onAssets, notify });
  useEffect(() => {
    outer.current = { sync, onAssets, notify };
  });

  /** 收下新列表:自己显示、交给 DebugApp(绑着的包就同步进游戏)、告诉外面 */
  const commit = useCallback(
    (next: SceneAsset[]) => {
      latest.current = next;
      setList(next);
      outer.current.sync.scene(packId, next);
      outer.current.onAssets?.(packId, next);
    },
    [packId],
  );

  const reload = useCallback(async () => {
    try {
      commit(await debugApi.listCgAssets(packId));
    } catch {
      // 读不到就留着现在的;出错的那一下已经报过了
    }
  }, [commit, packId]);

  /** 跑一个改后端的操作;失败了报后端的原话(重名、名字不合规这类)、重新读一遍列表(本地可能已经先改了) */
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

  // ---- 读进来 ----
  useEffect(() => {
    let alive = true;
    debugApi
      .listCgAssets(packId)
      .then((rows) => {
        if (!alive) return;
        latest.current = rows;
        setList(rows);
        outer.current.onAssets?.(packId, rows);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setList([]);
        outer.current.notify('error', `CG 读取失败: ${errText(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [packId]);

  // ---- 焦点:拖的时候只改本地(舞台跟手);松手(方向键每按一下也算)后停手 400ms 再写库,
  //      和立绘位置一样 —— 连按方向键不会一下发十几个请求、回来的先后乱了也不会退回旧值 ----
  const bandTimer = useRef<number | null>(null);
  const focusTimer = useRef<number | null>(null);
  const focusPending = useRef<{ id: string; x: number } | null>(null);
  /** 后端回来的几行换进列表;焦点还有没存的那张,留着本地的(不然回来的旧值会把滑块拽回去) */
  const adopt = useCallback(
    (rows: SceneAsset[], base: SceneAsset[] = latest.current) => {
      const p = focusPending.current;
      commit(replaceRows(base, rows.map((r) => (p && p.id === r.id ? { ...r, focus_x: p.x } : r))));
    },
    [commit],
  );

  const flushFocus = useCallback(() => {
    if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
    focusTimer.current = null;
    const pending = focusPending.current;
    focusPending.current = null;
    if (!pending) return;
    debugApi
      .updateCgAsset(packId, pending.id, { focus_x: pending.x })
      // 存的时候又拖过了:adopt 留着本地新的那个(下一次会再存)
      .then((row) => adopt([row]))
      .catch((e: unknown) => {
        outer.current.notify('error', `焦点保存失败: ${errText(e)}`);
        void reload();
      });
  }, [adopt, packId, reload]);
  // 关掉、换包时没写的立刻写
  useEffect(() => flushFocus, [flushFocus]);
  useEffect(
    () => () => {
      if (bandTimer.current !== null) window.clearTimeout(bandTimer.current);
    },
    [],
  );
  const setFocus = (cgId: string, v: number, done: boolean) => {
    const x = Math.min(100, Math.max(0, Math.round(v)));
    const local = latest.current.map((a) => (a.id === cgId ? { ...a, focus_x: x } : a));
    latest.current = local;
    setList(local);
    setFocusing(true);
    if (bandTimer.current !== null) window.clearTimeout(bandTimer.current);
    bandTimer.current = null;
    if (!done) return;
    bandTimer.current = window.setTimeout(() => setFocusing(false), BAND_LINGER_MS);
    // 换了一张构图还没存的,先存掉
    if (focusPending.current && focusPending.current.id !== cgId) flushFocus();
    focusPending.current = { id: cgId, x };
    if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(flushFocus, 400);
  };

  // ---- 改一张(构图或差分) ----
  const patch = (id: string, body: SceneAssetPatch) =>
    run(async () => adopt([await debugApi.updateCgAsset(packId, id, body)]));

  // ---- 排序、删除 ----
  const reorder = (ids: string[]) => {
    // 先按新顺序摆上,存完以后以后端回来的为准(后端只回构图,差分照旧跟在各自的构图后面)
    const optimistic = orderCgs(latest.current, ids);
    latest.current = optimistic;
    setList(optimistic);
    setReordering(true);
    void run(async () => {
      const rows = await debugApi.reorderCgAssets(packId, ids);
      adopt(rows, orderCgs(latest.current, ids));
    }).finally(() => setReordering(false));
  };

  const removeCg = (id: string) =>
    void run(async () => {
      // 删的这张还有没存的焦点:不用存了
      if (focusPending.current?.id === id) focusPending.current = null;
      const order = cgsOf(latest.current).map((a) => a.id);
      await debugApi.deleteCgAsset(packId, id);
      commit(withoutCg(latest.current, id));
      const next = selectAfterDelete(order, id);
      setPick(next ? { cgId: next, variantId: null } : null);
      outer.current.sync.packs('cg');
    });

  const removeVariant = (cgId: string, id: string) =>
    void run(async () => {
      await debugApi.deleteCgAsset(packId, id);
      commit(withoutCg(latest.current, id));
      setPick({ cgId, variantId: null });
    });

  // ---- 上传:添加构图(多张)、添加差分(一张 + 填名字)、替换图片(一张) ----
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const variantInput = useRef<HTMLInputElement>(null);
  const variantFor = useRef<string | null>(null);

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
        tile: { key: `${stamp}-${i}`, name: labelFromFile(file.name) || 'CG', url: URL.createObjectURL(file), state: 'wait' as const },
      }));
      setUploads((u) => [...u, ...batch.map((b) => b.tile)]);
      const mark = (key: string, state: UploadTile['state']) =>
        setUploads((u) => u.map((t) => (t.key === key ? { ...t, state } : t)));
      const drop = (keys: string[]) => setUploads((u) => u.filter((t) => !keys.includes(t.key)));

      // 构图只和构图比名字(差分是另一组),撞了加数字:海边、海边2…
      const taken = takenNames(latest.current, null);
      const failed: { tile: UploadTile; name: string }[] = [];
      let firstNew: string | null = null;
      let lastError = '';
      for (const { file, tile } of batch) {
        mark(tile.key, 'up');
        let created: SceneAsset | null = null;
        try {
          created = await debugApi.createCgAsset(packId, { label: uniqueLabel(labelFromFile(file.name), 'CG', taken) });
          const row = await debugApi.uploadCgFile(packId, created.id, file);
          commit([...latest.current, row]);
          firstNew ??= row.id;
          drop([tile.key]);
          URL.revokeObjectURL(tile.url);
        } catch (e) {
          lastError = errText(e);
          failed.push({ tile, name: file.name });
          mark(tile.key, 'fail');
          // 建好了行、图没传上:别留一张空的
          if (created) await debugApi.deleteCgAsset(packId, created.id).catch(() => undefined);
        }
      }
      await reload();
      outer.current.sync.packs('cg');
      // 传完选中第一张新的,接着就能写描述
      if (firstNew) setPick({ cgId: firstNew, variantId: null });
      const done = batch.length - failed.length;
      if (failed.length === 0) {
        outer.current.notify('ok', `已添加 ${done} 张构图 · 名字用的是文件名,改成 AI 好懂的词、写上描述更准`);
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

  const addVariant = async (cgId: string, file: File, label: string) => {
    setDialog(null);
    const tile: VariantUpload = { key: `v${Date.now()}`, cgId, name: label, url: URL.createObjectURL(file), state: 'up' };
    setVariantUploads((u) => [...u, tile]);
    let created: SceneAsset | null = null;
    try {
      created = await debugApi.createCgAsset(packId, { label, parent_id: cgId });
      const row = await debugApi.uploadCgFile(packId, created.id, file);
      commit([...latest.current, row]);
      setPick({ cgId, variantId: row.id });
    } catch (e) {
      outer.current.notify('error', `表情差分没加上:${errText(e)}`);
      if (created) await debugApi.deleteCgAsset(packId, created.id).catch(() => undefined);
    } finally {
      setVariantUploads((u) => u.filter((t) => t.key !== tile.key));
      URL.revokeObjectURL(tile.url);
    }
  };

  const replaceImage = (id: string, file: File) =>
    void run(async () => adopt([await debugApi.uploadCgFile(packId, id, file)]));

  // 外面交过来的一批(新建 CG 包时选的图):读完列表再传,一批只传一次(开发模式下 effect 会跑两遍)
  const handled = useRef<number | null>(null);
  const takenRef = useRef(onIncomingTaken);
  useEffect(() => {
    takenRef.current = onIncomingTaken;
  });
  const loaded = list !== null;
  useEffect(() => {
    if (!incoming || !loaded || handled.current === incoming.nonce) return;
    handled.current = incoming.nonce;
    takenRef.current?.();
    void addFiles(incoming.files);
  }, [incoming, loaded, addFiles]);

  // ---- 算出来的 ----
  const rows = list ?? [];
  const groups = useMemo(() => groupCgs(list ?? []), [list]);
  const shown = resolvePick(rows, pick);
  const group = shown ? groups.find((g) => g.cg.id === shown.cg.id) : undefined;
  const frame = shown ? stageFrameOf(rows, shown.cg, shown.variant) : null;
  const src = frame?.has_file ? sceneImageUrl(frame) : null;
  // 形态(plugins/forms.ts):装了形态卡带,而且当前服装看起来用得上、或者已经有构图标过,才出「在哪些形态出」
  const formsExt = cgForms();
  const showForms = formsExt !== null && (formsExt.relevant(emotions) || groups.some((g) => (g.cg.forms ?? []).length > 0));
  const deleting = dialog?.kind === 'delete' ? groups.find((g) => g.cg.id === dialog.id) : undefined;

  const badges = shown ? (
    <>
      {shown.variant && (
        <button
          type="button"
          className="st-stage-chip"
          title="回到构图本身"
          onClick={() => setPick({ cgId: shown.cg.id, variantId: null })}
        >
          <span>表情差分:{shown.variant.label}</span>
          <Icon name="x" size={13} />
        </button>
      )}
      <button
        type="button"
        className={`st-stage-chip cg-toggle${phone ? ' on' : ''}`}
        aria-pressed={phone}
        title="画出手机竖屏时只看得到的那一块,左右拖动改焦点"
        onClick={() => setPhone((v) => !v)}
      >
        <span>手机竖屏</span>
      </button>
    </>
  ) : null;

  const stageEmpty =
    list === null
      ? '读取中…'
      : !shown
        ? '这个包还没有构图 · 点下面「添加构图」上传'
        : !src
          ? '这张构图还没有图 · 在右栏「替换图片」传一张'
          : null;

  return (
    <>
      <main className="st-main">
        {header}
        <Stage
          background={null}
          cg={shown && src ? { src, focus: shown.cg.focus_x, mode: 'cover' } : null}
          line={shown ? { speaker: '旁白', text: cgNarration(shown.cg), narration: true } : null}
          editable={src && (phone || focusing) ? 'focus' : null}
          onFocus={(v, done) => shown && setFocus(shown.cg.id, v, done)}
          badges={badges}
          overlays={stageEmpty ? <div className="cg-stage-empty">{stageEmpty}</div> : null}
        />
        <div className="st-grid-head">
          <span className="st-grid-title">构图</span>
          <span className="st-grid-note">
            {list === null
              ? '读取中…'
              : groups.length === 0
                ? '还没有 · 文件名就是构图名,横图(16:9)效果最好'
                : `${groups.length} 张 · 点击编辑 · 拖动排序`}
          </span>
        </div>
        {list !== null && (
          <CgGrid
            groups={groups}
            selectedId={shown?.cg.id ?? null}
            onSelect={(id) => setPick({ cgId: id, variantId: null })}
            onReorder={reorder}
            uploads={uploads}
            onAdd={() => addInput.current?.click()}
            locked={reordering || uploads.length > 0}
          />
        )}
        <input
          ref={addInput}
          type="file"
          accept={CG_ACCEPT}
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
          accept={CG_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            const target = replaceTarget.current;
            if (f && target) replaceImage(target, f);
          }}
        />
        <input
          ref={variantInput}
          type="file"
          accept={CG_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            const cgId = variantFor.current;
            if (!f || !cgId) return;
            if (!isImage(f)) {
              notify('error', '只支持 PNG / JPEG / WebP / GIF 图片');
              return;
            }
            setDialog({ kind: 'variant', cgId, file: f });
          }}
        />
      </main>

      {shown && group ? (
        <CgInspector
          cg={shown.cg}
          variants={group.variants}
          thumb={stageFrameOf(rows, shown.cg, null)}
          index={groups.indexOf(group) + 1}
          total={groups.length}
          variantId={shown.variant?.id ?? null}
          emotions={emotions}
          focus={shown.cg.focus_x}
          FormsEditor={showForms ? formsExt.Editor : null}
          variantUploads={variantUploads.filter((u) => u.cgId === shown.cg.id)}
          confirmDelete={cardCount >= 2}
          onRename={(label) => patch(shown.cg.id, { label })}
          onPatch={(body) => void patch(shown.cg.id, body)}
          onFocus={(v, done) => setFocus(shown.cg.id, v, done)}
          onPickVariant={(id) => setPick({ cgId: shown.cg.id, variantId: id })}
          onAddVariant={() => {
            variantFor.current = shown.cg.id;
            variantInput.current?.click();
          }}
          onRenameVariant={(id, label) => patch(id, { label })}
          onPatchVariant={(id, body) => void patch(id, body)}
          onReplaceVariant={(id) => {
            replaceTarget.current = id;
            replaceInput.current?.click();
          }}
          onDeleteVariant={(id) => removeVariant(shown.cg.id, id)}
          onReplace={() => {
            replaceTarget.current = shown.cg.id;
            replaceInput.current?.click();
          }}
          onDelete={() => (cardCount >= 2 ? setDialog({ kind: 'delete', id: shown.cg.id }) : removeCg(shown.cg.id))}
        />
      ) : (
        <Inspector label="构图">
          <p className="st-inspector-hint">
            {list === null
              ? '读取中…'
              : '这个 CG 包还没有构图。点「添加构图」一次选几张图上传,文件名就是构图名;传完点一张在这里写描述、调焦点、挂表情差分。'}
          </p>
        </Inspector>
      )}

      {deleting && (
        <ConfirmDialog
          title={`删掉构图「${deleting.cg.label}」?`}
          body={
            <>
              <p className="st-dialog-p">这个包被 {cardCount} 张卡用,删了以后这些卡里都没有这张 CG 了。</p>
              {deleting.variants.length > 0 && (
                <p className="st-dialog-p">它下面的 {deleting.variants.length} 张表情差分也一起删掉。</p>
              )}
              <p className="st-dialog-p">删了就找不回来。</p>
            </>
          }
          confirmLabel="删除"
          danger
          onConfirm={() => {
            setDialog(null);
            removeCg(deleting.cg.id);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'variant' &&
        (() => {
          const variants = groups.find((g) => g.cg.id === dialog.cgId)?.variants ?? [];
          const free = freeEmotions(emotions, variants);
          const initial = uniqueLabel(labelFromFile(dialog.file.name), free[0] ?? '差分', takenNames(rows, dialog.cgId));
          return (
            <PromptDialog
              title="添加表情差分"
              label={variantPromptLabel(free)}
              initial={initial}
              confirmLabel="上传"
              onSubmit={(label) => void addVariant(dialog.cgId, dialog.file, label)}
              onCancel={() => setDialog(null)}
            />
          );
        })()}
    </>
  );
}
