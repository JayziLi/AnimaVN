/**
 * 卡编辑器「素材」页的 CG 栏(导入的现成 CG):顶上一排这张卡绑的 CG 包页签 +「＋」从素材库挑 / 上传新建 +「⋯」,
 * 下面是选中那个包的编辑器(CgPackEditor)。
 *
 * 只列 generated = false 的包:生图收藏建的「AI 生图 · 卡名」包归「AI 生成」那一栏(用户要求两种 CG 分开放);
 * 游戏里两种 CG 一样能被选到。「＋」的素材库里列全部 CG 包,AI 生成的标「AI 生成」。
 * 绑定走 useScenePlugin(bindCgPacks,整组、按顺序);包里的内容由编辑器自己读写、经 PackSync 同步进游戏。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { debugApi, sceneThumbUrl, type SceneAsset } from '../../lib/api';
import type { ScenePluginState } from '../../plugins/useScenePlugin';
import { CG_ACCEPT, CgPackEditor } from '../editors/CgPackEditor';
import { cgCounts, cgPackSub, coverOf, generatedBoundCount, importedCgPackIds } from '../editors/cgEdit';
import { Icon } from '../icons';
import { PackPicker } from '../PackPicker';
import type { Notify, PackSync } from '../types';
import { Btn, ConfirmDialog, Inspector, InspectorHead, MoreMenu, PackTabs, PromptDialog, Section, TypeLabel } from '../ui';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 还没绑 CG 包时右栏的说明 */
const INTRO = [
  'CG 是剧情里某个场面的一整张图(一般是横图),出 CG 时盖住立绘和背景。AI 写了 CG 标签、或者 Jev 挑中时出。',
  '一个 CG 包是一组构图;每张构图下面还能挂几张表情差分,角色说话时按她当时的表情换。一张卡可以绑几个包,几个包里有同名的构图时用排前面的。',
  '游戏里画笔画的、自动出图收藏下来的 CG 在「AI 生成」那一栏。',
];

type Dialog =
  | { kind: 'picker' }
  | { kind: 'create'; files: File[] }
  | { kind: 'rename'; id: string }
  | { kind: 'unbind'; id: string }
  | null;

/** 页签、素材库里的缩略图和张数(编辑器改完会报上来) */
interface PackInfo {
  cover: SceneAsset | null;
  counts: { cgs: number; variants: number };
}

const infoOf = (list: readonly SceneAsset[]): PackInfo => ({ cover: coverOf(list), counts: cgCounts(list) });

export interface CgSlotProps {
  cardName: string;
  /** 场景插件里 CG 那几样:全部 CG 包、这张卡绑的(按顺序,含 AI 生成的)、改绑定、刷新包列表 */
  scene: Pick<ScenePluginState, 'cgPacks' | 'cgPackIds' | 'bindCgPacks' | 'refreshCgPacks' | 'ready'>;
  /** 当前服装启用的差分名(表情差分对不对得上、还缺哪些) */
  emotions: readonly string[];
  sync: PackSync;
  notify: Notify;
}

