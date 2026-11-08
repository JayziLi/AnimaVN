/**
 * 拖进来 / 选进来的是一个声音文件夹时的导入确认(画布 voice-import 的 Import):
 *
 *   导入声音  三月七_ja · 14 个文件 · 240 MB                                       ×
 *   名字      [三月七(日语)]            用文件夹名,认出是日语就加「(日语)」
 *   认出来的  模型 2 个  三月七_ja-e15.ckpt · 三月七_ja_e8_s400.pth
 *             参考音频 12 段  原文里有假名  念 [中文|日语]
 *   情绪      [平静] こんにちは……   (前 4 行)  还有 8 段 · 展开
 *             voice_031.wav 看不出情绪和原文,先不导……
 *   挂到      ◉ 台式机  最像:模型和参考音频都用上   ○ IndexTTS  只拿参考音频   ○ 笔记本  没有模型(灰)
 *   会怎样    台式机在另一台电脑:导完自动把文件送过去,送完就能念。
 *   模型文件加载时会执行里面的代码,只导入信得过的                              取消  导入
 *
 * 每行写什么由 importModel.ts 算;名字、语言、挂到哪条的状态在 ImportConfirm 里。执行失败时框不关,底下写原因(后端原文)。
 */

import { useState } from 'react';
import type { ImportGroup, TtsConnection } from '../lib/api';
import { formatSize } from '../library/libraryModel';
import { Icon } from '../studio/icons';
import { Btn, Modal } from '../studio/ui';
import {
  MODEL_CODE_WARN,
  VOICE_FOLDER_LANGS,
  voiceFolderDetail,
  voiceFolderEffect,
  voiceFolderPick,
  voiceFolderTargets,
  voiceFolderView,
} from './importModel';
import './importer.css';

interface Props {
  group: ImportGroup;
  /** 拖进来的文件名(只有一个文件时);不知道是 null,标题旁写文件夹名 */
  source: string | null;
  /** 名字框里的字(用户没改过是后端给的) */
  name: string;
  onName: (name: string) => void;
  /** 念哪种文字 */
  lang: string;
  onLang: (lang: string) => void;
  /** 选过的语音服务;没选过是 undefined(用后端推荐的) */
  connection: string | undefined;
  onConnection: (id: string) => void;
  /** 语音服务列表(判断本机 / 另一台电脑);没读到是 null */
  connections: readonly TtsConnection[] | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ImportVoiceFolder({
  group,
  source,
  name,
  onName,
  lang,
  onLang,
  connection,
  onConnection,
  connections,
  busy,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const d = voiceFolderDetail(group);
  if (!d) return null;
  const v = voiceFolderView(group, source, expanded);
  const rows = voiceFolderTargets(d);
  const picked = voiceFolderPick(d, connection);
  const effect = voiceFolderEffect(d, picked, connections);
  const meta = [v.meta.source, `${v.meta.files} 个文件`, v.meta.modelBytes > 0 ? formatSize(v.meta.modelBytes) : null]
    .filter(Boolean)
    .join(' · ');
  const langs = VOICE_FOLDER_LANGS.some((l) => l.value === lang) ? VOICE_FOLDER_LANGS : [...VOICE_FOLDER_LANGS, { value: lang, label: lang }];
  return (
    <Modal
      className="imp-confirm imp-vf"
      title={
        <span className="imp-b-head">
          <span>导入声音</span>
          <span className="imp-b-meta">{meta}</span>
          <span className="st-flex" />
          <button type="button" className="imp-b-close" aria-label="关闭" disabled={busy} onClick={onCancel}>
            <Icon name="x" size={15} />
          </button>
        </span>
      }
      onCancel={onCancel}
      footer={
        <>
          {d.models.length > 0 && <span className="imp-b-foot-note">{MODEL_CODE_WARN}</span>}
          <span className="st-flex" />
          <Btn onClick={onCancel} disabled={busy}>
            取消
          </Btn>
          <Btn kind="primary" autoFocus disabled={busy} onClick={onConfirm}>
            {busy ? '正在导入…' : error ? '再试一次' : v.existing ? '用已有的' : '导入'}
          </Btn>
        </>
      }
    >
      <div className="imp-vf-grid">
        <label className="imp-vf-k" htmlFor="imp-vf-name">
          名字
        </label>
        <div className="imp-vf-v">
          <input
            id="imp-vf-name"
            className="st-input imp-vf-name"
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(e) => onName(e.target.value)}
          />
          {v.existing && <span className="imp-vf-chip">素材里已经有一样的</span>}
        </div>

        <span className="imp-vf-k">认出来的</span>
        <div className="imp-vf-v col">
          <div className="imp-vf-line">
            <span className="imp-vf-sub">模型</span>
            <b>{v.models.count > 0 ? `${v.models.count} 个` : '没有'}</b>
            {v.models.names && <span className="imp-vf-mono">{v.models.names}</span>}
          </div>
          <div className="imp-vf-line">
            <span className="imp-vf-sub">参考音频</span>
            <b>{v.refCount} 段</b>
            {v.kana && <span className="imp-b-faint">原文里有假名</span>}
            <span className="imp-vf-sub lead">念</span>
            <span className="imp-vf-seg" role="group" aria-label="念哪种文字">
              {langs.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  aria-pressed={lang === l.value}
                  disabled={busy}
                  className={lang === l.value ? 'on' : ''}
                  onClick={() => onLang(l.value)}
                >
                  {l.label}
                </button>
              ))}
            </span>
          </div>
        </div>

        <span className="imp-vf-k">情绪</span>
        <div className="imp-vf-v col">
          {v.emotions.map((e, i) => (
            <div key={`${e.label}-${i}`} className="imp-vf-emo">
              <span className="imp-vf-tag">{e.label}</span>
              <span className="imp-vf-text" title={e.text}>
                {e.text}
              </span>
            </div>
          ))}
          {v.hidden > 0 && (
            <button type="button" className="st-link imp-vf-more" onClick={() => setExpanded(true)}>
              还有 {v.hidden} 段 · 展开
            </button>
          )}
          {expanded && v.refCount > 4 && (
            <button type="button" className="st-link imp-vf-more" onClick={() => setExpanded(false)}>
              收起
            </button>
          )}
          {v.skipped.map((s) => (
            <div key={s} className="imp-vf-warn">
              {s}
            </div>
          ))}
        </div>

        <span className="imp-vf-k">挂到</span>
        <div className="imp-vf-v col" role="radiogroup" aria-label="挂到哪条连接">
          {rows.length === 0 && <span className="imp-b-faint">还没有语音服务</span>}
          {rows.map((r) => (
            <label key={r.id} className={`imp-vf-conn${picked === r.id ? ' on' : ''}${r.disabled ? ' off' : ''}`}>
              <input
                type="radio"
                name="imp-vf-conn"
                checked={picked === r.id}
                disabled={busy || r.disabled}
                onChange={() => onConnection(r.id)}
              />
              <b>{r.name}</b>
              {r.note && <span className={`imp-vf-note${r.good ? ' good' : ''}`}>{r.note}</span>}
            </label>
          ))}
        </div>

        <span className="imp-vf-k">会怎样</span>
        <div className="imp-vf-v">
          <span>{effect}</span>
        </div>
      </div>

      {error && (
        <div className="imp-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
