import { useState } from 'react';
import { debugApi, type ExportBundleSummary } from '../../lib/api';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 导出框里声音的「拉回来」:点了拉,拉完重读 summary;返回正在拉的声音、拉完还缺几个、出错(哪个声音 + 原文) */
export function usePullVoice(cardId: string, onSummary: (s: ExportBundleSummary) => void) {
  const [pulling, setPulling] = useState<string | null>(null);
  const [left, setLeft] = useState<Record<string, number>>({});
  const [pullError, setPullError] = useState<{ id: string; text: string } | null>(null);

  const pull = async (voiceId: string) => {
    if (pulling) return;
    setPulling(voiceId);
    setPullError(null);
    try {
      const r = await debugApi.pullVoiceFiles(voiceId);
      setLeft((l) => ({ ...l, [voiceId]: r.missing }));
      onSummary(await debugApi.exportBundleSummary(cardId));
    } catch (e) {
      setPullError({ id: voiceId, text: errText(e) });
    } finally {
      setPulling(null);
    }
  };
  return { pulling, left, pullError, pull };
}
