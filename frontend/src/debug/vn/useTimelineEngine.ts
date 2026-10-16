/**
 * 「表情认法」开关(core/engine.ts)在页面里的那一份:第一次用到时从后端读,改了以后用到它的地方一起换
 */
import { useSyncExternalStore } from 'react';
import { normalizeTimelineConfig, TIMELINE_SETTING_KEY, type TimelineEngine } from '../core/engine';
import { debugApi } from '../lib/api';

let engine: TimelineEngine | null = null;
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load() {
  if (engine !== null || loading) return;
  loading = true;
  debugApi
    .getSetting<unknown>(TIMELINE_SETTING_KEY)
    .then((v) => {
      engine = normalizeTimelineConfig(v).engine;
    })
    .catch(() => {
      // 读不到(后端没开):先按旧算法
      engine = 'legacy';
    })
    .finally(() => {
      loading = false;
      emit();
    });
}

function subscribe(l: () => void) {
  listeners.add(l);
  load();
  return () => {
    listeners.delete(l);
  };
}

const snapshot = () => engine;

/** 现在的表情认法;还没读到是 null(这时谁都先别问模型) */
export function useTimelineEngine(): TimelineEngine | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export async function setTimelineEngine(next: TimelineEngine): Promise<void> {
  await debugApi.putSetting(TIMELINE_SETTING_KEY, { engine: next });
  engine = next;
  emit();
}
