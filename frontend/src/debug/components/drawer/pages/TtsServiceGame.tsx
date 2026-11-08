/**
 * 语音服务页的游戏皮(10-26 画布 voice-service):照局内「模型」页(ConnectionsGame)的结构和样式。
 *   左 已保存的连接(点一行 = 打开来改,没有「当前启用」)+ 没配声音的卡用哪个声音
 *   中 表单(名称 / 类型 / 地址 / 步数或情绪强度 / 配对码)+ 这条连接上的声音
 *   右 测试(连接 · 试听)
 * 状态在这里,拼文案、判断改没改都在 ttsServiceModel.ts。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { debugApi, type DebugConnection, type TtsApiType } from '../../../lib/api';
import { groupVoices } from '../../../plugins/voice';
import type { VoicePluginState } from '../../../plugins/useVoicePlugin';
import { audioBus } from '../../../vn/audioBus';
import { voicePlayer } from '../../../vn/voice';
import { Help } from '../../../vn/ui/Help';
import { PaperButton } from '../../../vn/ui/PaperButton';
import { useConfirm } from '../../../vn/ui/confirm';
import { connIcon, elapsed } from '../../connections/connModel';
import { errText, type Notify, type Runner } from '../../pluginRunner';
import { PageFooter, PageShell, Section } from '../frame';
import type { TtsTest } from '../globalStatus';
import {
  DEFAULT_TEST_TEXT,
  FISH_MODELS,
  OPENAI_VOICES,
  PAIR_CODE_TIP,
  TEST_IDLE,
  TYPE_LABEL,
  TYPE_ORDER,
  TYPE_SUB,
  createBody,
  deleteBlockedWhy,
  diffVoiceRows,
  formError,
  formFrom,
  hasPlugin,
  isDirty,
  keyPlaceholder,
  modelCountText,
  newForm,
  clearSecrets,
  pairCodePlaceholder,
  rowsDirty,
  rowsError,
  rowsFrom,
  routeText,
  sortModels,
  updateBody,
  voicesOn,
  withType,
  type TtsForm,
  type VoiceRow,
} from './ttsServiceModel';
import '../../connections/connectionsGame.css';
import './ttsService.css';

const langName = (lang: string | null | undefined) => {
  const l = (lang ?? '').toLowerCase();
  if (l.includes('ja')) return '日语';
  if (l.includes('yue')) return '粤语';
  if (l.includes('zh')) return '中文';
  if (l.includes('en')) return '英语';
  if (l.includes('ko')) return '韩语';
  return lang ?? '';
};

function Field({ label, tip, span, children }: { label: string; tip?: string; span?: boolean; children: ReactNode }) {
  return (
    <label className={`vn-cn-field${span ? ' span' : ''}`}>
      <span className="vn-cn-fl">
        {label}
        {tip && <Help tip={tip} />}
      </span>
      {children}
    </label>
  );
}

type Spoke = { kind: 'busy' } | { kind: 'ok'; ms: number } | { kind: 'error'; text: string };

export function TtsServiceGame({
  head,
  voice,
  tests,
  onTest,
  onLibrary,
  notify,
  busy,
  run,
}: {
  head: ReactNode;
  voice: VoicePluginState;
  tests: Readonly<Record<string, TtsTest | undefined>>;
  onTest: (id: string) => void;
  onLibrary?: () => void;
  notify: Notify;
  busy: string | null;
  run: Runner;
}) {
  const confirm = useConfirm();
  const { connections, profiles, config, changeConfig } = voice;

  // 选中哪条:picked 没了(删了)就落到第一条;creating = 正在新建(还没存)
  const [picked, setPicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = creating ? null : (connections.find((c) => c.id === picked) ?? connections[0] ?? null);
  const isNew = creating || selected === null;

  const [form, setForm] = useState<TtsForm>(() => formFrom(selected));
  const onThis = voicesOn(profiles, selected?.id ?? null);
  // 中转站的音色行:存着的声音一行一个;改完点保存才增删改
  const savedRows = useMemo(() => (isNew ? [] : rowsFrom(onThis)), [isNew, onThis]);
  const [rows, setRows] = useState<VoiceRow[]>(savedRows);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [bringOpen, setBringOpen] = useState(false);
  const [llm, setLlm] = useState<DebugConnection[] | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  // 存过的内容变了(保存、换了一条)才重置表单;profile_count 这类不进表单的变化不动它
  const savedKey = JSON.stringify([isNew, selected?.id, formFrom(selected)]);
  const rowsKey = JSON.stringify(savedRows);
  useEffect(() => {
    setForm(formFrom(selected));
    setDeleteArmed(false);
    setView('ping');
    setSpoke(null);
    setModels(null);
    setBringOpen(false);
    setNameTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  useEffect(() => {
    setRows(savedRows);
    setFocusRow(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey, savedKey]);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const isRelay = form.api_type === 'openai';
  const dirty =
    (isDirty(form, selected) && !(isNew && connections.length === 0 && JSON.stringify(form) === JSON.stringify(newForm()))) ||
    (isRelay && rowsDirty(savedRows, rows));
  const used = selected?.profile_count ?? 0;
  const patch = (p: Partial<TtsForm>) => setForm((f) => ({ ...f, ...p }));
  const isGsv = form.api_type === 'gpt_sovits';
  const isFish = form.api_type === 'fish';
  const plugin = hasPlugin(form.api_type);
  const setRow = (i: number, p: Partial<VoiceRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const bringOptions = async () => {
    setBringOpen((v) => !v);
    if (llm === null) {
      try {
        setLlm(await debugApi.listConnections());
      } catch (e) {
        notify('error', errText(e));
        setLlm([]);
      }
    }
  };
  const bring = (c: DebugConnection) => {
    setBringOpen(false);
    patch({
      copy_from_llm: c.id,
      base_url: form.base_url.trim() ? form.base_url : (c.base_url ?? ''),
      ...(nameTouched || selected ? {} : { name: c.name }),
    });
  };
  const refreshModels = async () => {
    setModelsBusy(true);
    try {
      setModels(
        await debugApi.previewTtsModels({
          base_url: form.base_url.trim(),
          api_key: form.api_key.trim(),
          copy_from_llm: form.copy_from_llm || undefined,
          connection_id: selected?.id,
        }),
      );
    } catch (e) {
      setModels(null);
      notify('error', errText(e));
    } finally {
      setModelsBusy(false);
    }
  };
  const clearPair = async () => {
    if (!selected) return;
    await run('清除中', async () => {
      await debugApi.updateTtsConnection(selected.id, { pair_code: '' });
    });
  };

  const confirmDiscard = async () =>
    !dirty ||
    (await confirm({
      title: '放弃这些改动?',
      body: '连接的改动还没保存',
      en: 'Unsaved',
      del: '放弃改动',
      keep: '继续改',
      message: '连接的改动还没保存,放弃这些改动?',
    }));

  const select = async (id: string) => {
    if (!creating && id === selected?.id) return;
    if (!(await confirmDiscard())) return;
    setCreating(false);
    setPicked(id);
  };
  const startNew = async () => {
    if (!(await confirmDiscard())) return;
    setCreating(true);
    setForm(newForm());
  };

  const save = async () => {
    const bad = formError(form) ?? (isRelay ? rowsError(rows) : null);
    if (bad) {
      notify('error', bad);
      return;
    }
    const body = selected && !isNew ? updateBody(form, selected) : null;
    const diff = isRelay ? diffVoiceRows(savedRows, rows) : { create: [], update: [], remove: [] };
    const voiceOps = diff.create.length + diff.update.length + diff.remove.length > 0;
    if (body && Object.keys(body).length === 0 && !voiceOps) return;
    let madeId: string | null = null;
    const ok = await run('保存中', async () => {
      let id = selected?.id ?? null;
      if (isNew) {
        id = (await debugApi.createTtsConnection(createBody(form))).id;
        madeId = id;
      } else if (selected && body && Object.keys(body).length > 0) {
        await debugApi.updateTtsConnection(selected.id, body);
      }
      if (!id) return;
      // 音色就是声音:声音名 = 音色名
      for (const vid of diff.remove) await debugApi.deleteVoice(vid);
      for (const r of diff.update) {
        const name = r.name.trim();
        await debugApi.updateVoice(r.id as string, { name, text_lang: r.lang, params: { ...r.params, voice: name } });
      }
      for (const r of diff.create) {
        const name = r.name.trim();
        await debugApi.createVoice({ name, connection_id: id, text_lang: r.lang, params: { voice: name } });
      }
    });
    if (ok && madeId) {
      setCreating(false);
      setPicked(madeId);
    }
    // 配对码、key 存进去以后不回传,保存前后 savedKey 一样、表单不会自己重置,得在这里清掉
    if (ok) setForm(clearSecrets);
  };

  const remove = async () => {
    if (!selected) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    const ok = await run('删除中', () => debugApi.deleteTtsConnection(selected.id));
    if (ok) setPicked(null);
    setDeleteArmed(false);
  };

  // ---- 右:测试 ----
  const [text, setText] = useState(DEFAULT_TEST_TEXT);
  const [voiceId, setVoiceId] = useState('');
  const testVoice = onThis.find((v) => v.id === voiceId) ?? onThis[0] ?? null;
  const [view, setView] = useState<'ping' | 'speak'>('ping');
  const [spoke, setSpoke] = useState<Spoke | null>(null);
  const seq = useRef(0);
  useEffect(() => () => voicePlayer.stop(), []);

  const ping = () => {
    if (!selected) return;
    setView('ping');
    onTest(selected.id);
  };
  const listen = async () => {
    if (!testVoice || !text.trim()) return;
    const mine = ++seq.current;
    audioBus.unlock();
    setView('speak');
    setSpoke({ kind: 'busy' });
    try {
      const r = await debugApi.speak({ profile_id: testVoice.id, emotion: null, text: text.trim() }, true);
      if (mine !== seq.current) return;
      setSpoke({ kind: 'ok', ms: r.ms });
      await voicePlayer.playBuffer(r.audio);
    } catch (e) {
      if (mine === seq.current) setSpoke({ kind: 'error', text: errText(e) });
    }
  };

  const pinged = selected ? tests[selected.id] : undefined;
  const result = (() => {
    if (view === 'speak' && spoke) {
      if (spoke.kind === 'busy')
        return (
          <div className="vn-cn-res busy" role="status">
            <i className="vn-cn-spin" aria-hidden="true" />
            <span>合成中…</span>
          </div>
        );
      if (spoke.kind === 'error')
        return (
          <div className="vn-cn-res bad" role="alert">
            <b>念不了</b>
            <p className="vn-cn-raw">{spoke.text}</p>
          </div>
        );
      return (
        <div className="vn-cn-res ok" role="status">
          <b>✓ 念好了</b>
          <span className="vn-cn-dim">用时 {elapsed(spoke.ms)}</span>
        </div>
      );
    }
    if (pinged === 'pending')
      return (
        <div className="vn-cn-res busy" role="status">
          <i className="vn-cn-spin" aria-hidden="true" />
          <span>连接中…</span>
        </div>
      );
    if (pinged && pinged.ok) {
      const route = routeText(pinged, !!selected && hasPlugin(selected.api_type));
      const count = selected?.api_type === 'openai' ? modelCountText(pinged.model_count) : null;
      return (
        <div className="vn-cn-res ok" role="status">
          <b>✓ 通了</b>
          <span className="vn-cn-dim">用时 {elapsed(pinged.ms)}</span>
          {count && <p className="vn-cn-raw">{count}</p>}
          {route && <p className="vn-cn-raw">{route}</p>}
        </div>
      );
    }
    if (pinged)
      return (
        <div className="vn-cn-res bad" role="alert">
          <b>没连上</b>
          <p className="vn-cn-raw">{pinged.error}</p>
        </div>
      );
    return (
      <div className="vn-cn-res idle">
        <span className="vn-cn-dim">{TEST_IDLE}</span>
      </div>
    );
  })();

  // ---- 左下:没配声音的卡 ----
  const groups = groupVoices(profiles, connections);
  const defaultMissing = !!config.defaultVoiceId && !profiles.some((v) => v.id === config.defaultVoiceId);

  const idle = busy === null;

  const preview = (
    <div className="vn-ts">
      <aside className="vn-cn-list" aria-label="已保存的连接">
        <div className="vn-cn-lh">
          <span className="vn-cn-zh">已保存的连接</span>
          <span className="vn-cn-n">{connections.length} 个</span>
        </div>
        <div className="vn-cn-rows" role="radiogroup" aria-label="已保存的连接">
          {connections.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={!isNew && c.id === selected?.id}
              className={`vn-cn-row${!isNew && c.id === selected?.id ? ' on' : ''}`}
              disabled={!idle}
              onClick={() => void select(c.id)}
            >
              <span className="vn-cn-ic" aria-hidden="true">
                {connIcon(c.name)}
              </span>
              <span className="tx">
                <b>{c.name}</b>
                <small>
                  {TYPE_LABEL[c.api_type]}
                  {c.base_url ? ` · ${c.base_url.replace(/^https?:\/\//, '')}` : ''}
                </small>
              </span>
              <span className="vn-ts-n">{c.profile_count} 个声音</span>
            </button>
          ))}
          {isNew && (
            <div className="vn-cn-row on draft" role="radio" aria-checked="true">
              <span className="vn-cn-ic" aria-hidden="true">
                +
              </span>
              <span className="tx">
                <b>{form.name.trim() || '新连接'}</b>
                <small>还没保存</small>
              </span>
            </div>
          )}
        </div>
        {!isNew && (
          <button type="button" className="vn-cn-new" onClick={() => void startNew()} disabled={!idle}>
            新建连接…
          </button>
        )}
        <div className="vn-cn-foot">
          <label className="vn-cn-field">
            <span className="vn-cn-fl">
              没配声音的卡
              <Help tip="卡自己没选音色时,用这个声音念。卡自己选了的不受影响。" />
            </span>
            <select
              className="select"
              aria-label="没配声音的卡用哪个声音"
              value={config.defaultVoiceId ?? ''}
              onChange={(e) => changeConfig({ ...config, defaultVoiceId: e.target.value || null })}
            >
              <option value="">不念</option>
              {defaultMissing && <option value={config.defaultVoiceId ?? ''}>(找不到这个声音)</option>}
              {groups.map((g) =>
                groups.length > 1 ? (
                  <optgroup key={g.id || 'lost'} label={g.name}>
                    {g.voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  g.voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))
                ),
              )}
            </select>
          </label>
        </div>
      </aside>

      <section className="vn-cn-form" aria-label="连接设置">
        <div className="vn-cn-ph">
          <h3 className="vn-cn-h1">{isNew ? '新建连接' : selected?.name || form.name}</h3>
          {dirty && <span className="vn-cn-dim">有没保存的改动</span>}
          <span className="vn-cn-flex" />
          {!isNew && (
            <PaperButton sm onClick={() => void startNew()} disabled={!idle}>
              新建
            </PaperButton>
          )}
          <PaperButton kind="primary" sm onClick={() => void save()} disabled={!idle}>
            {busy === '保存中' ? '保存中…' : '保存'}
          </PaperButton>
          {!isNew && (
            <span title={deleteBlockedWhy(used)}>
              <PaperButton kind="danger" sm armed={deleteArmed} onClick={() => void remove()} disabled={!idle || used > 0}>
                {busy === '删除中' ? '删除中…' : deleteArmed ? '确认删除?' : '删除'}
              </PaperButton>
            </span>
          )}
        </div>

        <div className="vn-cn-grid">
          <Field label="名称">
            <input
              className="text-input"
              value={form.name}
              onChange={(e) => {
                setNameTouched(true);
                patch({ name: e.target.value });
              }}
              placeholder="例:5090 台式机"
            />
          </Field>
          <Field label="类型" tip={used > 0 ? '有声音在用这条连接,不能换类型' : undefined}>
            <select
              className="select"
              value={form.api_type}
              disabled={used > 0}
              onChange={(e) => setForm((f) => withType(f, e.target.value as TtsApiType))}
            >
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                  {TYPE_SUB[t] ? `(${TYPE_SUB[t]})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={isRelay ? 'Base URL' : '地址'} span>
            <input
              className="text-input mono"
              value={form.base_url}
              onChange={(e) => patch({ base_url: e.target.value })}
              placeholder={isFish ? '留空 = 官方 https://api.fish.audio' : isRelay ? 'https://你的中转站/v1' : undefined}
              spellCheck={false}
            />
          </Field>
          {isRelay && (
            <div className="span vn-ts-bring">
              <button type="button" className="vn-cn-link" onClick={() => void bringOptions()} aria-label="从模型页带入">
                从模型页带入
              </button>
              {bringOpen && (
                <div className="vn-ts-bring-menu" role="menu">
                  {llm === null && <span className="vn-cn-dim">读取中…</span>}
                  {llm?.length === 0 && <span className="vn-cn-dim">模型页里还没有连接</span>}
                  {llm?.map((c) => (
                    <button key={c.id} type="button" role="menuitem" onClick={() => bring(c)}>
                      {c.name}
                      <small>{(c.base_url ?? '').replace(/^https?:\/\//, '')}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {isGsv && (
            <Field label="采样步数">
              <input className="text-input" inputMode="numeric" value={form.sample_steps} onChange={(e) => patch({ sample_steps: e.target.value })} />
            </Field>
          )}
          {form.api_type === 'indextts' && (
            <Field label="情绪强度">
              <input className="text-input" inputMode="decimal" value={form.emo_alpha} onChange={(e) => patch({ emo_alpha: e.target.value })} />
            </Field>
          )}
          {plugin && (
            <Field label="配对码" tip={PAIR_CODE_TIP}>
              <span className="vn-ts-pair">
                <input
                  className="text-input mono"
                  value={form.pair_code}
                  onChange={(e) => patch({ pair_code: e.target.value })}
                  placeholder={pairCodePlaceholder(!!selected?.has_pair_code)}
                  autoComplete="off"
                  spellCheck={false}
                />
                {selected?.has_pair_code && !isNew && (
                  <PaperButton sm onClick={() => void clearPair()} disabled={!idle}>
                    清除
                  </PaperButton>
                )}
              </span>
            </Field>
          )}
          {(isFish || isRelay) && (
            <Field
              label="API Key"
              span
              tip={form.copy_from_llm ? '已选「从模型页带入」:保存时后端把那条的 key 抄过来;在这里另填一个就用新的。' : undefined}
            >
              <input
                className="text-input mono"
                type="password"
                value={form.api_key}
                onChange={(e) => patch({ api_key: e.target.value })}
                placeholder={form.copy_from_llm ? '用模型页那条连接的 key' : keyPlaceholder(!!selected?.has_api_key)}
                autoComplete="new-password"
                spellCheck={false}
              />
            </Field>
          )}
          {isFish && (
            <Field label="模型">
              <select className="select mono" value={form.model} onChange={(e) => patch({ model: e.target.value })}>
                {[...new Set([...FISH_MODELS, form.model])].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {isRelay && (
            <>
              <Field label="模型名" span>
                <span className="vn-cn-inrow">
                  <input
                    className="text-input mono"
                    value={form.model}
                    onChange={(e) => patch({ model: e.target.value })}
                    placeholder="例:tts-1 / gpt-4o-mini-tts"
                    spellCheck={false}
                  />
                  <PaperButton sm onClick={() => void refreshModels()} disabled={modelsBusy || !idle}>
                    {modelsBusy ? '刷新中…' : '刷新列表'}
                  </PaperButton>
                </span>
              </Field>
              {models && models.length > 0 && (
                <Field label={`可用模型 · ${models.length} 个`} tip="从这家站拉到的模型,语音模型排在前面。选中就填进模型名。" span>
                  <select className="select mono" value="" onChange={(e) => e.target.value && patch({ model: e.target.value })}>
                    <option value="">从列表选择…</option>
                    {(() => {
                      const { speech, other } = sortModels(models);
                      return (
                        <>
                          {speech.length > 0 && (
                            <optgroup label="语音模型">
                              {speech.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {other.length > 0 && (
                            <optgroup label="其他模型">
                              {other.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </>
                      );
                    })()}
                  </select>
                </Field>
              )}
              <div className="span">
                <div className="vn-cn-fl">
                  音色 · {rows.filter((r) => r.id || r.name.trim()).length} 个
                  <Help tip="这条连接上的声音,一行一个:音色名和念中文还是日语。声音名就是音色名,局内点哪个用哪个。" />
                </div>
                <div className="vn-ts-vrows">
                  {rows.map((r, i) => (
                    <div className="vn-ts-vrow" key={r.id ?? `new${i}`}>
                      <input
                        className="text-input"
                        value={r.name}
                        onChange={(e) => setRow(i, { name: e.target.value })}
                        onFocus={() => setFocusRow(i)}
                        placeholder="音色名"
                        aria-label="音色名"
                        spellCheck={false}
                      />
                      <span className="vn-ts-seg" role="group" aria-label="念哪种文字">
                        <button type="button" aria-pressed={r.lang === 'zh'} onClick={() => setRow(i, { lang: 'zh' })}>
                          中文
                        </button>
                        <button type="button" aria-pressed={r.lang === 'ja'} onClick={() => setRow(i, { lang: 'ja' })}>
                          日语
                        </button>
                      </span>
                      <button
                        type="button"
                        className="vn-ts-x"
                        aria-label="删掉这个音色"
                        title="删掉这个音色"
                        onClick={() => {
                          setRows((rs) => rs.filter((_, j) => j !== i));
                          setFocusRow(null);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {focusRow !== null && rows[focusRow] && (
                    <div className="vn-ts-chips">
                      {OPENAI_VOICES.map((v) => (
                        <button key={v} type="button" onClick={() => setRow(focusRow, { name: v })}>
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                  <div>
                    <PaperButton
                      sm
                      onClick={() => {
                        setRows((rs) => [...rs, { id: null, name: '', lang: 'zh' }]);
                        setFocusRow(rows.length);
                      }}
                    >
                      + 加音色
                    </PaperButton>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {!isNew && !isRelay && (
          <div className="vn-ts-voices">
            <div className="vn-cn-lh">
              <span className="vn-cn-zh">声音 · {onThis.length} 个</span>
              <span className="vn-cn-flex" />
              {onLibrary && (
                <button type="button" className="vn-cn-link" onClick={onLibrary}>
                  在素材管理里加
                </button>
              )}
            </div>
            {onThis.length === 0 ? (
              <p className="vn-cn-dim">这条连接上还没有声音。</p>
            ) : (
              <ul className="vn-ts-vlist">
                {onThis.map((v) => (
                  <li key={v.id}>
                    <span>{v.name}</span>
                    {langName(v.text_lang) && <span className="vn-cn-chip">{langName(v.text_lang)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );

  const common = (
    <Section title="测试" en="Test">
      <div className="vn-ts-test">
        <label className="vn-cn-field">
          <span className="vn-cn-fl">试听句子</span>
          <textarea className="conn-textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="vn-cn-field">
          <span className="vn-cn-fl">用哪个声音</span>
          <select
            className="select"
            value={testVoice?.id ?? ''}
            disabled={isNew || onThis.length === 0}
            onChange={(e) => setVoiceId(e.target.value)}
          >
            {onThis.length === 0 && <option value="">这条连接上还没有声音</option>}
            {onThis.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <div className="vn-cn-inrow">
          <PaperButton sm onClick={ping} disabled={isNew || pinged === 'pending'}>
            {pinged === 'pending' ? '连接中…' : '连接'}
          </PaperButton>
          <PaperButton sm onClick={() => void listen()} disabled={isNew || !testVoice || !text.trim() || spoke?.kind === 'busy'}>
            {spoke?.kind === 'busy' ? '合成中…' : '试听'}
          </PaperButton>
        </div>
        {isNew && <p className="vn-cn-dim">先保存这条连接,再测试。</p>}
        {result}
      </div>
    </Section>
  );

  return (
    <PageShell
      head={head}
      preview={preview}
      common={common}
      footer={onLibrary ? <PageFooter links={[{ text: '素材管理 · 声音', onClick: onLibrary }]} /> : null}
    />
  );
}
