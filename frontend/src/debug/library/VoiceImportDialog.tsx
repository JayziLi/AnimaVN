/**
 * 素材管理「声音」页的「导入 refs.json」小框:选语音服务、贴语音机上那份 refs.json、导入。
 * 清单没带声音编号、素材里又有同名的声音时后端不悄悄覆盖(回 409):这里改成问一句
 * 「合进去」(权重路径和同名情绪换成清单里的,新情绪加在最后)还是「另建一个」(叫「名字 2」),选了再发一次。
 * 清单写了语言(顶层 text_lang,或者每段参考都写着同一个 lang)就照它设这个声音念哪种语言,框里先写出来。
 * 读 JSON、认语言、起名字、认 409 在 voiceCreate.ts。
 */

import { useState } from 'react';
import { debugApi, type TtsConnection, type VoiceProfile } from '../lib/api';
import { connectionOption, langName } from '../studio/editors/voiceEditorModel';
import { TERMS } from '../studio/terms';
import { Btn, FieldLabel, Modal, SelectBox } from '../studio/ui';
import { copyVoiceName, importOnce, readRefs } from './voiceCreate';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface VoiceImportDialogProps {
  /** 全部语音服务;还在读是 null */
  connections: readonly TtsConnection[] | null;
  /** 素材里已有的声音名(「另建一个」会叫什么) */
  names: readonly string[];
  onDone: (profile: VoiceProfile) => void;
  onCancel: () => void;
}

export function VoiceImportDialog({ connections, names, onDone, onCancel }: VoiceImportDialogProps) {
  const [picked, setPicked] = useState('');
  const connId = connections?.some((c) => c.id === picked) ? picked : (connections?.[0]?.id ?? '');
  const isIndex = connections?.find((c) => c.id === connId)?.api_type === 'indextts';
  const [text, setText] = useState('');
  const read = readRefs(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 撞上同名的声音了:等用户选合进去还是另建一个 */
  const [conflict, setConflict] = useState(false);

  const send = async (onConflict?: 'update' | 'new') => {
    if (!read?.ok || !connId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importOnce((c) => debugApi.importVoice(connId, read.refs, c), onConflict);
      if (r.kind === 'conflict') setConflict(true);
      else onDone(r.profile);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const footer = conflict ? (
    <>
      <Btn onClick={onCancel}>取消</Btn>
      <Btn disabled={busy} onClick={() => void send('new')}>
        另建一个
      </Btn>
      <Btn kind="primary" disabled={busy} onClick={() => void send('update')}>
        合进去
      </Btn>
    </>
  ) : (
    <>
      <Btn onClick={onCancel}>取消</Btn>
      <Btn kind="primary" icon="upload" disabled={!read?.ok || !connId || busy} onClick={() => void send()}>
        {busy ? '导入中…' : '导入'}
      </Btn>
    </>
  );

  return (
    <Modal title="导入 refs.json" className="lib-refs" onCancel={onCancel} footer={footer}>
      <div className="lib-refs-field">
        <FieldLabel text="语音服务" help={TERMS.ttsService} />
        {connections === null ? (
          <div className="lib-refs-note">读取中…</div>
        ) : connections.length === 0 ? (
          <div className="lib-refs-note error">还没有语音服务 · 先在插件页的「语音服务」里添加一台</div>
        ) : (
          <SelectBox
            label="语音服务"
            value={connId}
            options={connections.map(connectionOption)}
            disabled={busy}
            onChange={(v) => {
              setPicked(v);
              setConflict(false);
            }}
          />
        )}
      </div>
      <div className="lib-refs-field">
        <FieldLabel text="refs.json 的内容" help={TERMS.refsJson} />
        <textarea
          className="st-textarea lib-refs-json"
          rows={8}
          spellCheck={false}
          autoFocus
          aria-label="refs.json 的内容"
          placeholder="把语音机上 refs\<角色>\refs.json 的全部内容贴进来"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setConflict(false);
            setError(null);
          }}
        />
        {read && (
          <div className={`lib-refs-note${read.ok ? '' : ' error'}`}>
            {read.ok
              ? `「${read.name}」· ${read.count} 段参考音频${read.lang ? ` · 念${langName(read.lang, isIndex)}` : ''}`
              : read.error}
          </div>
        )}
      </div>
      {conflict && read?.ok && (
        <div className="lib-refs-conflict" role="alert">
          <p className="st-dialog-p">已经有叫「{read.name}」的声音了。</p>
          <p className="st-dialog-p">
            合进去:权重路径{read.lang ? '、语言' : ''}和同名情绪换成清单里的,新的情绪加在最后。
          </p>
          <p className="st-dialog-p">另建一个:新建「{copyVoiceName(read.name, names)}」。</p>
        </div>
      )}
      {error && (
        <div className="lib-refs-note error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
