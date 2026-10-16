/**
 * BGM 编辑器的右栏:选中的那首 —— 头上 ▶ 试听 + 曲名(点了改);描述、别名、启用开关、「设为封面曲」开关、
 * 「这些背景切过来时放它」(只读)、文件信息;底部替换文件、删除曲子(包被几张卡用时先确认,否则点两下)。
 */

import { useState } from 'react';
import { sceneThumbUrl, type SceneAsset, type SceneAssetPatch } from '../../lib/api';
import { formatSize } from '../../components/pluginRunner';
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
  SwitchRow,
  TagsField,
  TitleEdit,
} from '../ui';
import type { BgmUser } from './sceneEdit';

export interface BgmInspectorProps {
  asset: SceneAsset;
  /** 第几首(从 1 数)、一共几首 */
  index: number;
  total: number;
  /** 它是不是这个包的封面曲(explicit = 选的;否则是没选时排第一的那首);不是 = null */
  cover: { explicit: boolean } | null;
  /** 选了别的那首当封面曲时,那首的名字 */
  otherCover: string | null;
  playing: boolean;
  error: string | null;
  /** 播放器读到的时长;还不知道是 '' */
  duration: string;
  /** 把它当默认 BGM 的背景 */
  users: readonly BgmUser[];
  /** 包被几张卡用时删之前的提醒;null = 点两下直接删 */
  deleteNote: string | null;
  onToggle: () => void;
  onRename: (label: string) => Promise<boolean>;
  onPatch: (patch: SceneAssetPatch) => void;
  onCover: (on: boolean) => void;
  onReplace: () => void;
  onDelete: () => void;
}

export function BgmInspector(props: BgmInspectorProps) {
  const { asset: a, cover, users } = props;
  const [confirming, setConfirming] = useState(false);
  const isCover = cover?.explicit === true;

  const coverNote = !a.enabled
    ? '停用的曲子不会在标题画面放,先启用'
    : isCover
      ? '标题画面和选角页放这首'
      : cover
        ? '这个包没选封面曲,现在放的就是排第一的这首'
        : props.otherCover
          ? `现在的封面曲是「${props.otherCover}」`
          : undefined;

  const file = a.has_file
    ? [a.mime ?? '', formatSize(a.size), props.duration && `时长 ${props.duration}`].filter(Boolean).join(' · ')
    : '还没传文件,点下面「上传文件」';

  return (
    <Inspector
      label={`调整曲子「${a.label}」`}
      head={
        <InspectorHead
          media={
            <PlayButton
              size={48}
              playing={props.playing}
              disabled={!a.has_file}
              label={a.has_file ? undefined : '还没传文件'}
              onClick={props.onToggle}
            />
          }
          title={<TitleEdit value={a.label} label="曲名" onCommit={props.onRename} />}
          badge={
            <>
              {isCover && <Chip strong>封面曲</Chip>}
              {!a.enabled && <Chip>已停用</Chip>}
              <span>
                第 {props.index} 首 · 共 {props.total} 首
              </span>
            </>
          }
        />
      }
      footer={
        <>
          <Btn small icon="upload" onClick={props.onReplace}>
            {a.has_file ? '替换文件' : '上传文件'}
          </Btn>
          <span className="st-flex" />
          {props.deleteNote ? (
            <Btn small kind="danger" onClick={() => setConfirming(true)}>
              删除曲子
            </Btn>
          ) : (
            <DeleteBtn small label="删除曲子" onConfirm={props.onDelete} />
          )}
          {confirming && (
            <ConfirmDialog
              title={`删掉曲子「${a.label}」?`}
              body={
                <>
                  <p className="st-dialog-p">{props.deleteNote}。</p>
                  {users.length > 0 && (
                    <p className="st-dialog-p">
                      {users.map((u) => `「${u.label}」`).join('')}切过来时就不换曲子了。
                    </p>
                  )}
                  <p className="st-dialog-p">文件会一起删掉,删了就找不回来。</p>
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
      {props.error && <div className="st-bgm-note warn first">{props.error}</div>}
      <Section title="描述" help={TERMS.bgmDesc} first />
      <CommitTextarea
        key={`desc:${a.id}`}
        value={a.description}
        rows={2}
        placeholder="什么气氛用它,比如:轻快的日常曲,平常聊天、逛街时放"
        onCommit={(description) => props.onPatch({ description })}
      />
      <div className="st-gap" />
      <FieldLabel text="别名" help={TERMS.bgmAlias} />
      <TagsField values={a.aliases} onChange={(aliases) => props.onPatch({ aliases })} placeholder="比如 轻松,回车加" />
      <div className="st-gap" />
      <SwitchRow
        label="启用这首曲子"
        checked={a.enabled}
        note={a.enabled ? undefined : '停用后游戏里当它不存在,文件和设置都留着'}
        onChange={(enabled) => props.onPatch({ enabled })}
      />
      <div className="st-gap small" />

      <Section title="封面曲" help={TERMS.cover} />
      <SwitchRow label="设为封面曲" checked={isCover} note={coverNote} onChange={props.onCover} />
      <div className="st-gap small" />

      <Section title="这些背景切过来时放它" note="只读 · 在「背景」那一栏的「默认 BGM」里改" />
      {users.length > 0 ? (
        <ul className="st-bgm-users">
          {users.map((u) => {
            const thumb = sceneThumbUrl(u.asset, 120);
            return (
              <li key={u.id} className="st-bgm-user">
                {thumb ? <img src={thumb} alt="" draggable={false} loading="lazy" /> : <span className="st-bgm-user-blank" />}
                <span className="st-bgm-user-name">{u.label}</span>
                <span className="st-bgm-user-pack">{u.packName}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="st-bgm-note">还没有背景把它当默认 BGM</div>
      )}

      <Section title="文件" />
      <div className="st-bgm-file">
        <Icon name="music" size={14} />
        <span>{file}</span>
      </div>
      {a.mime === 'audio/ogg' && <div className="st-bgm-note warn">iPhone 可能放不了 OGG,建议换成 MP3</div>}
    </Inspector>
  );
}
