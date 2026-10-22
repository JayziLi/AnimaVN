/**
 * 导出角色包的面板(画布 step3 Main):
 *
 *   导出「刻晴」                                                  ×
 *   预览图 [图]          会带上                         点掉的不带
 *   [换一张][用卡头像]   ☑ 角色卡  刻晴 · 头像、开场白、世界书  0.4 MB(必带)
 *   分享说明             ☑ 立绘    [缩] 玉衡星 · 14 张 当前     21.3 MB
 *   [          ]         ☑ 背景 · BGM …                          17.5 MB
 *                          CG       没绑 CG 包
 *                          跟着走   认词记录、配对表…  跟着上面的包
 *                       ☑ 预设     刻晴 DeepSeek …               0.1 MB
 *                       不带  声音 · 人设 · 对话记录 · 你的 API key 和设置
 *   约 58 MB  存成 刻晴.animavn                         取消  导出
 *
 * 每行写什么、总大小、请求体由 exportModel.ts 算;这里只管勾选、说明、预览图和导出的状态。
 * 导出中按钮变「导出中…」;存好了关面板、提示「已存成 …」;失败面板不关,底下写原因。
 */

import { useEffect, useState } from 'react';
import { apiUrl, debugApi, type ExportBundleSummary, type ExportPreview } from '../../lib/api';
import { Icon } from '../../studio/icons';
import { TERMS } from '../../studio/terms';
import { Btn, HelpTip, Modal } from '../../studio/ui';
import type { Notify } from '../../studio/types';
import {
  absoluteUrl,
  bundleBody,
  cardLine,
  fileNameOf,
  initialChecks,
  KIND_LABEL,
  nextPreview,
  packRows,
  previewSrc,
  rowSize,
  stateBadge,
  totalBytes,
  totalLabel,
} from './exportModel';
import './export.css';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const resolve = (u: string) => absoluteUrl(u, apiUrl);

interface Props {
  cardId: string;
  /** 读出清单之前标题里先写的卡名 */
  cardName: string;
  notify: Notify;
  onClose: () => void;
}

