/**
 * 游戏里的「导出」(选角色名字旁的小号「导出」、局内菜单里的卡面板):设计稿 kit/transfer.js 的 exportDlg,
 * 10-23 用户「导出只留格式、勾选、分享说明和『导出为 - 星绘.animavn』,说明都收进小『?』」,10-24 加了顶上一格「名字」。
 *
 *   导出「星绘」  Export
 *   ───────────────────────────────────────────────
 *     预览图     名字 [星绘          ]
 *    [卡面]      [角色包 ?|只导卡 ?|给酒馆用户 ?]
 *   [换一张]     ☑ 角色卡 Card     星绘 · 头像、开场白、世界书   0.1 MB
 *   [用卡头像]   ☑ 立绘 Sprites    (头) 「星绘」· 14 张           18 MB
 *                ☑ 场景 Scenes     (图) …                        70 MB
 *                ☑ 声音 Voice      (喇叭) 星绘(日语)  只给自己用… 260 MB
 *                ☑ 预设 Preset     星绘 DeepSeek ?               0.1 MB
 *                分享说明 ?  [这是谁、怎么玩]
 *   ───────────────────────────────────────────────
 *   导出为 - 星绘.animavn                     取消  导出
 *
 * 调试台里还是原来那张深色的(ExportBundleDialog 的 ExportBundleConsole);每行写什么、请求体照旧由 exportModel.ts 算。
 * 「名字」只改存下来的文件名;「只导卡」= 卡本身的 .json(和调试台「导出 → 只导卡」同一份,带头像);「给酒馆用户」还没做,灰着。
 * 原来摊开写的「不带 人设 · 对话记录……」「跟着走 认词记录……」收进「角色包」旁的「?」。
 */

import { useEffect, useState } from 'react';
import { apiUrl, debugApi, type ExportBundleItem, type ExportBundleSummary, type ExportPackKind, type ExportPreview } from '../../lib/api';
import { cardFromStored, cardToFileJson } from '../../lib/cardStore';
import { saveBlob } from '../../lib/download';
import { Help } from '../../vn/ui/Help';
import type { Notify } from '../../studio/types';
import { absoluteUrl, bundleBody, busyNote, cardLine, fileNameOf, initialChecks, nextPreview, previewSrc, rowSize, voiceNotes } from './exportModel';
import { TransferDialog } from './TransferDialog';
import '../../vn/vnPick.css';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const resolve = (u: string) => absoluteUrl(u, apiUrl);

type Fmt = 'bundle' | 'json' | 'tavern';

/** 「?」里的说明(照程序真实行为写;界面上不摊开写) */
const TIP = {
  bundle: '卡和绑着的立绘、背景、BGM、CG、声音、预设打成一个 .animavn,发给别人或换电脑用。',
  json: '只存卡本身(.json):资料、开场白、世界书,连头像。立绘、声音、背景不带。',
  tavern: '酒馆的角色卡是一张 PNG(卡的资料写在图里),表情差分另外打成 zip。还没做。',
  shareNote: '对方导入完成时会看到这段话。',
  preset: '只当建议:对方导入时另建一套,不动他自己的。',
};

const KIND: Record<ExportPackKind, { k: string; en: string }> = {
  sprite: { k: '立绘', en: 'Sprites' },
  scene: { k: '场景', en: 'Scenes' },
  cg: { k: 'CG', en: 'CG' },
  voice: { k: '声音', en: 'Voice' },
};
const ORDER: readonly ExportPackKind[] = ['sprite', 'scene', 'cg', 'voice'];

/** 导出的名字:玩家填了用填的,没填 = 卡名;文件名里不能有的字(\ / : * ? " < > |)换成空格 */
function exportName(typed: string, fallback: string): string {
  const t = typed.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || fallback;
}

const SPEAKER = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);

interface Props {
  cardId: string;
  cardName: string;
  notify: Notify;
  onClose: () => void;
}

