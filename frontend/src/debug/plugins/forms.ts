/**
 * 形态:同一个立绘包里的表情分几组,玩家在视觉小说里切换(素材架构 2.8:旧的形态切换是一个私有卡带,
 * 第 4 期换成「状态」)。内核只从这里拿形态的东西 —— 装了提供这些扩展点的卡带就用它的,没装就是「没有形态」:
 * 时间线不过形态门、顶栏没有按钮、CG 表格没有那一列、设置 → 数据没有「形态记号」那一行。
 * 用哪个在第一次用到时定下来、以后不变(cartridges.ts 的 lazyExtension),hook 的调用顺序不随卡带变。
 */

import type { ComponentType } from 'react';
import type { ChatEntry } from '../lib/chatEntry';
import {
  lazyExtension,
  type CgFormsExtension,
  type FormButtonProps,
  type FormsInput,
  type FormsState,
  type LegacyStateMark,
  type NamedSprite,
} from './cartridges';

const same = <T extends NamedSprite>(sprites: readonly T[]): readonly T[] => sprites;

/** 没有形态 */
export const NO_FORMS: FormsState = {
  enabled: false,
  current: null,
  lens: null,
  spritesNow: same,
  cgOkAt: undefined,
  cgOkNow: undefined,
  lensFor: () => null,
  switchAt: () => {},
};

function useNoForms(): FormsState {
  return NO_FORMS;
}

const formsExt = lazyExtension('useForms');
const buttonExt = lazyExtension('FormButton');
const cgFormsExt = lazyExtension('cgForms');
const nameExt = lazyExtension('formName');
const legacyMarksExt = lazyExtension('legacyStateMarks');

/** DebugApp 调:这张卡、这段对话的形态 */
export function useForms(o: FormsInput): FormsState {
  const impl = formsExt() ?? useNoForms;
  return impl(o);
}

/** 视觉小说顶栏的形态按钮;没有是 null */
export const formButton = (): ComponentType<FormButtonProps> | null => buttonExt() ?? null;

/** 插件页 CG 表格里「在哪些形态出」;没有是 null */
export const cgForms = (): CgFormsExtension | null => cgFormsExt() ?? null;

/** 形态给人看的名字 */
export const formName = (form: string): string => nameExt()?.(form) ?? form;

/** 以前的形态记号换算成的状态记号(旧形态卡带;没装是空的) */
export const legacyStateMarks = (chatId: string | null, entries: readonly ChatEntry[]): LegacyStateMark[] =>
  legacyMarksExt()?.(chatId, entries) ?? [];
