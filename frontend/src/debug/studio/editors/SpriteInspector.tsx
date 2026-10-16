/**
 * 立绘编辑器的右栏:选中的那张差分 —— 名字(点了改)、描述、别名、启用开关、入场动效;
 * 下面「位置」是整套立绘共用的(缩放、偏移、按面部对齐);底部替换图片、删除差分(点两下)。
 */

import type { PackSprite, SpriteEffect, SpriteLayout, SpritePayload } from '../../lib/api';
import { FX_BUBBLES, FX_MOTIONS, FX_SOUNDS, normalizeEffect } from '../../plugins/spriteFx';
import { ZOOM_RANGE, type FaceBox } from '../../plugins/spriteLayout';
import { FaceThumb } from '../FaceThumb';
import { Icon } from '../icons';
import { TERMS, studioSoundName } from '../terms';
import {
  Btn,
  Chip,
  CommitTextarea,
  DeleteBtn,
  FieldLabel,
  Inspector,
  InspectorHead,
  NumberPair,
  Section,
  SelectRow,
  SliderRow,
  SwitchRow,
  TagsField,
  TitleEdit,
  type SelectOption,
} from '../ui';
import { nextEffect } from './spriteEdit';

const NONE: SelectOption = { value: '', label: '无' };
const options = (list: readonly { id: string; name: string }[]): SelectOption[] => [
  NONE,
  ...list.map((o) => ({ value: o.id, label: o.name })),
];
const MOTION_OPTIONS = options(FX_MOTIONS);
const BUBBLE_OPTIONS = options(FX_BUBBLES);
// 卡编辑器里「气泡」叫「漫符」(galgame 的说法);插件页的清单不动
const SOUND_OPTIONS = options(FX_SOUNDS.map((s) => ({ id: s.id, name: studioSoundName(s.name) })));
const EMPTY_FX: SpriteEffect = { motion: null, bubble: null, sound: null };

const isDefaultLayout = (l: SpriteLayout) => l.zoom === 1 && l.dx === 0 && l.dy === 0;
const round = (v: number) => Math.round(v * 1000) / 1000;

export interface SpriteInspectorProps {
  sprite: PackSprite;
  face: FaceBox | null;
  /** 第几张(从 1 数)、一共几张 */
  index: number;
  total: number;
  isDefault: boolean;
  /** 整套立绘的摆法 */
  layout: SpriteLayout;
  /** 这套图一张脸都没认出来(按面部对齐不起作用) */
  noFaces: boolean;
  /** 绑着这套立绘的卡有几张;两张以上才在位置那里提一句 */
  cardCount?: number;
  onRename: (label: string) => Promise<boolean>;
  onPatch: (patch: SpritePayload) => void;
  /** 改了入场动效(存完在舞台上放一次) */
  onEffect: (effect: SpriteEffect | null) => void;
  onPreview: () => void;
  onMakeDefault: () => void;
  onLayout: (next: SpriteLayout) => void;
  onReplace: () => void;
  onDelete: () => void;
}

export function SpriteInspector(props: SpriteInspectorProps) {
  const { sprite: s, layout, total, cardCount = 0 } = props;
  const fx = normalizeEffect(s.effect) ?? EMPTY_FX;
  const hasFx = Boolean(fx.motion || fx.bubble || fx.sound);
  const shared = `整组 ${total} 张差分共用${cardCount >= 2 ? ` · 绑定此立绘的 ${cardCount} 张卡同步生效` : ''}`;

  return (
    <Inspector
      label={`调整「${s.label}」`}
      head={
        <InspectorHead
          media={<FaceThumb sprite={s} face={props.face} className="st-ihead-media" />}
          title={<TitleEdit key={s.id} value={s.label} label="差分名" onCommit={props.onRename} />}
          badge={
            props.isDefault ? (
              <>
                <Chip strong>
                  <Icon name="star" size={11} fill />
                  默认差分
                </Chip>
                <span>无明确情绪时使用</span>
              </>
            ) : (
              <>
                {!s.enabled && <Chip>已停用</Chip>}
                <span>
                  第 {props.index} 张 · 共 {total} 张
                </span>
                <button
                  type="button"
                  className="st-link small"
                  disabled={!s.enabled}
                  title={s.enabled ? '挪到第一张:AI 没写表情、或写的对不上时用它' : '先启用这张差分'}
                  onClick={props.onMakeDefault}
                >
                  设为默认差分
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
          <DeleteBtn small label="删除差分" onConfirm={props.onDelete} />
        </>
      }
    >
      <Section title="描述" help={TERMS.desc} first />
      <CommitTextarea
        key={`desc:${s.id}`}
        value={s.description}
        rows={3}
        placeholder="什么时候用这张,比如:闭着嘴微笑,平常说话时用"
        onCommit={(description) => props.onPatch({ description })}
      />
      <div className="st-gap" />
      <FieldLabel text="别名" help={TERMS.alias} />
      <TagsField values={s.aliases} onChange={(aliases) => props.onPatch({ aliases })} placeholder="比如 smile,回车加" />
      <div className="st-gap" />
      <SwitchRow
        label="启用这张差分"
        checked={s.enabled}
        note={s.enabled ? undefined : '停用后游戏里当它不存在,图和设置都留着'}
        onChange={(enabled) => props.onPatch({ enabled })}
      />
      <div className="st-gap small" />

      <Section
        title="入场动效"
        help={TERMS.fx}
        right={
          <Btn small icon="play" disabled={!hasFx} onClick={props.onPreview}>
            预览
          </Btn>
        }
      />
      <SelectRow
        label="动作"
        help={TERMS.motion}
        value={fx.motion ?? ''}
        options={MOTION_OPTIONS}
        onChange={(v) => props.onEffect(nextEffect(s.effect, { motion: v || null }))}
      />
      <SelectRow
        label="漫符"
        help={TERMS.manpu}
        value={fx.bubble ?? ''}
        options={BUBBLE_OPTIONS}
        onChange={(v) => props.onEffect(nextEffect(s.effect, { bubble: v || null }))}
      />
      <SelectRow
        label="音效"
        help={TERMS.sound}
        value={fx.sound ?? ''}
        options={SOUND_OPTIONS}
        onChange={(v) => props.onEffect(nextEffect(s.effect, { sound: v || null }))}
      />
      <div className="st-gap small" />

      <Section
        title="位置"
        help={TERMS.pos}
        note={shared}
        right={
          <button
            type="button"
            className="st-link small"
            disabled={isDefaultLayout(layout)}
            onClick={() => props.onLayout({ ...layout, zoom: 1, dx: 0, dy: 0 })}
          >
            恢复默认
          </button>
        }
      />
      <SwitchRow
        label="按面部自动对齐"
        checked={layout.auto}
        note={layout.auto && props.noFaces ? '这套图还没认出脸,先按撑满高度摆' : undefined}
        onChange={(auto) => props.onLayout({ ...layout, auto })}
      />
      <SliderRow
        label="缩放"
        min={ZOOM_RANGE.min}
        max={ZOOM_RANGE.max}
        step={0.01}
        value={layout.zoom}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(zoom) => props.onLayout({ ...layout, zoom })}
        onCommit={(zoom) => props.onLayout({ ...layout, zoom })}
      />
      <NumberPair
        label="偏移"
        x={layout.dx * 100}
        y={layout.dy * 100}
        min={-200}
        max={200}
        digits={1}
        hint="单位是舞台高度的 %;也可以在预览里直接拖动"
        onCommit={(x, y) => props.onLayout({ ...layout, dx: round(x / 100), dy: round(y / 100) })}
      />
    </Inspector>
  );
}
