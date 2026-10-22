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
 *   ☑ 也导入作者建议的预设「…」                     另建一套,绑到这张卡
 *   这个包里没有声音:……                                 取消  导入
 *
 * 每行写什么由 importModel.ts 的 bundleView 算;执行失败时框不关,底下写原因(和 ImportConfirm 一样)。
 */

import { apiUrl, type ImportGroup } from '../lib/api';
import { formatSize } from '../library/libraryModel';
import { Icon } from '../studio/icons';
import { Btn, Modal } from '../studio/ui';
import { bundleView } from './importModel';
import './importer.css';

/** 暂存目录里的图是「/api/import/…」,接上后端地址 */
const src = (url: string) => (url.startsWith('/') ? apiUrl(url) : url);

interface Props {
  group: ImportGroup;
  /** 拖进来的文件名;不知道时是 null */
  source: string | null;
  withPreset: boolean;
  onPreset: (on: boolean) => void;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ImportBundle({ group, source, withPreset, onPreset, busy, error, onCancel, onConfirm }: Props) {
  const v = bundleView(group);
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
          {v.voiceNote && <span className="imp-b-foot-note">{v.voiceNote}</span>}
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
