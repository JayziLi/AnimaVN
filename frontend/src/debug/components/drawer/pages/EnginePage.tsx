/**
 * 插件抽屉全局组「表情认法」(第 2 步 D4):旧算法 / 认词记录(core/engine.ts,vn/useTimelineEngine.ts 那一份)、
 * 认词记录一共几条,和本地小模型(对不上名字的词先交给它猜)的状态。
 * 游戏设置「数据」页里的那一行是同一份设置,两边改哪边另一边都跟着变。
 */

import { useEffect, useState } from 'react';
import type { TimelineEngine } from '../../../core/engine';
import { debugApi, type EmotionStatus, type RecordsSummary } from '../../../lib/api';
import { describeRecords } from '../../../vn/dataTab';
import { setTimelineEngine, useTimelineEngine } from '../../../vn/useTimelineEngine';
import { errText } from '../../pluginRunner';
import { SettingRow } from '../../settings/SettingRow';
import { PageHead, Section } from '../frame';

const ENGINE_OPTIONS = [
  { value: 'records', label: '认词记录' },
  { value: 'legacy', label: '旧算法' },
] as const;

const ENGINE_TEXT: Record<TimelineEngine, string> = { records: '认词记录', legacy: '旧算法' };

/** 本地小模型装没装:一行状态;没装时「怎么装」点开才看命令 */
function ModelStatus() {
  const [status, setStatus] = useState<EmotionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [how, setHow] = useState(false);
  useEffect(() => {
    let alive = true;
    debugApi
      .emotionStatus()
      .then((s) => alive && setStatus(s))
      .catch((e: unknown) => alive && setError(errText(e)));
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <div className="dw-line dw-bad">查不到模型状态:{error}</div>;
  if (!status) return <div className="dw-line">检查中…</div>;
  if (status.ready) return <div className="dw-line">已装好 · {status.model}</div>;
  return (
    <div className="dw-line">
      <span className="dw-bad">没装,对不上名字的词不会自动认</span>{' '}
      <button type="button" className="dw-inline-link" aria-expanded={how} onClick={() => setHow(!how)}>
        {how ? '收起' : '怎么装'}
      </button>
      {how && (
        <div className="dw-how">
          {status.detail && <div>{status.detail}</div>}
          <div>
            在 AnimaBackend 里运行 <code className="pl-code">python scripts/download_emotion_model.py</code>,装好以后重启后端。
          </div>
        </div>
      )}
    </div>
  );
}

export function EnginePage() {
  const engine = useTimelineEngine();
  const [summary, setSummary] = useState<RecordsSummary | 'error' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    debugApi
      .emotionRecordsSummary()
      .then((s) => live && setSummary(s))
      .catch(() => live && setSummary('error'));
    return () => {
      live = false;
    };
  }, []);
  const pick = (next: string) => {
    setSaving(true);
    setError(null);
    setTimelineEngine(next as TimelineEngine)
      .catch((e: unknown) => setError(`没存上:${errText(e)}`))
      .finally(() => setSaving(false));
  };
  return (
    <>
      <PageHead title="表情认法" tip="engine" inUse={engine ? { on: true, text: ENGINE_TEXT[engine] } : null} tags={[]} />
      <Section title="常用">
        <SettingRow
          label="表情认法"
          control={{ kind: 'segmented', options: ENGINE_OPTIONS }}
          value={engine ?? 'legacy'}
          disabled={saving || engine === null}
          onChange={pick}
        />
        <div className={`dw-line${error ? ' dw-bad' : ''}`}>{error ?? describeRecords(summary)}</div>
      </Section>
      <Section title="本地小模型" tip="adv_model">
        <ModelStatus />
      </Section>
    </>
  );
}
