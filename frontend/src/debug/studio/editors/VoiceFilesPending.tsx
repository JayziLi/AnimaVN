/**
 * 声音编辑器顶上那一块(第 4 步):导进来的声音、语音服务在另一台电脑、文件还没放过去(files_at = pending)。
 *
 *   ⚠ 语音服务在另一台电脑:要把这些文件放过去                         [导出这些文件]
 *     导出的 zip 解压到语音机上,把解压到的目录填在下面,点「已放好」
 *     语音机上的目录 (?) [D:/AnimaVoice/imports/刻晴 2              ] [已放好]
 *     参考音频会改成 …/refs/原文件名,模型改成 …/models/原文件名
 *
 * 点「已放好」:后端把每个文件的路径改成那边的,回改好的声音(files_at 变 manual),这一块就收起来。
 */

import { useState } from 'react';
import { debugApi, type VoiceProfile } from '../../lib/api';
import { Icon } from '../icons';
import { TERMS } from '../terms';
import { Btn, FieldLabel } from '../ui';
import type { Notify } from '../types';
import { filesZipName, folderPlaceholder, placedFolder, placedHint } from './voiceEditorModel';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Props {
  profile: VoiceProfile;
  /** 后端回了改好的声音 */
  onPlaced: (next: VoiceProfile) => void;
  notify: Notify;
}

export function VoiceFilesPending({ profile, onPlaced, notify }: Props) {
  const [folder, setFolder] = useState('');
  const [zipping, setZipping] = useState(false);
  const [placing, setPlacing] = useState(false);
  const target = placedFolder(folder);

  const exportFiles = async () => {
    if (zipping) return;
    setZipping(true);
    try {
      const saved = await debugApi.voiceFilesZip(profile.id, filesZipName(profile.name));
      notify('ok', `已存成 ${saved.name}`);
    } catch (e) {
      notify('error', `导出失败:${errText(e)}`);
    } finally {
      setZipping(false);
    }
  };

  const place = async () => {
    if (!target || placing) return;
    setPlacing(true);
    try {
      const next = await debugApi.placeVoiceFiles(profile.id, target);
      onPlaced(next);
      notify('ok', '路径已改成语音机上的,可以试听了');
    } catch (e) {
      notify('error', `没改成:${errText(e)}`);
      setPlacing(false);
    }
  };

  return (
    <section className="vo-panel vo-pending" aria-label="文件要放到语音机上">
      <div className="vo-pending-head">
        <Icon name="alert" size={15} />
        <span className="vo-title">语音服务在另一台电脑:要把这些文件放过去</span>
        <span className="st-flex" />
        <Btn small icon="export" disabled={zipping} onClick={() => void exportFiles()}>
          {zipping ? '导出中…' : '导出这些文件'}
        </Btn>
      </div>
      <p className="vo-pending-note">导出的 zip 解压到语音机上,把解压到的目录填在下面,点「已放好」</p>
      <div className="vo-pending-field">
        <FieldLabel text="语音机上的目录" help={TERMS.voiceFolder} />
        <div className="vo-pending-row">
          <input
            className="st-input vo-path"
            value={folder}
            placeholder={folderPlaceholder(profile.name)}
            spellCheck={false}
            aria-label="语音机上的目录"
            disabled={placing}
            onChange={(e) => setFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void place();
            }}
          />
          <Btn small kind="primary" disabled={!target || placing} onClick={() => void place()}>
            {placing ? '改路径中…' : '已放好'}
          </Btn>
        </div>
        <span className="vo-pending-hint">{placedHint(folder)}</span>
      </div>
    </section>
  );
}
