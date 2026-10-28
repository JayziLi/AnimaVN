import { useRef, useState, type ReactNode } from 'react';
import { Help } from '../ui/Help';
import { usePhone } from './usePhone';
import './settingRow.css';

/**
 * 设置页的一行:名字(宋体 + 斜体英文)| 控件 + 说明 | 右边当前值 + 「恢复默认」。
 * 游戏设置页和生图卡带(plugins/imagegen,只能内核给它用,它不能被内核 import)用的是同一个。
 * 样子都写在 .vn-sp 下面(设置页那张纸),放在别处不生效。
 *
 * open:条件行(特效音量、语音那几行、最多等)。false = 收起、不可点,展开收起有过渡;不传 = 一直在。
 * changed:改过的项,名字前一个小点;和 onReset 一起,行尾出「恢复默认」。
 */
export interface SettingRowProps {
  /** 跳转用:data-row,「去调文字速度」按它找到那一行 */
  id?: string;
  name: ReactNode;
  /** 名字下面的斜体英文(NovelAI 网页上的叫法等) */
  en?: string;
  beta?: boolean;
  /** 名字旁的小「?」,悬停说明 */
  tip?: string;
  /** 和插件页哪一页是同一个:说明后面一个小签,悬停说清楚 */
  dup?: string;
  note?: ReactNode;
  /** 说明后面一个「去 XX」 */
  jump?: { text: string; onJump: () => void };
  /** 右边的当前值 */
  value?: string;
  changed?: boolean;
  /** 悬停「恢复默认」时说恢复成什么 */
  resetText?: string;
  onReset?: () => void;
  open?: boolean;
  children?: ReactNode;
}

export function SettingRow({
  id,
  name,
  en,
  beta,
  tip,
  dup,
  note,
  jump,
  value,
  changed,
  resetText,
  onReset,
  open,
  children,
}: SettingRowProps) {
  const hasNote = Boolean(note) || Boolean(dup) || Boolean(jump);
  // 手机上没有悬停:「?」点一下在名字下面展开(.av-tips-tap 放大点击区)
  const phone = usePhone();
  // 手机上说明也收进名字旁的「?」(设计稿 phone.html 的设置行):点一下在控件下面展开。名字旁本来就有「?」(tip)的行照旧直接写
  const tapNote = phone && hasNote && !tip;
  const [noteOpen, setNoteOpen] = useState(false);
  const row = (
    <div className={`st-row${changed ? ' changed' : ''}`} data-row={id}>
      <div className={`st-k${phone ? ' av-tips-tap' : ''}`}>
        <span className="st-nm">{name}</span>
        {en && <span className="st-en">{en}</span>}
        {beta && <span className="av-chip beta">BETA</span>}
        {tip && <Help tip={tip} mode={phone ? 'tap' : 'hover'} />}
        {tapNote && (
          <button
            type="button"
            className="av-help"
            aria-label="说明"
            aria-expanded={noteOpen}
            onClick={() => setNoteOpen((v) => !v)}
          >
            ?
          </button>
        )}
      </div>
      <div className="st-c">
        <div className="st-ctl">{children}</div>
        {hasNote && (!tapNote || noteOpen) && (
          <div className={`st-note${tapNote ? ' av-tip-inline' : ''}`}>
            {note}
            {jump && (
              <button type="button" className="st-jump" onClick={jump.onJump}>
                {jump.text}
              </button>
            )}
            {dup && (
              <span className="st-dup" data-tip={`在「插件 · ${dup}」里改的也是这一个,两边一起变`}>
                和插件 · {dup}是同一个
              </span>
            )}
          </div>
        )}
      </div>
      <div className="st-t">
        {onReset && (
          <button
            type="button"
            className="st-reset"
            tabIndex={changed ? 0 : -1}
            title={resetText ? `恢复默认:${resetText}` : '恢复默认'}
            onClick={onReset}
          >
            恢复默认
          </button>
        )}
        {value && <span className="st-v av-num">{value}</span>}
      </div>
    </div>
  );
  return open === undefined ? row : <CondWrap open={open}>{row}</CondWrap>;
}

/** 条件出现的行:高度展开 + 淡入,不跳;收起时不可点、读屏读不到 */
export function CondWrap({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`st-cond${open ? ' open' : ''}`} inert={!open}>
      <div className="st-cond-in">{children}</div>
    </div>
  );
}

/** 一组的小标题(宋体 + 斜体英文);右边可以放个按钮 */
export function SettingGroupHead({
  title,
  en,
  note,
  children,
}: {
  title: ReactNode;
  en?: string;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="st-gh">
      <span className="zh">{title}</span>
      {en && <span className="en">{en}</span>}
      {note && <span className="st-gnote">{note}</span>}
      {children}
    </div>
  );
}

/** 出错的红字:红色圆底「!」+ 红字(夜纸上自己调亮);没有 text 时收起 */
export function SettingError({ text }: { text: string | null }) {
  // 收起的过程中还要把最后那句留着,不然字先没了、空条再缩
  const last = useRef('');
  if (text) last.current = text;
  return (
    <CondWrap open={Boolean(text)}>
      <div className="st-err" role="alert">
        <i aria-hidden="true">!</i>
        <span>{text ?? last.current}</span>
      </div>
    </CondWrap>
  );
}
