/**
 * 拖进来的是一个角色包(.animavn)时的导入确认(画布 step3 ImportBundle):
 *
 *   导入角色包  刻晴.animavn · 58 MB                                ×
 *   [预览图]  刻晴 [普通 / 约会]
 *             分享说明
 *             「原神刻晴,日语配音……」
 *   会新建这些  都是另存的一份,不动你已有的
 *     角色卡     刻晴 2              你已经有一张「刻晴」,这张叫「刻晴 2」
 *     立绘       [缩][缩] 玉衡星 · 14 张、…
 *     背景 · BGM [缩] 原神 · 璃月 · 16 张背景、7 首 BGM
 *     跟着走     认词记录、配对表、立绘位置和特效
 *     声音       🎤 刻晴(日语) · 12 段参考 + 2 个模型        → [本机 GPT-SoVITS ▾]
 *                导完就能念 / 语音服务在另一台电脑,导完要把文件放过去
 *   ☑ 也导入作者建议的预设「…」                     另建一套,绑到这张卡
 *   这个包里没有声音:……(带了声音时:模型文件加载时会执行里面的代码……)    取消  导入
 *
 * 每行写什么由 importModel.ts 的 bundleView 算;执行失败时框不关,底下写原因(和 ImportConfirm 一样)。
 */

import { apiUrl, type ImportGroup, type TtsConnection } from '../lib/api';
import { formatSize } from '../library/libraryModel';
import { Icon } from '../studio/icons';
import { Btn, Modal } from '../studio/ui';
import { bundleView, voiceLines, voiceTarget } from './importModel';
import { VoiceTargetPick } from './VoiceTargetPick';
import './importer.css';

/** 暂存目录里的图是「/api/import/…」,接上后端地址 */
const src = (url: string) => (url.startsWith('/') ? apiUrl(url) : url);

interface Props {
  group: ImportGroup;
  /** 拖进来的文件名;不知道时是 null */
  source: string | null;
  withPreset: boolean;
  onPreset: (on: boolean) => void;
  /** 声音导到哪个语音服务:选过的;没选过是 undefined(用后端给的默认) */
  voiceConnection: string | undefined;
  onVoiceConnection: (id: string) => void;
  /** 语音服务列表;没读到是 null */
  connections: readonly TtsConnection[] | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ImportBundle({
  group,
  source,
  withPreset,
  onPreset,
  voiceConnection,
  onVoiceConnection,
  connections,
  busy,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const v = bundleView(group);
  const voices = voiceLines(group);
  const target = voiceTarget(group, voiceConnection, connections);
  const meta = [source, v.bytes > 0 ? formatSize(v.bytes) : null].filter(Boolean).join(' · ');
  return (
    <Modal
      className="imp-confirm imp-bundle"
      title={
        <span className="imp-b-head">
          <span>导入角色包</span>
          {meta && <span className="imp-b-meta">{meta}</span>}
          <span className="st-flex" />
          <button type="button" className="imp-b-close" aria-label="关闭" disabled={busy} onClick={onCancel}>
            <Icon name="x" size={15} />
          </button>
        </span>
      }
      onCancel={onCancel}
      footer={
        <>
          {(v.voiceNote ?? v.codeWarn) && <span className="imp-b-foot-note">{v.voiceNote ?? v.codeWarn}</span>}
          <span className="st-flex" />
          <Btn onClick={onCancel} disabled={busy}>
            取消
          </Btn>
          <Btn kind="primary" autoFocus disabled={busy} onClick={onConfirm}>
            {busy ? '正在导入…' : error ? '再试一次' : '导入'}
          </Btn>
        </>
      }
    >
      <div className="imp-b-intro">
        {v.preview ? (
          <img className="imp-b-preview" src={src(v.preview)} alt={v.name} />
        ) : (
          <span className="imp-b-preview empty">
            <Icon name="user" size={28} />
          </span>
        )}
        <div className="imp-b-who">
          <div className="imp-b-name">
            <span>{v.name}</span>
            {v.badge && <span className="imp-b-badge">{v.badge}</span>}
          </div>
          {v.note ? (
            <>
              <span className="imp-b-cap">分享说明</span>
              <p className="imp-b-note">{v.note}</p>
            </>
          ) : (
            <span className="imp-b-cap">作者没写分享说明</span>
          )}
        </div>
      </div>

      <div className="imp-b-new">
        <div className="imp-b-new-head">
          <span className="imp-b-cap">会新建这些</span>
          <span className="imp-b-faint">都是另存的一份,不动你已有的</span>
        </div>
        <div className="imp-b-list">
          {v.rows.map((r) => (
            <div key={r.key} className="imp-b-row">
              <span className="imp-b-kind">{r.label}</span>
              <span className={`imp-b-what${r.key === 'follows' ? ' body' : ''}`}>
                {r.thumbs.map((t, i) => (
                  <img key={i} className={`imp-b-thumb${r.wide ? ' wide' : ''}`} src={src(t)} alt="" />
                ))}
                <span className="imp-b-text">{r.text}</span>
              </span>
              {r.warn && <span className="imp-b-warn">{r.warn}</span>}
            </div>
          ))}
          {voices.map((l, i) => (
            <div key={l.key} className="imp-b-row">
              <span className="imp-b-kind">{l.label}</span>
              <span className="imp-b-what stack">
                <span className="imp-b-text">
                  <Icon name="mic" size={13} />
                  {l.text}
                </span>
                {i === 0 && <span className="imp-b-faint">{target.status}</span>}
                {l.missing && <span className="imp-b-faint">{l.missing}</span>}
              </span>
              {i === 0 && <VoiceTargetPick target={target} disabled={busy} onPick={onVoiceConnection} />}
            </div>
          ))}
        </div>

        {v.preset && (
          <label className="imp-b-preset">
            <input type="checkbox" checked={withPreset} disabled={busy} onChange={(e) => onPreset(e.target.checked)} />
            <span className="imp-b-preset-label">{v.preset.label}</span>
            <span className="imp-b-faint">{v.preset.hint}</span>
          </label>
        )}

        {error && (
          <div className="imp-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
