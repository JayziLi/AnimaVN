/**
 * 卡编辑器「素材」页的 CG 栏(导入的现成 CG):顶上一行是「用哪个 CG 包」的下拉框(库里导入的全部 CG 包列在一起,
 * 选了整个替换掉原来的)+「上传新建」+「⋯」,下面是这个包的编辑器(CgPackEditor)。
 *
 * 10-27 用户定「不做绑定了」:导入的 CG 一张卡只用一个包。只列 generated = false 的包:生图收藏建的
 * 「AI 生图 · 卡名」包归「AI 生成」那一栏(用户要求两种 CG 分开放),游戏里两种 CG 一样能被选到;
 * 所以换包只换导入的这一个,卡上绑着的 AI 生成的包留着(editors/cgEdit 的 replaceImportedCgPack)。
 * 绑定走 useScenePlugin(bindCgPacks,整组);包里的内容由编辑器自己读写、经 PackSync 同步进游戏。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { debugApi, type SceneAsset } from '../../lib/api';
import type { ScenePluginState } from '../../plugins/useScenePlugin';
import { CG_ACCEPT, CgPackEditor } from '../editors/CgPackEditor';
import { cgCounts, cgPackSub, generatedBoundCount, importedCgPackIds, replaceImportedCgPack } from '../editors/cgEdit';
import { Icon } from '../icons';
import type { Notify, PackSync } from '../types';
import { Btn, Inspector, InspectorHead, MoreMenu, PackSwap, PromptDialog, Section, TypeLabel } from '../ui';
import { packExportItem } from '../../components/export/packExport';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 还没选 CG 包时右栏的说明 */
const INTRO = [
  'CG 是剧情里某个场面的一整张图(一般是横图),出 CG 时盖住立绘和背景。AI 写了 CG 标签、或者 Jev 挑中时出。',
  '一个 CG 包是一组构图;每张构图下面还能挂几张表情差分,角色说话时按她当时的表情换。一张卡只用一个 CG 包,在顶上的下拉框里选;选了就整个换掉原来的。',
  '游戏里画笔画的、自动出图收藏下来的 CG 在「AI 生成」那一栏。',
];

type Dialog = { kind: 'create'; files: File[] } | { kind: 'rename'; id: string } | null;

export interface CgSlotProps {
  cardName: string;
  /** 场景插件里 CG 那几样:全部 CG 包、这张卡用的(含 AI 生成的)、整组改、刷新包列表 */
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
  const usedIds = importedCgPackIds(cgPackIds, cgPacks, created);
  const generated = generatedBoundCount(cgPackIds, cgPacks);
  const loading = !scene.ready || (!listed && cgPackIds.some((id) => !byId.has(id)));

  // 用的是哪个包:导入的里排第一的(以前存着几个的卡,多出来的在下次换的时候拿掉)
  const shown = usedIds[0] ?? null;

  // 编辑器改完会报上来每个包现在的构图 / 差分数(下拉框右边的灰字);没报过的用包列表里的数
  const [subs, setSubs] = useState<Record<string, string>>({});
  const onAssets = useCallback((pid: string, list: SceneAsset[]) => {
    setSubs((m) => ({ ...m, [pid]: cgPackSub(cgCounts(list)) }));
  }, []);

  // ---- 换一个 / 新建 ----
  const [dialog, setDialog] = useState<Dialog>(null);
  const createInput = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<{ packId: string; nonce: number; files: File[] } | null>(null);

  /** 选了一个包:整个换掉原来导入的;AI 生成的留着 */
  const replace = async (id: string | null) => {
    if (!id) return;
    await bindCgPacks(replaceImportedCgPack(cgPackIds, cgPacks, id));
  };

  const create = async (packName: string, files: File[]) => {
    setDialog(null);
    try {
      const pack = await debugApi.createCgPack(packName);
      setCreated((s) => new Set(s).add(pack.id));
      await bindCgPacks(replaceImportedCgPack(cgPackIds, cgPacks, pack.id));
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

  const swap = (
    <PackSwap
      ariaLabel={`「${name}」的 CG 包`}
      options={cgPacks
        .filter((p) => !p.generated)
        .map((p) => ({ id: p.id, name: p.name, sub: subs[p.id] ?? `${p.cg_count} 个构图` }))}
      value={shown}
      disabled={loading}
      onPick={(id) => void replace(id)}
    >
      <Btn icon="upload" small onClick={() => createInput.current?.click()}>
        上传新建
      </Btn>
    </PackSwap>
  );

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
    </>
  );

  // ---- 还没选导入的 CG 包 ----
  if (!shown) {
    return (
      <>
        <main className="st-main">
          <div className="st-slot-bar">
            <TypeLabel slot="cg" />
            {swap}
          </div>
          {!loading ? (
            <div className="st-empty">
              <span className="st-empty-icon">
                <Icon name="cg" size={26} />
              </span>
              <span className="st-empty-title">还没有 CG 包</span>
              <span className="st-empty-note">从上面的下拉框选一个,或者上传图片新建一个</span>
              {generated > 0 && (
                <span className="st-empty-note">另外有 {generated} 个 AI 生成的 CG 包在用,在「AI 生成」那一栏看</span>
              )}
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

  const header = (
    <div className="st-slot-bar">
      <TypeLabel slot="cg" />
      {swap}
      <span className="st-flex" />
      <MoreMenu
        label="更多:重命名、导出这个包"
        items={[
          { label: '重命名', onClick: () => setDialog({ kind: 'rename', id: shown }) },
          packExportItem('cg', shown, notify),
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