export function ExportPaper({ cardId, cardName, notify, onClose }: Props) {
  const [summary, setSummary] = useState<ExportBundleSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [withPreset, setWithPreset] = useState(true);
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [fmt, setFmt] = useState<Fmt>('bundle');
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

  const title = summary?.title ?? cardName;
  const base = exportName(name, title || '角色');
  const file = fmt === 'json' ? `${base}.json` : name.trim() || !summary ? `${base}.animavn` : fileNameOf(summary);

  const cancel = () => {
    if (!busy) onClose();
  };

  const run = async () => {
    if (!summary || busy || fmt === 'tavern') return;
    setBusy(true);
    setError(null);
    try {
      if (fmt === 'json') {
        const [row, avatar] = await Promise.all([debugApi.getCard(cardId), debugApi.getCardAvatar(cardId)]);
        saveBlob(new Blob([cardToFileJson(cardFromStored(row), avatar)], { type: 'application/json' }), file);
        notify('ok', `已存成 ${file}`);
      } else {
        const body = bundleBody(summary, checks, withPreset, note, preview);
        if (name.trim()) {
          // 起了名字:照这个名字存(后端回应头里的文件名是卡名)
          const res = await fetch(apiUrl(`/api/export/bundle/${encodeURIComponent(cardId)}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
          saveBlob(await res.blob(), file);
          notify('ok', `已存成 ${file}`);
        } else {
          const saved = await debugApi.exportBundle(cardId, body, fileNameOf(summary));
          notify('ok', `已存成 ${saved.name}`);
        }
      }
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const src = summary ? previewSrc(summary, preview, resolve) : null;
  const canSwitch = (summary?.previews.length ?? 0) > 1;
  const waiting = busy && summary && fmt === 'bundle' ? busyNote(summary, checks) : null;
  const bundleTip = summary
    ? [
        TIP.bundle,
        summary.follows.length > 0 ? `跟着包一起走:${summary.follows.join('、')}。` : '',
        summary.not_included.length > 0 ? `不带:${summary.not_included.join('、')}。` : '',
      ].join('')
    : TIP.bundle;

  const fmts: { v: Fmt; name: string; tip: string; dis?: boolean }[] = [
    { v: 'bundle', name: '角色包', tip: bundleTip },
    { v: 'json', name: '只导卡', tip: TIP.json },
    { v: 'tavern', name: '给酒馆用户', tip: TIP.tavern, dis: true },
  ];

  return (
    <TransferDialog
      title={`导出「${title}」`}
      en="Export"
      width={820}
      className="export"
      onCancel={cancel}
      foot={
        <>
          {waiting ? <span className="tf-busy">{waiting}</span> : <span className="tf-file">导出为 - {file}</span>}
          <span className="tf-flex" />
          <button type="button" className="av-btn" disabled={busy} onClick={cancel}>
            取消
          </button>
          <button type="button" className="av-btn primary" disabled={!summary || busy} onClick={() => void run()}>
            {busy ? '导出中…' : error ? '再试一次' : '导出'}
          </button>
        </>
      }
    >
      {!summary ? (
        <div className="tf-db">
          {loadError ? (
            <ul className="tf-errs" role="alert">
              <li>
                <span className="av-dot bad" />
                <span>
                  <b>读不到要导出的东西</b>
                  <code>{loadError}</code>
                </span>
              </li>
            </ul>
          ) : (
            <span className="tf-busy">读取中…</span>
          )}
        </div>
      ) : (
        <div className="tf-db two">
          <div className="tf-xpic">
            <span className="tf-cap">预览图</span>
            <span className="tf-cf" role="img" aria-label={`预览图:${title}`}>
              <span className="pk-tile">
                <svg className="ofr" viewBox="-14 -14 160 264" aria-hidden="true">
                  <path d="M-10 -6H130M-10 242H130M-6 -10V246M126 -10V246" />
                </svg>
                <span className="cl">
                  <span className="art">
                    {src ? (
                      <>
                        <img className="bed" src={src} alt="" draggable={false} />
                        <img className="av" src={src} alt="" draggable={false} />
                      </>
                    ) : (
                      <>
                        <img className="bg" src="/vn/ui/sky-pick.svg" alt="" draggable={false} />
                        <img className="logo" src="/anima-logo.svg" alt="" draggable={false} />
                      </>
                    )}
                  </span>
                  <span className="cap">
                    <b>{title}</b>
                    <i className="ul" />
                  </span>
                  <img className="mk" src="/anima-logo.svg" alt="" draggable={false} />
                </span>
              </span>
            </span>
            <span className="b">
              <button type="button" className="av-btn sm" disabled={busy || !canSwitch} onClick={() => setPreview((p) => nextPreview(summary, p))}>
                换一张
              </button>
              <button type="button" className="av-btn sm" disabled={busy || preview.kind === 'avatar'} onClick={() => setPreview({ kind: 'avatar' })}>
                用卡头像
              </button>
            </span>
          </div>

          <div className="tf-xform">
            <label className="tf-xname">
              <span className="tf-cap">名字</span>
              <input
                className="tf-input"
                type="text"
                value={name}
                placeholder={title}
                aria-label="导出的名字"
                spellCheck={false}
                maxLength={60}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="av-seg tf-fmt" role="radiogroup" aria-label="导出成什么">
              {fmts.map((f) => (
                <span key={f.v} className={`c${fmt === f.v ? ' on' : ''}${f.dis ? ' dis' : ''}`}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={fmt === f.v}
                    aria-disabled={f.dis || undefined}
                    disabled={busy}
                    onClick={() => !f.dis && setFmt(f.v)}
                  >
                    {f.name}
                  </button>
                  <Help tip={f.tip} />
                </span>
              ))}
            </div>

            {fmt === 'bundle' && (
              <>
                <div className="tf-exp">
                  <label className="tf-erow">
                    <input type="checkbox" checked disabled aria-label="角色卡(必带)" />
                    <span className="k">
                      <b>角色卡</b>
                      <i>Card</i>
                    </span>
                    <span className="what">
                      <span className="t">
                        <span>{cardLine(summary)}</span>
                      </span>
                    </span>
                    <span className="sz">{rowSize(summary.card_bytes)}</span>
                  </label>
                  {ORDER.flatMap((kind) =>
                    summary.items
                      .filter((it) => it.kind === kind)
                      .map((it, i) => (
                        <PackRow
                          key={it.key}
                          item={it}
                          first={i === 0}
                          checked={checks[it.key] !== false}
                          busy={busy}
                          onCheck={(on) => setChecks((c) => ({ ...c, [it.key]: on }))}
                        />
                      )),
                  )}
                  {summary.preset && (
                    <label className={`tf-erow${withPreset ? '' : ' off'}`}>
                      <input type="checkbox" checked={withPreset} disabled={busy} aria-label="预设" onChange={(e) => setWithPreset(e.target.checked)} />
                      <span className="k">
                        <b>预设</b>
                        <i>Preset</i>
                      </span>
                      <span className="what">
                        <span className="t">
                          <span>
                            {summary.preset.name}
                            <Help tip={TIP.preset} />
                          </span>
                        </span>
                      </span>
                      <span className="sz">{rowSize(summary.preset.bytes)}</span>
                    </label>
                  )}
                </div>
                <label className="tf-cap" htmlFor="tf-note">
                  分享说明
                  <Help tip={TIP.shareNote} />
                </label>
                <textarea
                  id="tf-note"
                  className="tf-ta"
                  rows={3}
                  value={note}
                  disabled={busy}
                  placeholder="这是谁、怎么玩"
                  onChange={(e) => setNote(e.target.value)}
                />
              </>
            )}
            {error && (
              <ul className="tf-errs" role="alert">
                <li>
                  <span className="av-dot bad" />
                  <span>
                    <b>导出失败</b>
                    <code>{error}</code>
                  </span>
                </li>
              </ul>
            )}
          </div>
        </div>
      )}
    </TransferDialog>
  );
}

/** 一个包一行:立绘是按脸的小圆头,背景 / CG 是小横图,声音是喇叭;声音底下可能有黄字(别发给别人)和灰字(只能带设置) */
function PackRow({
  item,
  first,
  checked,
  busy,
  onCheck,
}: {
  item: ExportBundleItem;
  first: boolean;
  checked: boolean;
  busy: boolean;
  onCheck: (on: boolean) => void;
}) {
  const label = KIND[item.kind];
  const notes = voiceNotes(item);
  const title = item.detail ? `${item.name} · ${item.detail}` : item.name;
  const thumb =
    item.kind === 'voice' ? (
      <i className="tf-ic">{SPEAKER}</i>
    ) : item.thumb ? (
      <img className={item.kind === 'sprite' ? 'tf-face' : 'tf-bgt'} src={resolve(item.thumb)} alt="" draggable={false} />
    ) : null;
  return (
    <label className={`tf-erow${checked ? '' : ' off'}`}>
      <input type="checkbox" checked={checked} disabled={busy} aria-label={`${label.k} · ${item.name}`} onChange={(e) => onCheck(e.target.checked)} />
      <span className="k">
        {first && (
          <>
            <b>{label.k}</b>
            <i>{label.en}</i>
          </>
        )}
      </span>
      <span className="what">
        {thumb}
        <span className="t">
          <span>{title}</span>
          {notes.warn && <small className="warn">{notes.warn}</small>}
          {notes.missing && <small>{notes.missing}</small>}
        </span>
      </span>
      <span className="sz">{rowSize(item.bytes)}</span>
    </label>
  );
}
