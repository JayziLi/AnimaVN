/**
 * 「高级 · 问法」页签(第 2 步 D7,画布 V6SpriteAsk):一道题的问法 —— 标题 + 问号 + 恢复默认、输入框、
 * 点一下插到光标处的宏小块,下面「Jev 实际收到的」:拿这张卡最近一句代入,经后端 /api/annotate/preview 拼好
 * (和真发时同一个函数),输入停 0.6 秒再拼。只拼题、不问 Jev、不记用量。
 */

import { useEffect, useRef, useState } from 'react';
import { debugApi, type JevDefaults } from '../../../lib/api';
import type { AnnotateRequest } from '../../../plugins/jevRun';
import { errText } from '../../pluginRunner';
import { MACRO_HINT, NEEDS_N, PROMPT_MACROS, insertMacro, promptValue } from '../askModel';
import type { TipKey } from '../tips';
import { TabTitle } from './shared';

const PROMPT_MAX = 500;
const PREVIEW_DELAY_MS = 600;

export function AskTab({
  title,
  tip,
  promptKey,
  value,
  defaults,
  onChange,
  build,
  question,
  sampleNote,
  anchor,
}: {
  title: string;
  tip?: TipKey;
  /** 后端 DEFAULT_PROMPTS 的键 */
  promptKey: string;
  /** 改过的;null = 用默认 */
  value: string | null;
  defaults: JevDefaults | null;
  onChange: (next: string | null) => void;
  /** 拿这一版问法拼一个预览请求(改过的问法里换上正在改的这一段);拼不了(没素材)是 null */
  build: (prompts: Record<string, string>) => AnnotateRequest | null;
  /** 回来的题里看哪一道(e1、bg1……) */
  question: string;
  /** 「拿刻晴最近一句代入」那个小块 */
  sampleNote: string;
  /** 点预设里的插件块时滚到这里 */
  anchor?: string;
}) {
  const def = defaults?.prompts[promptKey] ?? null;
  // 正在改的时候显示自己的草稿:清空、或者恰好改成和默认一样时 value 会变回 null,不能让默认问法立刻跳回来
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? def ?? '';
  const area = useRef<HTMLTextAreaElement>(null);
  const missingN = NEEDS_N.has(promptKey) && !shown.includes('{{n}}');
  const macros = PROMPT_MACROS[promptKey] ?? ['char', 'user'];

  const commit = (next: string) => {
    setDraft(next);
    onChange(promptValue(next, def));
  };

  const insert = (m: (typeof macros)[number]) => {
    const el = area.current;
    const r = insertMacro(shown, el?.selectionStart ?? shown.length, el?.selectionEnd ?? shown.length, m);
    commit(r.text);
    // 插完把光标放回宏后面
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  };

  // ---- Jev 实际收到的:停手 0.6 秒再拼 ----
  const [preview, setPreview] = useState<{ text: string | null; error: string | null } | null>(null);
  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  });
  const sent = shown.trim() ? shown : (def ?? '');
  const buildable = build({}) !== null;
  useEffect(() => {
    const req = buildRef.current({ [promptKey]: sent });
    if (!req) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      debugApi
        .annotatePreview(req, ctrl.signal)
        .then((r) => setPreview({ text: r.prompts[question] ?? null, error: null }))
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) setPreview({ text: null, error: errText(e) });
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [sent, promptKey, question, sampleNote]);

  return (
    <div id={anchor} className="dw-tab-stack">
      <TabTitle
        title={title}
        tip={tip}
        right={
          <button
            type="button"
            className="btn small"
            disabled={value === null}
            onClick={() => {
              setDraft(null);
              onChange(null);
            }}
          >
            恢复默认
          </button>
        }
      />
      <textarea
        ref={area}
        className="text-input pl-wide pl-textarea dw-ask"
        rows={4}
        maxLength={PROMPT_MAX}
        value={shown}
        spellCheck={false}
        aria-label={title}
        placeholder={def === null ? '(后端还没更新,拿不到默认问法)' : undefined}
        onFocus={() => setDraft(value ?? def ?? '')}
        onBlur={() => setDraft(null)}
        onChange={(e) => commit(e.target.value)}
      />
      <div className="dw-macros">
        <span className="dw-muted">点一下插入:</span>
        {macros.map((m) => (
          <button
            key={m}
            type="button"
            className="dw-macro-chip"
            // 按下时别把焦点从输入框抢走:光标位置要留着
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(m)}
          >
            <code>{`{{${m}}}`}</code>
            <span>{MACRO_HINT[m]}</span>
          </button>
        ))}
      </div>
      {missingN && <span className="dw-bad">没写 {'{{n}}'}:Jev 不知道问的是哪一句</span>}
      <div className="dw-tab-title">
        <span className="dw-muted">Jev 实际收到的</span>
        <span className="dw-chip">{sampleNote}</span>
      </div>
      <pre className={`dw-received${preview?.error ? ' bad' : ''}`}>
        {!buildable
          ? '这张卡还没有能代入的素材(没绑或只有一个可选的),Jev 不问这道题'
          : preview === null
            ? '拼题中…'
            : (preview.error ?? preview.text ?? '这一句不问这道题')}
      </pre>
    </div>
  );
}
