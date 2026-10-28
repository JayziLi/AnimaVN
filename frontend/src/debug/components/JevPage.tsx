import { useCallback, useEffect, useState } from 'react';
import { debugApi, type JevUsage } from '../lib/api';
import type { TagMode } from '../plugins/common';
import {
  JEV_BEFORE_LINES,
  SHARED_PROMPT_KEYS,
  SPEAKER_THRESHOLD,
  jevHealth,
  jevKindStatus,
  tokenText,
  type JevKind,
  type SharedPromptKey,
} from '../plugins/jev';
import type { JevTrial } from '../plugins/jevRun';
import { Advanced, PageHead, PageShell, Panel, Section } from './drawer/frame';
import { NavIcon } from './drawer/navIcons';
import { useDrawerSkin } from './drawer/skinContext';
import { Icon } from '../studio/icons';
import { Tip } from './drawer/Tip';
import { TIPS } from './drawer/tips';
import { JEV_HEALTH_TEXT as HEALTH_TEXT } from './drawer/globalStatus';
import { PromptField, TrialTable, type JevControls } from './JevSettings';
import { DeleteButton } from './pluginFields';
import { SettingGroup, SettingRow } from './settings/SettingRow';

/**
 * 插件抽屉里单独的「Jev 标注」页(specs/2026-10-16-jev-page-and-previous-reply.md 第三节;画布「③ Jev 标注页」):
 * Jev 唯一的设置页。连接(地址、key、测试、模型名)/ 用量(只数 token)/ 哪几路交给 Jev(和插件页同一个设置)/
 * 常用(带上一条回复、立绘和文字同步、说话人门槛)/ 高级(两条队列、通用问法)/ 试判。
 * 各插件页在 Jev 模式下只放自己那道题和门槛,加一行指路到这里(JevSettings.tsx 的 JevPointer)。
 */

type Notify = (kind: 'ok' | 'error', message: string) => void;

/** 「哪几路交给 Jev」的一行 */
export interface JevKindRow {
  kind: JevKind;
  name: string;
  /** 全局设的模式(插件页切的就是它) */
  mode: TagMode;
  onChangeMode: (mode: TagMode) => void;
  /** 插件开关;没有开关的一路算开着 */
  powerOn: boolean;
  /** CG:这张卡没有能出的 CG */
  noAssets?: boolean;
  /** 去这一路的插件页 */
  onDetail: () => void;
}

