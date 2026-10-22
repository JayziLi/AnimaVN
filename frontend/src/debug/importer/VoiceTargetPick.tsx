/**
 * 导入确认里声音导到哪个语音服务:「→ [本机 GPT-SoVITS ▾]」。不止一个语音服务时是下拉,只有一个直接写名字;
 * 一个都没有时不画(那一行的灰字说「还没有语音服务」)。导完会怎样(导完就能念 / 要把文件放过去)由 voiceTarget 算,外面写。
 */

import { SelectBox } from '../studio/ui';
import type { VoiceTarget } from './importModel';

interface Props {
  target: VoiceTarget;
  disabled: boolean;
  onPick: (id: string) => void;
}

export function VoiceTargetPick({ target, disabled, onPick }: Props) {
  if (!target.id) return null;
  return (
    <span className="imp-voice-to">
      <span className="imp-voice-arrow" aria-hidden>
        →
      </span>
      {target.options ? (
        <span className="imp-voice-select">
          <SelectBox label="导到哪个语音服务" value={target.id} options={target.options} disabled={disabled} onChange={onPick} />
        </span>
      ) : (
        <span className="imp-voice-name">{target.name || '语音服务'}</span>
      )}
    </span>
  );
}
