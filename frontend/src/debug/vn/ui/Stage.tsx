/**
 * 统一的实机预览舞台(界面统一计划 U25):一块真的游戏画面——背景、立绘、CG、对话区——和游戏里一样的比例摆法。
 * 插件页(立绘 / 语音 / 背景 / CG)用,第 7 段的素材页也用这一个。
 *
 * 摆法、入场动效、CG 的几种放法都在 studio/preview/StagePreview.tsx(卡编辑器的实机预览一直在用,
 * 照 vn.css 的游戏画面写);这里在它上面只加插件页 / 素材页要的几样:
 *   label  左上小牌子的字:「实机预览 · 客厅 · 微笑」
 *   guide  一条虚线 + 小字(「头的高度 0.12」),照构图的 faceTop 画在立绘舞台里
 * 对话区和游戏里一样是对话区 A(没有框、底部淡压暗、细线、名字在线上方带声波、台词在线下),画法在 StagePreview 里,这里不用动。
 */

import type { ReactNode } from 'react';
import { StagePreview, type StagePreviewProps } from '../../studio/preview/StagePreview';
import { SPRITE_TOP } from '../../studio/preview/stageGeometry';
import './stage.css';

export type { StagePreviewProps, StagePreviewSprite, StageCgMode } from '../../studio/preview/StagePreview';

export interface StageProps extends Omit<StagePreviewProps, 'overlays'> {
  /** 立绘「头的高度」虚线:faceTop 是所有角色共用的构图(0–0.35);不给就不画 */
  guide?: { faceTop: number; text: string } | null;
  /** 随便摆的一层(子元素自己 position: absolute),画在虚线上面 */
  overlays?: ReactNode;
}

/** 虚线离舞台顶多远(0–1):立绘舞台从 SPRITE_TOP 开始,faceTop 是占立绘舞台高度的比例 */
export function guideTop(faceTop: number, aspect: 'wide' | 'tall' = 'wide'): number {
  const top = SPRITE_TOP[aspect];
  return top + Math.min(1, Math.max(0, faceTop)) * (1 - top);
}

export function Stage({ guide, overlays, aspect = 'wide', className, ...rest }: StageProps) {
  return (
    <StagePreview
      {...rest}
      aspect={aspect}
      className={`av-stage${className ? ` ${className}` : ''}`}
      overlays={
        guide || overlays ? (
          <>
            {guide && (
              <div className="av-stage-guide" style={{ top: `${(guideTop(guide.faceTop, aspect) * 100).toFixed(2)}%` }} aria-hidden="true">
                <span>{guide.text}</span>
              </div>
            )}
            {overlays}
          </>
        ) : undefined
      }
    />
  );
}