export function ExportBundleDialog({ cardId, cardName, notify, onClose }: Props) {
  const [summary, setSummary] = useState<ExportBundleSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [withPreset, setWithPreset] = useState(true);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<ExportPreview>({ kind: 'avatar' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    debugApi.exportBundleSummary(cardId).then(
      (s) => {
        if (!alive) return;
        setSummary(s);
        setChecks(initialChecks(s));
      },
      (e: unknown) => alive && setLoadError(errText(e)),
    );
    return () => {
      alive = false;
    };
  }, [cardId]);

  const cancel = () => {
    if (!busy) onClose();
  };

  const run = async () => {
    if (!summary || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await debugApi.exportBundle(
        cardId,
        bundleBody(summary, checks, withPreset, note, preview),
        fileNameOf(summary),
      );
      notify('ok', `已存成 ${saved.name}`);
      onClose();
    } catch (e) {
      setError(`导出失败:${errText(e)}`);
      setBusy(false);
    }
  };

  const title = summary?.title ?? cardName;
  const badge = summary ? stateBadge(summary) : null;
  const src = summary ? previewSrc(summary, preview, resolve) : null;
  const canSwitch = (summary?.previews.length ?? 0) > 1;

  return (
    <Modal
      className="exp-dialog"
      title={
        <span className="exp-head">
          <span>导出「{title}」</span>
          {badge && <span className="exp-badge">{badge}</span>}
          <span className="st-flex" />
          <button type="button" className="exp-close" aria-label="关闭" disabled={busy} onClick={cancel}>
            <Icon name="x" size={15} />
          </button>
        </span>
      }
      onCancel={cancel}
      footer={
        <>
          {summary && (
            <>
              <span className="exp-total">{totalLabel(totalBytes(summary, checks, withPreset))}</span>
              <span className="exp-file">存成 {fileNameOf(summary)}</span>
            </>
          )}
          <span className="st-flex" />
          <Btn onClick={cancel} disabled={busy}>
            取消
          </Btn>
          <Btn kind="primary" disabled={!summary || busy} onClick={() => void run()}>
            {busy ? '导出中…' : error ? '再试一次' : '导出'}
          </Btn>
        </>
      }
    >
      {!summary ? (
        <div className={`exp-loading${loadError ? ' error' : ''}`} role={loadError ? 'alert' : undefined}>
          {loadError ? `读不到要导出的东西:${loadError}` : '读取中…'}
        </div>
      ) : (
        <div className="exp-body">
          <div className="exp-side">
            <span className="exp-cap">预览图</span>
            {src ? <img className="exp-preview" src={src} alt="预览图" /> : <div className="exp-preview empty">没有图</div>}
            <div className="exp-side-btns">
              <Btn small disabled={busy || !canSwitch} onClick={() => setPreview((p) => nextPreview(summary, p))}>
                换一张
              </Btn>
              <Btn
                small
                disabled={busy || preview.kind === 'avatar'}
                onClick={() => setPreview({ kind: 'avatar' })}
              >
                用卡头像
              </Btn>
            </div>
            <label htmlFor="exp-note" className="exp-cap exp-note-cap">
              分享说明
              <HelpTip text={TERMS.shareNote} />
            </label>
            <textarea
              id="exp-note"
              className="exp-note"
              value={note}
              disabled={busy}
              placeholder="这是谁、怎么玩、建议配什么"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="exp-main">
            <div className="exp-list-head">
              <span className="exp-cap">会带上</span>
              <span className="st-flex" />
              <span className="exp-faint">点掉的不带</span>
            </div>
            <div className="exp-list">
              <label className="exp-row">
                <input type="checkbox" checked disabled aria-label="角色卡(必带)" />
                <span className="exp-kind">角色卡</span>
                <span className="exp-what">{cardLine(summary)}</span>
                <span className="exp-size">{rowSize(summary.card_bytes)}</span>
              </label>
              {packRows(summary).map((r) =>
                r.type === 'none' ? (
                  <div key={`none-${r.kind}`} className="exp-row dim">
                    <span className="exp-box-gap" />
                    <span className="exp-kind">{r.label}</span>
                    <span className="exp-what">{r.title}</span>
                  </div>
                ) : (
                  <label key={r.item.key} className={`exp-row${checks[r.item.key] === false ? ' off' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checks[r.item.key] !== false}
                      disabled={busy}
                      aria-label={`${KIND_LABEL[r.item.kind]} · ${r.item.name}`}
                      onChange={(e) => setChecks((c) => ({ ...c, [r.item.key]: e.target.checked }))}
                    />
                    <span className="exp-kind">{r.label}</span>
                    <span className="exp-what">
                      {r.item.thumb ? (
                        <img
                          className={`exp-thumb${r.item.kind === 'sprite' ? '' : ' wide'}`}
                          src={resolve(r.item.thumb)}
                          alt=""
                        />
                      ) : (
                        <span className={`exp-thumb empty${r.item.kind === 'sprite' ? '' : ' wide'}`} />
                      )}
                      <span className="exp-what-text">{r.title}</span>
                      {r.item.current && <span className="exp-current">当前</span>}
                    </span>
                    <span className="exp-size">{rowSize(r.item.bytes)}</span>
                  </label>
                ),
              )}
              {summary.follows.length > 0 && (
                <div className="exp-row">
                  <span className="exp-box-gap" />
                  <span className="exp-kind">
                    跟着走
                    <HelpTip text={TERMS.follows} />
                  </span>
                  <span className="exp-what body">{summary.follows.join('、')}</span>
                  <span className="exp-faint">跟着上面的包</span>
                </div>
              )}
              {summary.preset ? (
                <label className={`exp-row${withPreset ? '' : ' off'}`}>
                  <input
                    type="checkbox"
                    checked={withPreset}
                    disabled={busy}
                    aria-label="建议的预设"
                    onChange={(e) => setWithPreset(e.target.checked)}
                  />
                  <span className="exp-kind">预设</span>
                  <span className="exp-what stack">
                    <span className="exp-what-text">{summary.preset.name}</span>
                    <span className="exp-faint">只当建议:对方导入时另建一套,不动他自己的</span>
                  </span>
                  <span className="exp-size">{rowSize(summary.preset.bytes)}</span>
                </label>
              ) : (
                <div className="exp-row dim">
                  <span className="exp-box-gap" />
                  <span className="exp-kind">预设</span>
                  <span className="exp-what">没绑预设</span>
                </div>
              )}
            </div>
            {summary.not_included.length > 0 && (
              <div className="exp-not">
                <b>不带</b>
                <span>{summary.not_included.join(' · ')}</span>
              </div>
            )}
            {error && (
              <div className="exp-error" role="alert">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
