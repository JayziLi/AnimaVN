/**
 * 背景编辑器的右栏:选中的那张背景 —— 名字(点了改)、描述、别名、启用开关、默认 BGM(▶ + 下拉)、竖屏焦点;
 * 底部替换图片、删除背景(包被几张卡用时先确认,否则点两下)。样子照 V4AttachBg 的右栏。
 */

import { useState, type ReactNode } from 'react';
import { sceneThumbUrl, type SceneAsset, type SceneAssetPatch } from '../../lib/api';
import { Icon } from '../icons';
import { PlayButton } from '../PlayButton';
import { TERMS } from '../terms';
import {
  Btn,
  Chip,
  CommitTextarea,
  ConfirmDialog,
  DeleteBtn,
  FieldLabel,
  Inspector,
  InspectorHead,
  Section,
  SelectBox,
  SliderRow,
  SwitchRow,
  TagsField,
  TitleEdit,
  type SelectOption,
} from '../ui';
import type { BgmTag } from './sceneEdit';

export interface BackgroundInspectorProps {
  asset: SceneAsset;
  /** 第几张(从 1 数)、一共几张 */
  index: number;
  total: number;
  isDefault: boolean;
  /** 正在排序(设为默认)时别连点 */
  busy?: boolean;
  /** 焦点(拖动时是还没存的那个值) */
  focus: number;
  /** 切到这张背景时游戏里放什么 */
  tag: BgmTag;
  bgmOptions: SelectOption[];
  /** 下拉里选的那首能不能试听(地址),在不在放 */
  bgmUrl: string | null;
  bgmPlaying: boolean;
  bgmError: string | null;
  bgmNote?: ReactNode;
  /** 包被几张卡用时删之前的提醒;null = 点两下直接删 */
  deleteNote: string | null;
  onToggleBgm: () => void;
  onRename: (label: string) => Promise<boolean>;
  onPatch: (patch: SceneAssetPatch) => void;
  onMakeDefault: () => void;
  onFocus: (v: number, commit: boolean) => void;
  onReplace: () => void;
  onDelete: () => void;
}

const focusText = (v: number) => `${Math.round(v)}%`;

export function BackgroundInspector(props: BackgroundInspectorProps) {
  const { asset: a, tag } = props;
  const [confirming, setConfirming] = useState(false);
  const thumb = sceneThumbUrl(a, 240);

  const bgmWarn =
    tag.state === 'off'
      ? `「${tag.text}」停用了或还没传文件,游戏里切到这张背景时不换曲子。`
      : tag.state === 'foreign'
        ? '这首在这张卡没绑的包里,游戏里切过来时不会换。改成上面列表里的一首,或者去「BGM」那一栏绑上它所在的包。'
        : null;

  return (
    <Inspector
      label={`调整背景「${a.label}」`}
      head={
        <InspectorHead
          media={
            thumb ? (
              <img className="st-ihead-media wide" src={thumb} alt="" draggable={false} />
            ) : (
              <span className="st-ihead-media wide st-ihead-blank">
                <Icon name="image" size={18} />
              </span>
            )
          }
          title={<TitleEdit value={a.label} label="背景名" onCommit={props.onRename} />}
          badge={
            props.isDefault ? (
              <>
                <Chip strong>
                  <Icon name="star" size={11} fill />
                  默认背景
                </Chip>
                <span>开场时用</span>
              </>
            ) : (
              <>
                {!a.enabled && <Chip>已停用</Chip>}
                <span>
                  第 {props.index} 张 · 共 {props.total} 张
                </span>
                <button
                  type="button"
                  className="st-link small"
                  disabled={!a.enabled || props.busy}
                  title={a.enabled ? '挪到第一张:对话开头、AI 还没写场景时用它' : '先启用这张背景'}
                  onClick={props.onMakeDefault}
                >
                  设为默认背景
                </button>
              </>
            )
          }
        />
      }
      footer={
        <>
          <Btn small icon="image" onClick={props.onReplace}>
            替换图片
          </Btn>
          <span className="st-flex" />
          {props.deleteNote ? (
            <Btn small kind="danger" onClick={() => setConfirming(true)}>
              删除背景
            </Btn>
          ) : (
            <DeleteBtn small label="删除背景" onConfirm={props.onDelete} />
          )}
          {confirming && (
            <ConfirmDialog
              title={`删掉背景「${a.label}」?`}
              body={
                <>
                  <p className="st-dialog-p">{props.deleteNote}。</p>
                  <p className="st-dialog-p">图会一起删掉,删了就找不回来。</p>
                </>
              }
              confirmLabel="删除"
              danger
              onConfirm={() => {
                setConfirming(false);
                props.onDelete();
              }}
              onCancel={() => setConfirming(false)}
            />
          )}
        </>
      }
    >
      <Section title="描述" help={TERMS.bgDesc} first />
      <CommitTextarea
        key={`desc:${a.id}`}
        value={a.description}
        rows={2}
        placeholder="什么地方、什么时候用,比如:海灯节夜里挂满灯笼的会场入口;过节、逛灯会时用"
        onCommit={(description) => props.onPatch({ description })}
      />
      <div className="st-gap" />
      <FieldLabel text="别名" help={TERMS.bgAlias} />
      <TagsField values={a.aliases} onChange={(aliases) => props.onPatch({ aliases })} placeholder="比如 灯会,回车加" />
      <div className="st-gap" />
      <SwitchRow
        label="启用这张背景"
        checked={a.enabled}
        note={a.enabled ? undefined : '停用后游戏里当它不存在,图和设置都留着'}
        onChange={(enabled) => props.onPatch({ enabled })}
      />
      <div className="st-gap small" />

      <Section title="默认 BGM" help={TERMS.defaultBgm} />
      <div className="st-bgm-pick">
        <PlayButton
          playing={props.bgmPlaying}
          disabled={!props.bgmUrl}
          label={props.bgmUrl ? undefined : a.bgm_id ? '这首还没传文件' : '选了「不换」,没有曲子可试听'}
          onClick={props.onToggleBgm}
        />
        <SelectBox
          label="默认 BGM"
          value={a.bgm_id ?? ''}
          options={props.bgmOptions}
          onChange={(v) => props.onPatch({ bgm_id: v || null })}
        />
      </div>
      {props.bgmError && <div className="st-bgm-note warn">{props.bgmError}</div>}
      {bgmWarn && <div className="st-bgm-note warn">{bgmWarn}</div>}
      {props.bgmNote && <div className="st-bgm-note">{props.bgmNote}</div>}

      <Section title="焦点" help={TERMS.focus} />
      <SliderRow
        label="水平"
        min={0}
        max={100}
        step={1}
        value={props.focus}
        format={focusText}
        note="也可以在预览里打开「手机竖屏」,左右拖动虚线框"
        onChange={(v) => props.onFocus(v, false)}
        onCommit={(v) => props.onFocus(v, true)}
      />
    </Inspector>
  );
}