const SHARED_LABELS: Record<SharedPromptKey, { label: string; placeholders: ('char' | 'user' | 'n' | 'line')[]; rows: number }> = {
  state: { label: '通用说明(每次放在最前面)', placeholders: ['char', 'user'], rows: 3 },
  before: { label: '「上一条回复」的说明(带了上一条回复时接在通用说明后面)', placeholders: ['char', 'user'], rows: 2 },
  speaker: { label: '说话人题', placeholders: ['n', 'line', 'char', 'user'], rows: 2 },
  speaker_char: { label: '　选项「角色」的说明', placeholders: ['char', 'user'], rows: 2 },
  speaker_user: { label: '　选项「玩家」的说明', placeholders: ['char', 'user'], rows: 2 },
  speaker_other: { label: '　选项「别人」的说明', placeholders: ['char', 'user'], rows: 2 },
  speaker_none: { label: '　选项「不是说话」的说明', placeholders: ['char', 'user'], rows: 2 },
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const looksLikeUrl = (v: string) => /^https?:\/\/[^/\s]+/.test(v.trim());

export function JevPage({
  jev,
  rows,
  testOk,
  onTested,
  notify,
  cardName,
}: {
  /** 正在聊的那张卡(试判用它最新一条回复;游戏皮空着时那行字用) */
  cardName?: string;
  jev: JevControls;
  rows: readonly JevKindRow[];
  /** 这次打开页面以后测过没有(左栏圆点也看它) */
  testOk: boolean | null;
  onTested: (ok: boolean | null) => void;
  notify: Notify;
}) {
  const { game } = useDrawerSkin();
  const { config, onChangeConfig, keyStatus, defaults } = jev;
  const s = jev.lastStats;
  const health = jevHealth({
    hasKey: Boolean(keyStatus?.has_key),
    anyJevMode: rows.some((r) => r.mode === 'jev'),
    testOk,
    last: s,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null);
  const [trial, setTrial] = useState<JevTrial | null>(null);

  // ---- 用量:进页面、每条回复判完、测试 / 试判以后重读 ----
  const [usage, setUsage] = useState<JevUsage | null | 'old'>(null);
  const loadUsage = useCallback(() => {
    debugApi
      .annotateUsage()
      .then(setUsage)
      .catch(() => setUsage('old'));
  }, []);
  useEffect(loadUsage, [loadUsage, s]);

  // ---- 地址、模型名、key 的草稿 ----
  const url = keyStatus?.url ?? '';
  const defaultUrl = keyStatus?.default_url ?? 'https://api.typesafe.ai/v1/systemone';
  const model = keyStatus?.model ?? '';
  const defaultModel = keyStatus?.default_model ?? 'jev-latest';
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const urlShown = urlDraft ?? (keyStatus?.url_source === 'settings' ? url : '');
  const modelShown = modelDraft ?? (keyStatus?.model_source === 'settings' ? model : '');
  const urlBad = urlShown.trim() !== '' && !looksLikeUrl(urlShown);
  const oldBackend = keyStatus !== null && keyStatus.url === undefined;

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      notify('error', errText(e));
    } finally {
      setBusy(null);
    }
  };
  const saveEndpoint = (nextUrl: string, nextModel: string) =>
    run('endpoint', async () => {
      await jev.onSaveEndpoint(nextUrl.trim(), nextModel.trim());
      setUrlDraft(null);
      setModelDraft(null);
      setTested(null);
      onTested(null);
      notify('ok', '已保存 Jev 的地址');
    });
  const saveKey = (key: string) =>
    run('key', async () => {
      await jev.onSaveKey(key);
      setKeyDraft('');
      setTested(null);
      onTested(null);
      notify('ok', key ? 'Jev 的 key 已保存' : 'Jev 的 key 已删除');
    });
  const test = async () => {
    setBusy('test');
    try {
      const { ms } = await jev.onTest();
      setTested({ ok: true, text: `通了 · ${(ms / 1000).toFixed(2)} 秒` });
      onTested(true);
    } catch (e) {
      setTested({ ok: false, text: errText(e) });
      onTested(false);
    } finally {
      setBusy(null);
      loadUsage();
    }
  };
  const runTrial = () =>
    run('trial', async () => {
      setTrial(await jev.onTrial());
      loadUsage();
    });
  const setPrompt = (k: SharedPromptKey, v: string | null) => onChangeConfig({ ...config, prompts: { ...config.prompts, [k]: v } });

  const connRows = (
    <>
      <SettingRow
        label="地址"
        control={{
          kind: 'custom',
          render: () =>
            keyStatus?.url_source === 'env' ? (
              <span className="jev-fixed">
                <code className="pl-code">{url}</code> 来自后端环境变量 JEV_BASE_URL,这里改不了
              </span>
            ) : (
              <>
                <input
                  className={`text-input set-text mono${urlBad ? ' bad' : ''}`}
                  type="text"
                  aria-label="Jev 的地址"
                  value={urlShown}
                  placeholder={defaultUrl}
                  disabled={oldBackend}
                  spellCheck={false}
                  onChange={(e) => setUrlDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="btn small accent"
                  disabled={busy !== null || urlDraft === null || urlBad}
                  onClick={() => void saveEndpoint(urlShown, modelShown)}
                >
                  保存
                </button>
                {keyStatus?.url_source === 'settings' && (
                  <button type="button" className="btn small" disabled={busy !== null} onClick={() => void saveEndpoint('', modelShown)}>
                    恢复官方
                  </button>
                )}
                {urlBad && <span className="set-error">地址要以 http:// 或 https:// 开头</span>}
                {oldBackend && <span className="set-error">后端还是旧版,重启后端以后才能填地址</span>}
              </>
            ),
        }}
        tip={`${TIPS.jev_url}${defaultUrl}`}
      />
      <SettingRow
        label="key"
        control={{
          kind: 'custom',
          render: () =>
            keyStatus?.source === 'env' ? (
              <span className="jev-fixed">key 来自后端环境变量 JEV_API_KEY,这里改不了</span>
            ) : (
              <>
                <input
                  className="text-input set-text"
                  type="password"
                  autoComplete="off"
                  aria-label="Jev 的 key"
                  placeholder={keyStatus?.has_key ? '已设置 · 填新的就换掉' : '粘贴 Jev 的 key'}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="btn small accent"
                  disabled={busy !== null || !keyDraft.trim()}
                  onClick={() => void saveKey(keyDraft.trim())}
                >
                  {keyStatus?.has_key ? '换一个' : '保存'}
                </button>
                {/* key 只能写不能读,删了就找不回来:和别处的删除一样点两次 */}
                {keyStatus?.has_key && <DeleteButton disabled={busy !== null} onConfirm={() => void saveKey('')} />}
              </>
            ),
        }}
        tip={keyStatus?.has_key ? 'jev_key' : 'jev_key_missing'}
      />
      <SettingRow
        label="测试"
        control={{
          kind: 'custom',
          render: () => (
            <>
              <button type="button" className="btn small" disabled={busy !== null || !keyStatus?.has_key} onClick={() => void test()}>
                {busy === 'test' ? '测试中…' : tested && !tested.ok ? '再测一次' : '测试'}
              </button>
              {tested && <span className={tested.ok ? 'jev-ok' : 'set-error'}>{tested.text}</span>}
            </>
          ),
        }}
        scopes={[]}
        tip="jev_test"
      />
      <SettingRow
        label="模型名"
        control={{
          kind: 'custom',
          render: () =>
            keyStatus?.model_source === 'env' ? (
              <span className="jev-fixed">
                <code className="pl-code">{model}</code> 来自后端环境变量 JEV_MODEL,这里改不了
              </span>
            ) : (
              <>
                <input
                  className="text-input set-text mono"
                  type="text"
                  aria-label="Jev 的模型名"
                  value={modelShown}
                  placeholder={defaultModel}
                  disabled={oldBackend}
                  spellCheck={false}
                  onChange={(e) => setModelDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="btn small"
                  disabled={busy !== null || modelDraft === null}
                  onClick={() => void saveEndpoint(urlShown, modelShown)}
                >
                  保存
                </button>
              </>
            ),
        }}
        tip={`${TIPS.jev_model}${defaultModel}`}
      />
    </>
  );
  const speakerRow = (
    <SettingRow
      label="说话人门槛"
      control={{
        kind: 'slider',
        min: SPEAKER_THRESHOLD.min,
        max: SPEAKER_THRESHOLD.max,
        step: 0.05,
        low: '更敢判成别人',
        high: '更不容易漏念',
        format: (v) => v.toFixed(2),
      }}
      value={config.speakerThreshold}
      default={SPEAKER_THRESHOLD.default}
      onChange={(v) => onChangeConfig({ ...config, speakerThreshold: v })}
      tip="jev_speaker"
    />
  );
  const queuesRow = (
    <SettingRow
      label="两条队列(试用)"
      control={{ kind: 'toggle' }}
      value={config.twoQueues}
      default={false}
      onChange={(v) => onChangeConfig({ ...config, twoQueues: v })}
      tip="jev_two_queues"
    />
  );
  const promptsBlock = (
    <div className="jev-prompts">
      <span className="jev-prompts-title">
        通用说明和说话人的问法 <Tip k="jev_prompts" />
      </span>
      {SHARED_PROMPT_KEYS.map((k) => (
        <PromptField
          key={k}
          label={SHARED_LABELS[k].label}
          promptKey={k}
          value={config.prompts[k]}
          defaults={defaults}
          placeholders={SHARED_LABELS[k].placeholders}
          onChange={(v) => setPrompt(k, v)}
          rows={SHARED_LABELS[k].rows}
        />
      ))}
    </div>
  );

  /**
   * 游戏皮(设计稿 kit/plugins.js P.jev):中间 = 试判(纸面板,空着时一行「最新一条回复 · 交给 Jev 的:…」)+ 用量四格;
   * 右栏 = 哪几路交给 Jev · 常用(带上一条回复、立绘和文字同步)· 高级(连接 · 说话人门槛 · 两条队列 · 问法)。
   * 调试台里照旧一列(下面那份)。
   */
  function renderGame() {
    const routed = rows.filter((r) => r.mode === 'jev' && r.powerOn && !r.noAssets).map((r) => r.name);
    const changedPrompts = SHARED_PROMPT_KEYS.some((k) => config.prompts[k] !== null && config.prompts[k] !== undefined);
    const head = (
      <PageHead
        title="Jev 标注"
        tip="jev_page"
        inUse={{ on: health === 'ok', text: HEALTH_TEXT[health] }}
        tags={[]}
        note={
          s && s.kinds.length > 0
            ? `上一条回复 · ${s.lines} 句 · ${tokenText(s.tokens)} token · 最慢 ${(s.maxMs / 1000).toFixed(2)} 秒${
                s.failed ? ` · ${s.failed} 句没判成${s.error ? `(${s.error})` : ''}` : ''
              }`
            : undefined
        }
      />
    );
    const mid = (
      <>
        <Panel
          title="试判"
          en="Trial"
          tip="jev_trial"
          className="dw-trial"
          right={
            <button type="button" className="btn accent" disabled={busy !== null || !keyStatus?.has_key} onClick={() => void runTrial()}>
              {busy === 'trial' ? '判断中…' : '用最新一条回复试判'}
            </button>
          }
        >
          {trial ? (
            <div className="dw-trial-body">
              <TrialTable trial={trial} kinds={jev.kinds} keep={defaults?.keep ?? '不换'} />
            </div>
          ) : (
            <div className="dw-trial-body dw-blank-in">
              <NavIcon id="jev" size={28} />
              <b>{cardName ? `${cardName}最新一条回复` : '最新一条回复'}</b>
              <span>
                {keyStatus?.has_key ? `交给 Jev 的:${routed.join(' · ') || '(都是 AI 写)'}` : 'Jev 还没填 key,先在「高级 · 连接」里填'}
              </span>
            </div>
          )}
        </Panel>
        <div className="dw-cap2">
          用量
          <Tip k="jev_usage" />
        </div>
        {usage === 'old' ? (
          <div className="dw-muted">后端还是旧版,重启后端以后才有用量。</div>
        ) : (
          <div className="dw-usage">
            {(
              [
                ['today', '今天'],
                ['week', '这 7 天'],
                ['month', '这个月'],
                ['all', '全部'],
              ] as const
            ).map(([k, name]) => (
              <div key={k}>
                <div className="k">{name}</div>
                <div className="n">{usage ? tokenText(usage[k].tokens) : '…'}</div>
                <div className="s">{usage ? usage[k].requests.toLocaleString() : '…'} 次请求</div>
              </div>
            ))}
          </div>
        )}
      </>
    );
    const kindsSection = (
      <Section title="哪几路交给 Jev" en="Routes" tip="jev_kinds">
        {rows.map((r) => {
          const st = jevKindStatus({
            mode: r.mode,
            inUse: jev.kinds[r.kind],
            powerOn: r.powerOn,
            hasKey: Boolean(keyStatus?.has_key),
            noAssets: r.noAssets,
          });
          return (
            <div key={r.kind} className="dw-kind">
              <span className="k">
                <NavIcon id={r.kind} size={16} />
                {r.name}
              </span>
              <div className="set-seg" role="radiogroup" aria-label={`${r.name}的标签由谁写`}>
                {(['ai', 'jev'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={r.mode === m}
                    className={r.mode === m ? 'on' : ''}
                    onClick={() => r.mode !== m && r.onChangeMode(m)}
                  >
                    {m === 'ai' ? 'AI 写' : 'Jev 标'}
                  </button>
                ))}
              </div>
              <span className={`st${r.mode === 'jev' && jev.kinds[r.kind] ? ' on' : ''}`}>{r.mode === 'jev' ? st : ''}</span>
              <button type="button" className="dw-go" aria-label={`去${r.name}插件页`} title={`去${r.name}`} onClick={r.onDetail}>
                <Icon name="chev_r" size={16} />
              </button>
            </div>
          );
        })}
      </Section>
    );
    const common = (
      <>
        {kindsSection}
        <Section title="常用" en="Common">
          <SettingRow
            label="带上一条回复"
            control={{
              kind: 'slider',
              min: JEV_BEFORE_LINES.min,
              max: JEV_BEFORE_LINES.max,
              step: 1,
              format: (v) => (v === 0 ? '不带' : `${v} 句`),
            }}
            value={config.beforeLines}
            default={JEV_BEFORE_LINES.default}
            onChange={(v) => onChangeConfig({ ...config, beforeLines: v })}
            tip="jev_before"
          />
          <SettingRow
            label="立绘和文字同步"
            control={{ kind: 'toggle' }}
            value={config.syncText}
            default={true}
            onChange={(v) => onChangeConfig({ ...config, syncText: v })}
            tip="jev_sync"
          />
        </Section>
      </>
    );
    const advanced = (
      <Advanced
        pageId="jev"
        tabs={[
          { id: 'conn', name: '连接' },
          { id: 'speaker', name: '说话人门槛' },
          { id: 'queues', name: '两条队列' },
          {
            id: 'prompts',
            name: '问法',
            badge: changedPrompts ? '改过' : String(SHARED_PROMPT_KEYS.length),
          },
        ]}
        render={(tab) =>
          tab === 'conn' ? (
            <div className="dw-tab-stack">{connRows}</div>
          ) : tab === 'speaker' ? (
            speakerRow
          ) : tab === 'queues' ? (
            queuesRow
          ) : (
            promptsBlock
          )
        }
      />
    );
    return <PageShell head={head} preview={mid} common={common} advanced={advanced} />;
  }

  if (game) return renderGame();

  return (
    <div className="jev-page">
      <PageHead
        title="Jev 标注"
        tip="jev_page"
        inUse={{ on: health === 'ok', text: HEALTH_TEXT[health] }}
        tags={[]}
        note={
          s && s.kinds.length > 0
            ? `上一条回复:判了 ${s.lines} 句 · ${tokenText(s.tokens)} token · 最慢 ${(s.maxMs / 1000).toFixed(2)} 秒${
                s.failed ? ` · ${s.failed} 句没判成${s.error ? `(${s.error})` : ''}` : ''
              }`
            : undefined
        }
      />

      <SettingGroup title="连接">{connRows}</SettingGroup>

      <SettingGroup title="用量" tip="jev_usage">
        {usage === 'old' ? (
          <div className="jev-usage-note">后端还是旧版,重启后端以后才有用量。</div>
        ) : (
          <div className="jev-usage">
            {(
              [
                ['today', '今天'],
                ['week', '这 7 天'],
                ['month', '这个月'],
                ['all', '全部'],
              ] as const
            ).map(([k, name]) => (
              <div key={k} className="jev-usage-tile">
                <span className="jev-usage-name">{name}</span>
                <span className="jev-usage-num">{usage ? tokenText(usage[k].tokens) : '…'}</span>
                <span className="jev-usage-sub">token · {usage ? usage[k].requests.toLocaleString() : '…'} 次请求</span>
              </div>
            ))}
          </div>
        )}
      </SettingGroup>

      <SettingGroup title="哪几路交给 Jev" tip="jev_kinds">
        {rows.map((r) => (
          <div key={r.kind} className="jev-kind-row">
            <span className="set-label">{r.name}</span>
            <div className="set-seg" role="radiogroup" aria-label={`${r.name}的标签由谁写`}>
              {(['ai', 'jev'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={r.mode === m}
                  className={r.mode === m ? 'on' : ''}
                  onClick={() => r.mode !== m && r.onChangeMode(m)}
                >
                  {m === 'ai' ? 'AI 写' : 'Jev 标'}
                </button>
              ))}
            </div>
            <span className="jev-kind-status">
              {jevKindStatus({
                mode: r.mode,
                inUse: jev.kinds[r.kind],
                powerOn: r.powerOn,
                hasKey: Boolean(keyStatus?.has_key),
                noAssets: r.noAssets,
              })}
            </span>
            <button type="button" className="btn small" onClick={r.onDetail}>
              详情 →
            </button>
          </div>
        ))}
      </SettingGroup>

      <SettingGroup title="常用" tip="jev_common">
        <SettingRow
          label="带上一条回复"
          control={{
            kind: 'slider',
            min: JEV_BEFORE_LINES.min,
            max: JEV_BEFORE_LINES.max,
            step: 1,
            format: (v) => (v === 0 ? '不带' : `${v} 句`),
          }}
          value={config.beforeLines}
          default={JEV_BEFORE_LINES.default}
          onChange={(v) => onChangeConfig({ ...config, beforeLines: v })}
          tip="jev_before"
        />
        <SettingRow
          label="立绘和文字同步"
          control={{ kind: 'toggle' }}
          value={config.syncText}
          default={true}
          onChange={(v) => onChangeConfig({ ...config, syncText: v })}
          tip="jev_sync"
        />
        {speakerRow}
      </SettingGroup>

      <details className="jev-advanced">
        <summary>
          高级 <Tip k="jev_advanced" />
        </summary>
        <SettingGroup title="高级">
          {queuesRow}
          {promptsBlock}
        </SettingGroup>
      </details>

      <SettingGroup title="试判" tip="jev_trial">
        <div className="jev-trial">
          <button
            type="button"
            className="btn small accent"
            disabled={busy !== null || !keyStatus?.has_key}
            onClick={() => void runTrial()}
          >
            {busy === 'trial' ? '判断中…' : '用最新一条回复试判'}
          </button>
          {trial && <TrialTable trial={trial} kinds={jev.kinds} keep={defaults?.keep ?? '不换'} />}
        </div>
      </SettingGroup>
    </div>
  );
}
