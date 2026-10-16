/**
 * CG 包编辑器的右栏:选中的那张构图 —— 名字(点了改)、描述、别名、启用开关、竖屏焦点、
 * (装了形态卡带、用得上才有的)在哪些形态出;下面「表情差分」列表:点一张在舞台上看,
 * 选中的那张展开改名、别名、替换图片、删除;底部替换图片、删除构图。
 * 差分没有自己的焦点、描述:游戏里它跟着构图走,只是按表情换一张图。
 */

import { useState, type ComponentType } from 'react';
import { sceneThumbUrl, type SceneAsset, type SceneAssetPatch } from '../../lib/api';
import type { CgFormsEditorProps } from '../../plugins/cartridges';
import { LABEL_MAX } from '../../plugins/common';
import { text as defaultText } from '../../plugins/texts';
import { Icon } from '../icons';
import { TERMS } from '../terms';
import {
  Btn,
  Chip,
  CommitTextarea,
  DeleteBtn,
  FieldLabel,
  IconBtn,
  Inspector,
  InspectorHead,
  Section,
  SliderRow,
  SwitchRow,
  TagsField,
} from '../ui';
import { freeEmotions, variantReachable } from './cgEdit';
import type { UploadTile } from './SpriteFaceGrid';

/** 名字:点一下变输入框,回车 / 失焦改名,Esc 放弃;改不成(重名、名字不合规)退回原名 */
function NameEdit({
  value,
  label,
  className,
  inputClassName,
  onCommit,
}: {
  value: string;
  /** 读屏用:「构图名」「表情名」 */
  label: string;
  className: string;
  inputClassName: string;
  onCommit: (next: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button type="button" className={className} title="点击改名" onClick={() => setDraft(value)}>
        {value}
      </button>
    );
  }
  const commit = async () => {
    const next = draft.trim();
    setDraft(null);
    if (next && next !== value) await onCommit(next);
  };
  return (
    <input
      className={inputClassName}
      aria-label={label}
      autoFocus
      value={draft}
      maxLength={LABEL_MAX}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** 差分的小缩略图(16:9) */
function VariantThumb({ v }: { v: SceneAsset }) {
  const url = sceneThumbUrl(v, 160);
  return (
    <span className="cg-var-thumb">
      {url ? <img src={url} alt="" draggable={false} loading="lazy" /> : <Icon name="image" size={14} />}
    </span>
  );
}

export interface CgInspectorProps {
  cg: SceneAsset;
  variants: readonly SceneAsset[];
  /** 右栏头的缩略图用哪张(构图没图时是第一张有图的差分) */
  thumb: SceneAsset;
  /** 第几张构图(从 1 数)、一共几张 */
  index: number;
  total: number;
  /** 舞台上正在看的差分;null = 构图本身 */
  variantId: string | null;
  /** 当前服装启用的差分名;空 = 不知道(素材管理页),不提示对不上 */
  emotions: readonly string[];
  /** 竖屏焦点(拖滑块时是还没存的值) */
  focus: number;
  /** 「在哪些形态出」:装了形态卡带、这个包用得上才有 */
  FormsEditor: ComponentType<CgFormsEditorProps> | null;
  /** 正在上传的差分(这张构图的) */
  variantUploads: readonly UploadTile[];
  /** 删构图要弹确认框(包被两张以上的卡用);不要就是点两下的红字按钮 */
  confirmDelete: boolean;
  onRename: (label: string) => Promise<boolean>;
  onPatch: (patch: SceneAssetPatch) => void;
  /** 拖滑块:commit = false 只改舞台,松手 true 再存 */
  onFocus: (v: number, commit: boolean) => void;
  /** 舞台上看哪张差分;null = 回到构图 */
  onPickVariant: (id: string | null) => void;
  onAddVariant: () => void;
  onRenameVariant: (id: string, label: string) => Promise<boolean>;
  onPatchVariant: (id: string, patch: SceneAssetPatch) => void;
  onReplaceVariant: (id: string) => void;
  onDeleteVariant: (id: string) => void;
  onReplace: () => void;
  onDelete: () => void;
}

const UPLOAD_STATE: Record<UploadTile['state'], string> = { wait: '等待上传', up: '上传中…', fail: '没传上' };

export function CgInspector(props: CgInspectorProps) {
  const { cg, variants, emotions, FormsEditor } = props;
  const media = sceneThumbUrl(props.thumb, 240);
  const free = emotions.length > 0 && variants.length > 0 ? freeEmotions(emotions, variants) : [];
  const unmatched = variants.filter((v) => !variantReachable(v, emotions)).length;
  const variantNote =
    variants.length === 0
      ? '还没有 · 名字和立绘的差分名一样,说话时是这个表情就换成它'
      : `${variants.length} 张 · 点一张在舞台上看${unmatched > 0 ? ` · ${unmatched} 张对不上当前服装的差分名` : ''}`;

  return (
    <Inspector
      label={`调整构图「${cg.label}」`}
      head={
        <InspectorHead
          media={
            media ? (
              <img className="st-ihead-media wide" src={media} alt="" draggable={false} />
            ) : (
              <span className="st-ihead-media wide cg-ihead-none">
                <Icon name="image" size={18} />
              </span>
            )
          }
          title={<NameEdit key={cg.id} value={cg.label} label="构图名" className="st-ihead-name" inputClassName="st-ihead-input" onCommit={props.onRename} />}
          badge={
            <>
              {!cg.enabled && <Chip>已停用</Chip>}
              {!cg.has_file && <Chip>还没传图</Chip>}
              <span>
                第 {props.index} 张 · 共 {props.total} 张
              </span>
            </>
          }
        />
      }
      footer={
        <>
          <Btn small icon="image" onClick={props.onReplace}>
            替换图片
          </Btn>
          <span className="st-flex" />
          {props.confirmDelete ? (
            <Btn kind="danger" small onClick={props.onDelete}>
              删除构图
            </Btn>
          ) : (
            <DeleteBtn
              small
              label="删除构图"
              armedLabel={variants.length > 0 ? `连同 ${variants.length} 张差分一起删` : '再点一下删除'}
              onConfirm={props.onDelete}
            />
          )}
        </>
      }
    >
      <Section title="描述" help={TERMS.cgDesc} first />
      <CommitTextarea
        key={`desc:${cg.id}`}
        value={cg.description}
        rows={3}
        placeholder={defaultText('cg.descPlaceholder', '给 AI / Jev 看的:场面|在做什么|不算|场景参考')}
        onCommit={(description) => props.onPatch({ description })}
      />
      <div className="st-gap" />
      <FieldLabel text="别名" />
      <TagsField
        key={`alias:${cg.id}`}
        values={cg.aliases}
        onChange={(aliases) => props.onPatch({ aliases })}
        placeholder="比如 雨夜,回车加"
      />
      <div className="st-gap" />
      <SwitchRow
        label="启用这张 CG"
        checked={cg.enabled}
        note={cg.enabled ? undefined : '停用后游戏里当它不存在(AI、Jev 都选不到),图和差分都留着'}
        onChange={(enabled) => props.onPatch({ enabled })}
      />
      <div className="st-gap small" />

      <Section title="焦点" help={TERMS.focus} />
      <SliderRow
        label="水平"
        min={0}
        max={100}
        step={1}
        value={props.focus}
        format={(v) => `${Math.round(v)}%`}
        note="表情差分也按这里裁 · 拖动时舞台上画出竖屏框"
        onChange={(v) => props.onFocus(v, false)}
        onCommit={(v) => props.onFocus(v, true)}
      />

      {FormsEditor && (
        <div className="cg-forms">
          <FormsEditor key={cg.id} forms={cg.forms ?? []} disabled={false} onChange={(forms) => props.onPatch({ forms })} />
        </div>
      )}
      <div className="st-gap small" />

      <Section
        title="表情差分"
        help={TERMS.cgVariant}
        note={variantNote}
        right={
          <Btn small icon="plus" onClick={props.onAddVariant}>
            添加差分
          </Btn>
        }
      />
      <div className="cg-vars" role="list" aria-label="表情差分">
        {variants.map((v) => {
          const reachable = variantReachable(v, emotions);
          if (v.id !== props.variantId) {
            return (
              <button
                key={v.id}
                type="button"
                role="listitem"
                className={`cg-var${v.enabled ? '' : ' off'}`}
                title="在舞台上看这张"
                onClick={() => props.onPickVariant(v.id)}
              >
                <VariantThumb v={v} />
                <span className="cg-var-text">
                  <span className="cg-var-name">{v.label}</span>
                  {v.aliases.length > 0 && <span className="cg-var-sub">{v.aliases.join('、')}</span>}
                </span>
                {!reachable && (
                  <span className="cg-var-warn" title="当前服装里没有这个名字(或别名)的差分,游戏里换不到这张">
                    <Icon name="alert" size={14} />
                  </span>
                )}
              </button>
            );
          }
          return (
            <div key={v.id} role="listitem" className="cg-var open" aria-label={`表情差分「${v.label}」`}>
              <div className="cg-var-head">
                <VariantThumb v={v} />
                <span className="cg-var-text">
                  <NameEdit
                    key={v.id}
                    value={v.label}
                    label="表情名"
                    className="cg-var-rename"
                    inputClassName="cg-var-input"
                    onCommit={(label) => props.onRenameVariant(v.id, label)}
                  />
                  <span className="cg-var-sub">舞台上正在看这张</span>
                </span>
                <IconBtn icon="x" label="回到构图本身" size={28} onClick={() => props.onPickVariant(null)} />
              </div>
              {!reachable && (
                <div className="cg-var-note">
                  <Icon name="alert" size={13} />
                  当前服装里没有叫这个名字的差分,游戏里换不到它;改成差分名,或者加个别名
                </div>
              )}
              <FieldLabel text="别名" />
              <TagsField
                key={`valias:${v.id}`}
                values={v.aliases}
                onChange={(aliases) => props.onPatchVariant(v.id, { aliases })}
                placeholder="比如 smile,回车加"
              />
              <div className="cg-var-actions">
                <Btn small icon="image" onClick={() => props.onReplaceVariant(v.id)}>
                  替换图片
                </Btn>
                <span className="st-flex" />
                <DeleteBtn small label="删除差分" onConfirm={() => props.onDeleteVariant(v.id)} />
              </div>
            </div>
          );
        })}
        {props.variantUploads.map((u) => (
          <div key={u.key} role="listitem" className={`cg-var uploading ${u.state}`}>
            <span className="cg-var-thumb">
              <img src={u.url} alt="" draggable={false} />
            </span>
            <span className="cg-var-text">
              <span className="cg-var-name">{u.name}</span>
              <span className="cg-var-sub">
                {u.state === 'up' && <span className="spinner tiny" />} {UPLOAD_STATE[u.state]}
              </span>
            </span>
          </div>
        ))}
      </div>
      {free.length > 0 && (
        <div className="cg-free">
          还没配差分的表情:{free.slice(0, 8).join('、')}
          {free.length > 8 ? ` 等 ${free.length} 个` : ''}(说话时是这些表情就显示构图本身)
        </div>
      )}
    </Inspector>
  );
}
