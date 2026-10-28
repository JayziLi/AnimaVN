import { useEffect, useRef, useState } from 'react';
import { errorMain, errorTitle, firstLine, type GenFail } from './genFail';
import { FrostLayer } from './ui/FrostLayer';
import { PaperButton } from './ui/PaperButton';
import { useFrost } from './ui/useFrost';
import { popThemeClass, type PopTheme } from './ui/logic';
import './vnError.css';

const CHEV = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** 原文下面那行淡字:该怎么办(设计稿 whole.js 的 ERR[].tip);按短标题挑 */
const TIPS: Record<string, string> = {
  这条回复被撤回了: '公网版审核掐断时整条撤掉,写出来的也不留;重来会让她重新写。',
  连接还没设好: '在菜单「模型」里把这条连接填好(key、模型名),再重试。',
  密钥不对: '在菜单「模型」里换一个密钥,或者先换个模型。',
  余额不足: '充值以后再重试,或者先换个模型。',
  没有权限: '这个 key 用不了这个模型;先换个模型,或者在「模型」页换密钥。',
  找不到这个模型: '模型名可能拼错了,或者这条连接上没有它;先换个模型。',
};
const RETRY_TIP = '你说的那句还留着,重试会重新发。';

/**
 * 模型报错纸卡:挂在台词上方(对话区这时停在你说的那句)。短标题 + 一行原文 + 「重试 / 换模型 ▾ / 看详细」。
 * 「换模型」从这条连接拉到过的模型里选,选了马上重新生成;「看详细」在纸卡上面展开完整报错。
 * 要放在定位过的容器里;点击、右键都不往下传(底下是对话框,点一下会翻页)。
 */
export function ModelError({
  fail,
  said,
  sentBefore,
  theme = 'white',
  frostSrc,
  onOpenModels,
}: {
  fail: GenFail;
  /** 你说的那句(详情里「发出去的」) */
  said: string;
  /** 前面还有几条一起发了 */
  sentBefore: number;
  theme?: PopTheme;
  /** 主题「玻璃」时垫在卡里的这一幕的背景图(糊开):压在她身上也不会透出她来;别的主题不用 */
  frostSrc?: string;
  /** 「去模型页」 */
  onOpenModels?: () => void;
}) {
  const [pop, setPop] = useState(false);
  const [detail, setDetail] = useState(false);
  const [copied, setCopied] = useState(false);
  const main = errorMain(fail.message);
  const title = errorTitle(fail.message);
  const cut = title === '这条回复被撤回了';
  const box = useRef<HTMLDivElement>(null);
  const frost = useFrost(box);
  const frosted = theme === 'glass' && Boolean(frostSrc);

  // Esc 先收小菜单 / 详情,再往外;点卡外面收小菜单
  useEffect(() => {
    if (!pop && !detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      if (pop) setPop(false);
      else setDetail(false);
    };
    const onDown = (e: PointerEvent) => {
      if (pop && !(e.target as Element | null)?.closest('.vn-err-pickwrap')) setPop(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [pop, detail]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      ref={box}
      className={`vn-err av-pcard ${popThemeClass(theme)}${frosted ? ' av-frosted' : ''}`}
      role="alert"
      onClick={stop}
      onContextMenu={stop}
    >
      {frosted && <FrostLayer src={frostSrc} style={frost} />}
      <span className="av-eyebrow">Error</span>
      <div className="vn-err-t">
        <i className="av-dot bad" />
        <span>没拿到回复</span>
        <b>{title}</b>
      </div>
      <div className="vn-err-raw" title={fail.message}>
        {firstLine(fail.message)}
      </div>
      <p className="vn-err-tip">{TIPS[title] ?? RETRY_TIP}</p>
      <div className="vn-err-acts">
        <PaperButton sm kind={main === 'retry' ? 'primary' : 'normal'} onClick={fail.onRetry}>
          {cut ? '重来' : '重试'}
        </PaperButton>
        <span className="vn-err-pickwrap">
          <PaperButton
            sm
            kind={main === 'model' ? 'primary' : 'normal'}
            aria-expanded={pop}
            aria-haspopup="menu"
            onClick={() => setPop((v) => !v)}
          >
            换模型
            {CHEV}
          </PaperButton>
          {pop && (
            <div className={`vn-err-pop av-pcard ${popThemeClass(theme, true)} av-pop-in`} role="menu">
              <div className="cap">换个模型,接着发刚才那句</div>
              {fail.models.length === 0 && <div className="cap none">这条连接还没拉过模型列表</div>}
              <div className="list">
                {fail.models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="menuitem"
                    className={`it${m === fail.model ? ' on' : ''}`}
                    onClick={() => {
                      setPop(false);
                      if (m === fail.model) return;
                      fail.onPickModel(m);
                    }}
                  >
                    <b>{m}</b>
                    {m === fail.model && <small>现在用的</small>}
                  </button>
                ))}
              </div>
              {onOpenModels && (
                <div className="ln">
                  <button type="button" className="av-link" onClick={onOpenModels}>
                    去「模型」页
                  </button>
                </div>
              )}
            </div>
          )}
        </span>
        <PaperButton sm kind="ghost" aria-expanded={detail} onClick={() => setDetail((v) => !v)}>
          看详细
        </PaperButton>
      </div>
      {detail && (
        <div className={`vn-err-detail av-pcard ${popThemeClass(theme, true)} av-pop-in`}>
          <dl>
            <dt>连接</dt>
            <dd>{fail.connection || '—'}</dd>
            <dt>模型</dt>
            <dd>{fail.model || '—'}</dd>
            <dt>原话</dt>
            <dd className="mono">{fail.message}</dd>
            <dt>发出去的</dt>
            <dd>
              「{said}」{sentBefore > 0 ? ` + 前面 ${sentBefore} 条` : ''}
            </dd>
          </dl>
          <div className="ft">
            <PaperButton
              sm
              onClick={() => {
                const text = `连接: ${fail.connection}\n模型: ${fail.model}\n原话: ${fail.message}`;
                void navigator.clipboard?.writeText(text).then(() => setCopied(true));
              }}
            >
              {copied ? '已复制' : '复制详情'}
            </PaperButton>
          </div>
        </div>
      )}
    </div>
  );
}