export function CgSlot({ cardName, scene, emotions, sync, notify }: CgSlotProps) {
  const { cgPacks, cgPackIds, bindCgPacks, refreshCgPacks } = scene;
  const byId = new Map(cgPacks.map((p) => [p.id, p]));
  const name = cardName.trim() || '(无名)';

  // 包的构图数、在用的卡数在别处也会变,进这一栏时刷新一次;读到之前绑着的包看不出来源,先显示「读取中」
  const [listed, setListed] = useState(false);
  useEffect(() => {
    void refreshCgPacks().finally(() => setListed(true));
  }, [refreshCgPacks]);

  // 这一栏刚建的包:包列表刷新之前也当导入的显示
  const [created, setCreated] = useState<ReadonlySet<string>>(new Set());
  const tabIds = importedCgPackIds(cgPackIds, cgPacks, created);
  const generated = generatedBoundCount(cgPackIds, cgPacks);
  const loading = !scene.ready || (!listed && cgPackIds.some((id) => !byId.has(id)));

  // 看的是哪个包:点过的页签;它被解除了就回到第一个
  const [pick, setPick] = useState<string | null>(null);
  const shown = pick && tabIds.includes(pick) ? pick : (tabIds[0] ?? null);

  // ---- 每个包的缩略图和张数(页签、素材库列表用) ----
  const [infos, setInfos] = useState<Record<string, PackInfo | null>>({});
  const asked = useRef(new Set<string>());
  const loadInfos = useCallback((ids: readonly string[]) => {
    for (const id of ids) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      debugApi
        .listCgAssets(id)
        .then((list) => setInfos((m) => ({ ...m, [id]: infoOf(list) })))
        .catch(() => setInfos((m) => ({ ...m, [id]: null })));
    }
  }, []);
  const tabKey = tabIds.join(',');
  useEffect(() => {
    loadInfos(tabKey ? tabKey.split(',') : []);
  }, [tabKey, loadInfos]);
  const onAssets = useCallback((pid: string, list: SceneAsset[]) => {
    setInfos((m) => ({ ...m, [pid]: infoOf(list) }));
  }, []);
  const thumbOf = (id: string) => {
    const cover = infos[id]?.cover;
    return cover ? sceneThumbUrl(cover, 96) : null;
  };

  // ---- 绑定 ----
  const [dialog, setDialog] = useState<Dialog>(null);
  const createInput = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<{ packId: string; nonce: number; files: File[] } | null>(null);

  const openPicker = () => {
    // 构图数、在用的卡数在别处也会变
    void refreshCgPacks();
    loadInfos(cgPacks.map((p) => p.id));
    setDialog({ kind: 'picker' });
  };
  const pickNewFiles = () => createInput.current?.click();

  /** 绑上一个包(接在最后),页签切过去;AI 生成的不在这一栏,说一声去哪看 */
  const bind = async (id: string) => {
    setDialog(null);
    await bindCgPacks([...cgPackIds, id]);
    const pack = byId.get(id);
    if (pack?.generated) notify('ok', `「${pack.name}」绑上了 · AI 生成的 CG 在「AI 生成」那一栏看`);
    else setPick(id);
  };

  const create = async (packName: string, files: File[]) => {
    setDialog(null);
    try {
      const pack = await debugApi.createCgPack(packName);
      setCreated((s) => new Set(s).add(pack.id));
      await bindCgPacks([...cgPackIds, pack.id]);
      setPick(pack.id);
      // 编辑器开起来以后自己传(网格里一张张出进度)
      setIncoming({ packId: pack.id, nonce: Date.now(), files });
    } catch (e) {
      notify('error', `新建 CG 包失败: ${errText(e)}`);
    }
  };

  const rename = async (id: string, next: string) => {
    setDialog(null);
    try {
      await debugApi.updateCgPack(id, { name: next });
      sync.packs('cg');
    } catch (e) {
      notify('error', `改名失败: ${errText(e)}`);
    }
  };

  const unbind = async (id: string) => {
    setDialog(null);
    await bindCgPacks(cgPackIds.filter((x) => x !== id));
    setPick(null);
  };

  const dialogs = (
    <>
      <input
        ref={createInput}
        type="file"
        accept={CG_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) setDialog({ kind: 'create', files });
        }}
      />
      {dialog?.kind === 'picker' && (
        <PackPicker
          title="添加 CG 包"
          packs={cgPacks.map((p) => {
            const thumb = thumbOf(p.id);
            return {
              id: p.id,
              name: p.name,
              count: `${p.cg_count} 个构图`,
              cardCount: p.card_count,
              media: thumb ? <img className="cg-picker-img" src={thumb} alt="" draggable={false} /> : undefined,
              tag: p.generated ? 'AI 生成' : undefined,
            };
          })}
          cardName={name}
          boundIds={cgPackIds}
          icon="cg"
          onPick={(id) => void bind(id)}
          createLabel="上传图片新建一个 CG 包"
          onCreate={() => {
            setDialog(null);
            pickNewFiles();
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'create' && (
        <PromptDialog
          title="新建 CG 包"
          label={`名字(${dialog.files.length} 张图,文件名就是构图名)`}
          initial={`${name} · CG`}
          confirmLabel="新建并上传"
          onSubmit={(v) => void create(v, dialog.files)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="重命名 CG 包"
          label="名字"
          initial={byId.get(dialog.id)?.name ?? ''}
          confirmLabel="改名"
          onSubmit={(v) => void rename(dialog.id, v)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'unbind' && (
        <ConfirmDialog
          title={`解除绑定「${byId.get(dialog.id)?.name ?? '这个 CG 包'}」?`}
          body={
            <p className="st-dialog-p">只是这张卡不再出这些 CG,包和里面的构图、表情差分都留着,素材库里还能找到。</p>
          }
          confirmLabel="解除绑定"
          onConfirm={() => void unbind(dialog.id)}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );

  // ---- 还没绑导入的 CG 包 ----
  if (!shown) {
    return (
      <>
        <main className="st-main">
          <div className="st-slot-bar">
            <TypeLabel slot="cg" />
          </div>
          {!loading ? (
            <div className="st-empty">
              <span className="st-empty-icon">
                <Icon name="cg" size={26} />
              </span>
              <span className="st-empty-title">还没有绑定 CG 包</span>
              <span className="st-empty-note">从素材库选,或者把 CG 文件夹拖进来</span>
              {generated > 0 && (
                <span className="st-empty-note">另外绑着 {generated} 个 AI 生成的 CG 包,在「AI 生成」那一栏看</span>
              )}
              <div className="st-empty-actions">
                <Btn icon="search" onClick={openPicker}>
                  从素材库选
                </Btn>
                <Btn icon="upload" onClick={pickNewFiles}>
                  上传图片新建一个 CG 包
                </Btn>
              </div>
            </div>
          ) : (
            <div className="st-empty">
              <span className="st-empty-note">读取中…</span>
            </div>
          )}
        </main>
        <Inspector label="CG" head={<InspectorHead title="CG" />}>
          <Section title="CG 是什么" first />
          {INTRO.map((p) => (
            <p key={p} className="st-inspector-hint cg-intro">
              {p}
            </p>
          ))}
        </Inspector>
        {dialogs}
      </>
    );
  }

  const current = byId.get(shown);
  const tabs = tabIds.map((id) => {
    const p = byId.get(id);
    const counts = infos[id]?.counts ?? { cgs: p?.cg_count ?? 0, variants: 0 };
    return {
      id,
      name: p?.name ?? '…',
      sub: cgPackSub(counts),
      selected: id === shown,
      thumb: thumbOf(id),
      icon: 'cg' as const,
    };
  });

  const header = (
    <div className="st-slot-bar">
      <TypeLabel slot="cg" />
      <PackTabs
        items={tabs}
        onSelect={setPick}
        onAdd={openPicker}
        addLabel="添加 CG 包(从素材库选,或上传图片新建一个)"
        label="这张卡绑的 CG 包"
      />
      <span className="st-flex" />
      <MoreMenu
        label="更多:重命名、解除绑定"
        items={[
          { label: '重命名', onClick: () => setDialog({ kind: 'rename', id: shown }) },
          { label: '解除绑定', onClick: () => setDialog({ kind: 'unbind', id: shown }) },
        ]}
      />
    </div>
  );

  return (
    <>
      <CgPackEditor
        key={shown}
        packId={shown}
        header={header}
        cardCount={current?.card_count}
        emotions={emotions}
        sync={sync}
        notify={notify}
        incoming={incoming?.packId === shown ? incoming : null}
        onIncomingTaken={() => setIncoming(null)}
        onAssets={onAssets}
      />
      {dialogs}
    </>
  );
}
