/**
 * 生图的全部设置,像游戏设置那样分页(10-12 用户:「设置都在一面,像游戏那样分页设置」):
 * 画面 / 角色 / 自动出图 / 连接 / 高级 / 相册(11-07「服务」改成「连接」,除了连接和相册,改的都是当前这张卡)。
 * 游戏里在「菜单 → 设置 → AI 生图」,调试台插件页「AI 生图」也是这一套;place="console" 时自带一块深色底和视觉小说的配色变量。
 * 设计见 docs/superpowers/specs/2026-10-11-novelai-image-gen-design.md。
 */

import { useEffect, useRef, useState } from 'react';
import { apiUrl, debugApi, spriteImageUrl, type PackSprite } from '../../lib/api';
import { Tip } from '../../components/drawer/Tip';
import { imagegenApi } from './api';
import {
  anlasCost,
  BUILTIN_STYLES,
  CAMERAS,
  defaultScale,
  DEFAULT_PLAYER,
  MODELS,
  noiseFor,
  NOISES,
  orientsOf,
  qualityOptions,
  REFERENCE_ANLAS,
  REF_STRENGTH,
  RESOLUTIONS,
  SAMPLERS,
  SFW_MODEL,
  SIZE_NAMES,
  sizeOf,
  snapSide,
  supportsReference,
  UC_PRESETS,
  usesReference,
  type CardRef,
  type Gender,
  type ImageGenConfig,
  type ImageStyle,
  type ResPreset,
} from './config';
import './imagegen.css';
import { IG_TIPS } from './tips';
import { ConsoleTips } from './consoleTips';
import { ConnPage } from './ConnPage';
import { AddConnDialog, TrialDialog } from './dialogs';
import { connectionText, connOption, costPending, modelOf, moreSummary, novelaiCost, qualityChoices, relaySizes, sdMoreSummary, sentSize, timingText, trialCost } from './connModel';
import { RelayModelPick } from './RelayParts';
import { LoraRow, SdModelRow, SdSamplerRows } from './SdParts';
import { useSdOptions } from './useSdOptions';
import { Group, Para, Row, Seg, Toggle } from './ui';
import type { ImageGenStore } from './useImageGen';

type Page = 'picture' | 'cast' | 'auto' | 'conn' | 'advanced' | 'album';
const PAGES: readonly { key: Page; name: string }[] = [
  { key: 'picture', name: '画面' },
  { key: 'cast', name: '角色' },
  { key: 'auto', name: '自动出图' },
  { key: 'conn', name: '连接' },
  { key: 'advanced', name: '高级' },
  { key: 'album', name: '相册' },
];
/** 没选卡也能用的两页(11-07 设计第 11 节):连接是全局的,相册自己会说先选卡 */
const NO_CARD_OK: ReadonlySet<Page> = new Set<Page>(['conn', 'album']);
/** 设置页上开着的小窗 */
type Dialog = { kind: 'add' } | { kind: 'trial'; connId: string } | null;
// 关掉再打开(游戏里换页、调试台换插件)回到上次那一页
let lastPage: Page = 'picture';

const GENDERS: readonly { value: Gender; name: string }[] = [
  { value: 'female', name: '女' },
  { value: 'male', name: '男' },
];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── 画面 ──

/** 用哪个画风(首屏那一行):下拉 + 新建 / 删掉这个 / 恢复默认。画风库是全局的,用哪个是这张卡的 */
function StylePick({ config, onChange }: { config: ImageGenConfig; onChange: (next: ImageGenConfig) => void }) {
  const style = config.styles.find((s) => s.id === config.styleId) ?? config.styles[0];
  const add = () => {
    const id = `s${Date.now().toString(36)}`;
    onChange({ ...config, styles: [...config.styles, { id, name: '新画风', tags: '', negative: '', artists: '' }], styleId: id });
  };
  const remove = () => {
    const rest = config.styles.filter((s) => s.id !== style.id);
    if (rest.length) onChange({ ...config, styles: rest, styleId: rest[0].id });
  };
  const builtin = BUILTIN_STYLES.find((s) => s.id === style.id);
  const changed =
    builtin &&
    (builtin.tags !== style.tags ||
      builtin.negative !== style.negative ||
      builtin.name !== style.name ||
      builtin.artists !== style.artists);
  return (
    <Row label="画风">
      <div className="ig-inline">
        <select
          className="vn-set-select"
          value={style.id}
          aria-label="画风"
          onChange={(e) => onChange({ ...config, styleId: e.target.value })}
        >
          {config.styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="vn-pill" onClick={add}>
          新建
        </button>
        {config.styles.length > 1 && (
          <button className="vn-pill" onClick={remove}>
            删掉这个
          </button>
        )}
        {changed && (
          <button
            className="vn-pill"
            onClick={() => onChange({ ...config, styles: config.styles.map((s) => (s.id === style.id ? { ...s, ...builtin } : s)) })}
          >
            恢复默认
          </button>
        )}
      </div>
    </Row>
  );
}

/** 这个画风里写了什么(「基础提示词」那一组)。改的是全局画风库:别的卡用同一个画风也跟着变 */
function StyleDetail({ config, onChange, relay }: { config: ImageGenConfig; onChange: (next: ImageGenConfig) => void; relay: boolean }) {
  const style = config.styles.find((s) => s.id === config.styleId) ?? config.styles[0];
  const setStyle = (patch: Partial<ImageStyle>) =>
    onChange({ ...config, styles: config.styles.map((s) => (s.id === style.id ? { ...s, ...patch } : s)) });
  return (
    <>
      <Row label="名字">
        <input className="ig-input" value={style.name} onChange={(e) => setStyle({ name: e.target.value })} />
      </Row>
      <Row label="画风标签" tip={IG_TIPS.style_tags}>
        <textarea className="ig-input" rows={2} value={style.tags} onChange={(e) => setStyle({ tags: e.target.value })} />
      </Row>
      {/* 中转站的提示词是一段话,只用画风标签 */}
      {!relay && (
        <>
          <Row label="画师串" tip={IG_TIPS.artists}>
            <input className="ig-input" value={style.artists} onChange={(e) => setStyle({ artists: e.target.value })} />
          </Row>
          <Row label="不想要的">
            <input className="ig-input" value={style.negative} onChange={(e) => setStyle({ negative: e.target.value })} />
          </Row>
        </>
      )}
    </>
  );
}

/** 摘要里太长的长相截一截 */
function short(text: string, n = 48) {
  const t = text.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 连接下拉里「加一条连接…」那一项的值 */
const ADD_CONN = '__add';

/**
 * 画面(11-07 效果图 3 的 A):首屏是 连接(下拉)、模型、画风、尺寸、测试出图,步数、引导、采样器这些收进「更多」;
 * 下面照旧是 NovelAI 网页那几组(基础提示词 → 反向 → 角色提示词 → 参考图)和「在游戏里怎么显示」。
 * 改的都是这张卡:画风、尺寸、镜头换连接不变;模型、步数这些是这张卡在这条连接下的那份。
 * NovelAI 专有的那几项(Variety+、噪声调度、Rescale、费用)只在 NovelAI 连接下显示;本地 SD 多一排 LoRA(SdParts.tsx)
 */
function PicturePage({
  store,
  go,
  onAdd,
  onTrial,
}: {
  store: ImageGenStore;
  go: (p: Page) => void;
  onAdd: () => void;
  onTrial: (connId: string) => void;
}) {
  const { config, changeConfig: set, prefs, defaults, conn } = store;
  const nai = conn?.kind === 'novelai';
  const naiId = nai && conn ? conn.id : null;
  const account = conn ? store.accounts[conn.id] : undefined;
  const accountError = conn ? store.accountErrors[conn.id] : undefined;
  const v5 = !supportsReference(config.model);
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const relay = conn?.kind === 'openai';
  const sd = conn?.kind === 'sdapi';
  const sdOptions = useSdOptions(sd && conn ? conn.id : null);
  const size = sentSize(conn?.kind ?? null, sizeOf(config, config.size, viewport), conn && relay ? relaySizes(conn) : '');
  // 账户查不到时按 Opus 算(免费范围、「允许扣 Anlas」也都是照 Opus 的)
  const opus = account ? account.tier === 3 : true;
  const cost = anlasCost({ model: config.model, w: size.w, h: size.h, steps: config.steps, opus });
  const withRef = Boolean(store.cardId) && (relay ? prefs.ref.kind !== 'off' : usesReference(config, prefs));
  const total = novelaiCost(config, size, opus, withRef);
  // 选的是 NovelAI:查一次这条连接的账户(算扣不扣 Anlas、V5 额度条还剩多少)
  const asked = useRef<string | null>(null);
  const { checkAccount } = store;
  useEffect(() => {
    if (!naiId || asked.current === naiId || account) return;
    asked.current = naiId;
    void checkAccount(naiId);
  }, [naiId, account, checkAccount]);
  // 这张卡上次用这条连接画的那张花了多久(写在测试出图旁边)
  const last = conn ? store.album?.find((x) => x.params.connection?.id === conn.id) : undefined;

  // 只画全年龄的卡画的时候换成 Curated:预设原文照那个模型的显示
  const model = prefs.sfwOnly ? (SFW_MODEL[config.model] ?? config.model) : config.model;
  const qualityOpts = conn ? qualityChoices(conn.kind, config.model) : qualityOptions(config.model);
  const qualityValue = qualityOpts.some((q) => q.value === config.quality) ? config.quality : 'standard';
  const qualities = defaults?.quality_presets[model];
  const qualityText = qualityValue === 'none' ? '' : (qualities?.[qualityValue] ?? qualities?.standard ?? '');
  const ucText = defaults?.uc_presets[model]?.[config.ucPreset] ?? '';
  const scaleDefault = defaultScale(config.model);
  const custom = config.res === 'custom';
  const setSide = (k: 'w' | 'h', v: number) => set({ ...config, custom: { ...config.custom, [k]: v } });
  const refText = relay
    ? !store.cardId
      ? '先选一张角色卡'
      : prefs.ref.kind === 'off'
        ? '不用'
        : `${prefs.ref.kind === 'upload' ? '上传的那张' : '立绘'} · 和文字一起发给模型`
    : v5
    ? 'V5 用不了参考图:画的时候用写的长相(要用就换 V4.5)'
    : !store.cardId
      ? '先选一张角色卡'
      : prefs.ref.kind === 'off'
        ? '不用'
        : `${prefs.ref.kind === 'upload' ? '上传的那张' : '立绘'} · ${prefs.ref.style ? '连画风一起参考' : '只参考人'}${prefs.ref.strength < 1 ? ` · 强度 ${prefs.ref.strength.toFixed(2)}` : ''} · 每张 ${REFERENCE_ANLAS} Anlas`;
  const herText = !store.cardId
    ? '先选一张角色卡'
    : [prefs.nameTag, withRef ? '长相看参考图' : short(prefs.look) || '还没写长相(第一次画时让指导模型读卡写)']
        .filter(Boolean)
        .join(' · ');
  const costNote = [
    cost === 0
      ? v5
        ? `走 Opus 的 V5 额度条${account?.v5_percent != null ? `(还剩 ${account.v5_percent}%)` : ''}`
        : 'Opus 免费范围'
      : `${size.w}×${size.h}、${config.steps} 步${opus ? ',超出 Opus 免费范围(面积 ≤ 1024×1024、≤ 28 步)' : ''}`,
    withRef ? `含参考图 ${REFERENCE_ANLAS}` : '',
    account ? `余额 ${account.anlas}` : accountError ? '没查到账户,按 Opus 算' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="vn-set-list">
      <Row label="连接" tip={IG_TIPS.conn_pick}>
        <select
          className="vn-set-select ig-conn-pick"
          aria-label="画图连接"
          value={conn?.id ?? ''}
          onChange={(e) => (e.target.value === ADD_CONN ? onAdd() : store.setConn(e.target.value || null))}
        >
          {!conn && (
            <option value="" disabled>
              {store.imageConns?.length ? '先选一条' : '还没有画图连接'}
            </option>
          )}
          {(store.imageConns ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {connOption(c)}
            </option>
          ))}
          <option value={ADD_CONN}>加一条连接…</option>
        </select>
      </Row>
      {nai ? (
        <Row label="模型" en="Model" tip={v5 ? IG_TIPS.model_v5 : IG_TIPS.model_v45}>
          <select className="vn-set-select" value={config.model} onChange={(e) => set({ ...config, model: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
      ) : conn?.kind === 'openai' ? (
        <Row label="模型" en="Model" note={store.drawBlock === 'model' ? '选了模型才能画' : undefined}>
          <RelayModelPick connId={conn.id} model={modelOf(conn.kind, config.model)} onModel={(m) => set({ ...config, model: m })} />
        </Row>
      ) : sd ? (
        <SdModelRow config={config} onChange={set} sd={sdOptions} />
      ) : conn ? (
        <Row label="模型" en="Model">
          <span className="vn-set-note">这种连接还不能出图</span>
        </Row>
      ) : null}
      <StylePick config={config} onChange={set} />
      {sd && <LoraRow config={config} onChange={set} sd={sdOptions} />}
      <Row label="尺寸" en="Resolution" tip={custom ? IG_TIPS.size_custom : undefined} note={`实际发出 ${size.w} × ${size.h}`}>
        <div className="ig-inline">
          <select
            className="vn-set-select"
            value={config.res}
            aria-label="分辨率"
            onChange={(e) => {
              const res = e.target.value as ResPreset;
              set({ ...config, res, size: orientsOf(res).includes(config.size) ? config.size : 'landscape' });
            }}
          >
            {RESOLUTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.name}
              </option>
            ))}
          </select>
          <Seg
            options={orientsOf(config.res).map((k) => ({ value: k, name: SIZE_NAMES[k] }))}
            value={config.size}
            onPick={(v) => set({ ...config, size: v })}
          />
        </div>
        {custom && (
          <div className="ig-inline">
            <NumberBox value={config.custom.w} label="宽" onCommit={(v) => setSide('w', v)} />
            <span>×</span>
            <NumberBox value={config.custom.h} label="高" onCommit={(v) => setSide('h', v)} />
          </div>
        )}
      </Row>
      {(nai || sd) && (
        <details className="ig-more">
          <summary>
            更多 <span className="ig-more-sum">{sd ? sdMoreSummary(config) : moreSummary(config)}</span>
          </summary>
          <Row label="步数" en="Steps" value={String(config.steps)}>
            <input
              type="range"
              min={1}
              max={50}
              value={config.steps}
              aria-label="步数"
              onChange={(e) => set({ ...config, steps: Number(e.target.value) })}
            />
          </Row>
          <Row label="引导" en="Prompt Guidance" value={config.scale.toFixed(1)}>
            <input
              type="range"
              min={0}
              max={10}
              step={0.1}
              value={config.scale}
              aria-label="引导"
              onChange={(e) => set({ ...config, scale: Number(e.target.value) })}
            />
          </Row>
          {nai && config.scale !== scaleDefault && (
            <div className="ig-inline ig-under">
              <button className="vn-pill" onClick={() => set({ ...config, scale: scaleDefault })}>
                引导恢复这个模型的默认({scaleDefault})
              </button>
            </div>
          )}
          <Row label="种子" en="Seed" tip={IG_TIPS.seed}>
            <div className="ig-inline">
              <input
                className="ig-input ig-seed"
                inputMode="numeric"
                placeholder="随机"
                aria-label="种子"
                value={config.seed ?? ''}
                onChange={(e) => {
                  const t = e.target.value.replace(/\D/g, '');
                  set({ ...config, seed: t ? Math.min(4294967295, Number(t)) : null });
                }}
              />
              {config.seed !== null && (
                <button className="vn-pill" onClick={() => set({ ...config, seed: null })}>
                  改回随机
                </button>
              )}
            </div>
          </Row>
          {sd ? (
            <SdSamplerRows config={config} onChange={set} sd={sdOptions} />
          ) : (
            <>
              <Row label="采样器" en="Sampler">
                <select
                  className="vn-set-select"
                  value={config.sampler}
                  onChange={(e) => set({ ...config, sampler: e.target.value, noise: noiseFor(e.target.value) })}
                >
                  {SAMPLERS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="引导重缩放" en="Guidance Rescale" value={config.rescale.toFixed(2)}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={config.rescale}
                  aria-label="引导重缩放"
                  onChange={(e) => set({ ...config, rescale: Number(e.target.value) })}
                />
              </Row>
              {v5 ? (
                <p className="vn-set-note ig-pad">V5 没有噪声调度(固定 Karras)和 Variety+。</p>
              ) : (
                <>
                  <Row label="噪声调度" en="Noise Schedule">
                    <Seg options={NOISES} value={config.noise} onPick={(v) => set({ ...config, noise: v })} />
                  </Row>
                  <Row label="Variety+">
                    <Toggle checked={config.variety} onChange={(v) => set({ ...config, variety: v })}>
                      构图更多变化(前几步不按提示词引导)
                    </Toggle>
                  </Row>
                </>
              )}
              <Row label="扣费" tip={IG_TIPS.nai}>
                <Toggle checked={config.allowPaid} onChange={(v) => set({ ...config, allowPaid: v })}>
                  允许超出免费范围(每张扣 Anlas)
                </Toggle>
              </Row>
            </>
          )}
        </details>
      )}
      {conn && !store.drawBlock && (
        <div className="ig-testbar">
          <button
            className="vn-pill accent"
            disabled={costPending(conn, store.accounts, store.accountErrors)}
            onClick={() => onTrial(conn.id)}
          >
            测试出图 · {trialCost(conn, config, prefs, account, Boolean(store.cardId), viewport)}
          </button>
          <Tip text={IG_TIPS.trial} />
          {last && last.ms > 0 && <span className="vn-set-note">上次 {(last.ms / 1000).toFixed(1)} 秒</span>}
        </div>
      )}
      {nai && (
        <>
          <div className={`ig-cost${total > 0 ? ' paid' : ''}`}>
            <span>
              画一张 <b>{total} Anlas</b>
            </span>
            <span className="vn-set-note">{costNote}</span>
          </div>
          {cost > 0 && opus && !config.allowPaid && (
            <p className="vn-set-error">超出免费范围要扣 Anlas:不在上面「更多」里打开「允许超出免费范围」就画不了。</p>
          )}
        </>
      )}

      <Group title="基础提示词" en="Base Prompt" tip={IG_TIPS.base} />
      <StyleDetail config={config} onChange={set} relay={relay} />
      {(nai || sd) && (
        <Row label="质量词" en="Quality Tags" note={nai ? (qualityText ? `加在最后:${qualityText}` : '不加') : undefined}>
          <Seg options={qualityOpts} value={qualityValue} onPick={(v) => set({ ...config, quality: v })} />
        </Row>
      )}

      {(nai || sd) && (
        <>
          <Group title="反向" en="Undesired Content" />
          <Row label="反向预设" en="UC Preset" note={nai ? (ucText ? `加在最前:${ucText}` : '不加预设') : undefined}>
            <Seg options={UC_PRESETS} value={config.ucPreset} onPick={(v) => set({ ...config, ucPreset: v })} />
          </Row>
          <Row label="另外加的" tip={IG_TIPS.uc_extra}>
            <textarea className="ig-input" rows={2} value={config.uc} onChange={(e) => set({ ...config, uc: e.target.value })} />
          </Row>
        </>
      )}

      <Group title="角色提示词" en="Character Prompts" tip={sd ? IG_TIPS.char_prompts_sd : IG_TIPS.char_prompts} />
      <Row label={store.cardId ? `她 · ${store.cardName}` : '她'}>
        <div className="ig-inline">
          <span className="ig-grow vn-set-note">{herText}</span>
          {store.cardId && (
            <button className="vn-pill" onClick={() => go('cast')}>
              去「角色」改
            </button>
          )}
        </div>
      </Row>
      <Row label="你">
        <div className="ig-inline">
          <span className="ig-grow vn-set-note">
            {config.camera === 'pov' ? '第一人称:不画你,只画你的手' : short(config.player.look)}
          </span>
          <button className="vn-pill" onClick={() => go('cast')}>
            去「角色」改
          </button>
        </div>
      </Row>
      <Row label="镜头" tip={IG_TIPS.camera}>
        <Seg options={CAMERAS} value={config.camera} onPick={(v) => set({ ...config, camera: v })} />
      </Row>

      {(nai || relay) && (
        <>
          <Group title="参考图" en="Character Reference" />
          <Row label="她的参考图">
            <div className="ig-inline">
              <span className="ig-grow vn-set-note">{refText}</span>
              {store.cardId && (relay || !v5) && (
                <button className="vn-pill" onClick={() => go('cast')}>
                  去「角色」改
                </button>
              )}
            </div>
          </Row>
        </>
      )}

      <Group title="在游戏里怎么显示" />
      <Row label="放在哪" tip={IG_TIPS.place}>
        <Seg
          options={[
            { value: 'above' as const, name: '对话框上面' },
            { value: 'screen' as const, name: '铺满屏幕' },
          ]}
          value={config.place}
          onPick={(v) => set({ ...config, place: v })}
        />
      </Row>
      <Row label="最少显示" value={`${config.holdLines} 句`} tip={IG_TIPS.hold}>
        <input
          type="range"
          min={1}
          max={10}
          value={config.holdLines}
          aria-label="最少显示几句"
          onChange={(e) => set({ ...config, holdLines: Number(e.target.value) })}
        />
      </Row>
    </div>
  );
}

/** 宽 / 高:打字时不动,离开或回车时对齐到 64 的倍数(256–2048) */
function NumberBox({ value, label, onCommit }: { value: number; label: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    const v = Number.isFinite(n) && n > 0 ? snapSide(n) : value;
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      className="ig-input ig-side"
      inputMode="numeric"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

// ── 角色 ──

const REF_KINDS: readonly { value: CardRef['kind']; name: string }[] = [
  { value: 'sprite', name: '用立绘' },
  { value: 'upload', name: '上传一张' },
  { value: 'off', name: '不用' },
];

/** 参考图:默认这张卡当前立绘包的默认立绘;可以点别的立绘、上传一张,或者不用 */
function ReferenceRows({ store }: { store: ImageGenStore }) {
  const { cardId, prefs, changePrefs, config, notify } = store;
  const ref = prefs.ref;
  const [sprites, setSprites] = useState<PackSprite[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    debugApi.listCardSprites(cardId).then(
      (rows) => live && setSprites(rows.filter((r) => r.enabled && r.has_image)),
      () => live && setSprites([]),
    );
    return () => {
      live = false;
    };
  }, [cardId]);
  const setRef = (next: CardRef) => {
    // 换掉上传的那张:删掉旧的那一行(文件没人引用以后由清理收走)
    if (ref.kind === 'upload' && ref.id && next.id !== ref.id) void imagegenApi.deleteRef(ref.id).catch(() => undefined);
    changePrefs({ ...prefs, ref: next });
  };
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const r = await imagegenApi.uploadRef(file, cardId);
      setRef({ ...ref, kind: 'upload', id: r.id, sha: r.sha });
    } catch (e) {
      notify('error', `参考图上传失败: ${errText(e)}`);
    } finally {
      setUploading(false);
    }
  };
  const chosen = ref.kind === 'sprite' ? (ref.id ?? sprites?.[0]?.id ?? null) : null;
  return (
    <>
      <Row
        label="参考图"
        tip={store.conn?.kind === 'openai' ? IG_TIPS.ref_relay : supportsReference(config.model) ? IG_TIPS.ref : IG_TIPS.ref_unsupported}
      >
        <div className="ig-inline">
          <Seg
            options={REF_KINDS}
            value={ref.kind}
            onPick={(kind) => {
              if (kind === 'upload' && !(ref.kind === 'upload' && ref.id)) fileRef.current?.click();
              else setRef(kind === 'sprite' ? { ...ref, kind, id: null, sha: null } : { ...ref, kind });
            }}
          />
          {ref.kind === 'upload' && (
            <button className="vn-pill" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? '上传中…' : '换一张'}
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
        {ref.kind === 'sprite' &&
          (sprites === null ? null : sprites.length === 0 ? (
            <span className="vn-set-note">这张卡没挂立绘包:画的时候用上面写的长相。</span>
          ) : (
            <div className="ig-ref-grid">
              {sprites.map((sp, i) => (
                <button
                  key={sp.id}
                  className={`ig-ref-item${sp.id === chosen ? ' on' : ''}`}
                  title={sp.label}
                  onClick={() => setRef({ ...ref, kind: 'sprite', id: i === 0 ? null : sp.id, sha: sp.image_sha ?? null })}
                >
                  <img src={spriteImageUrl(sp) ?? ''} alt={sp.label} loading="lazy" />
                  <span>{i === 0 ? `${sp.label}(默认)` : sp.label}</span>
                </button>
              ))}
            </div>
          ))}
        {ref.kind === 'upload' && ref.sha && (
          <div className="ig-ref-grid">
            <span className="ig-ref-item on">
              <img src={apiUrl(`/api/blobs/${ref.sha}`)} alt="上传的参考图" />
              <span>上传的</span>
            </span>
          </div>
        )}
        {ref.kind !== 'off' && (
          <Toggle checked={ref.style} onChange={(v) => setRef({ ...ref, style: v })}>
            连画风一起参考(不勾 = 只参考人,画风照「画面」里选的)
          </Toggle>
        )}
      </Row>
      {ref.kind !== 'off' && (
        <Row label="参考强度" value={ref.strength.toFixed(2)} tip={IG_TIPS.ref_strength}>
          <input
            type="range"
            min={REF_STRENGTH.min}
            max={REF_STRENGTH.max}
            step={REF_STRENGTH.step}
            value={ref.strength}
            aria-label="参考强度"
            onChange={(e) => setRef({ ...ref, strength: Math.round(Number(e.target.value) * 100) / 100 })}
          />
        </Row>
      )}
    </>
  );
}

function CastPage({ store }: { store: ImageGenStore }) {
  const { config, changeConfig: set, prefs, changePrefs } = store;
  const player = config.player;
  const setPlayer = (patch: Partial<typeof player>) => set({ ...config, player: { ...player, ...patch } });
  return (
    <div className="vn-set-list">
      {!store.cardId ? (
        <>
          <Group title="她" />
          <p className="vn-set-note ig-pad">先选一张角色卡。</p>
        </>
      ) : (
        <>
          <Group
            tip={IG_TIPS.her}
            title={
              <span className="ig-card-only">
                她 · {store.cardName} <span className="ig-card-tag">这张卡</span>
                <Tip k="card_only" />
              </span>
            }
          />
          <Row label="角色名" tip={IG_TIPS.name_tag}>
            <input className="ig-input" value={prefs.nameTag} onChange={(e) => changePrefs({ ...prefs, nameTag: e.target.value })} />
          </Row>
          <Row label="长相" tip={IG_TIPS.look}>
            <textarea
              className="ig-input"
              rows={3}
              value={prefs.look}
              placeholder="adult, long black hair, ponytail, brown eyes"
              onChange={(e) => changePrefs({ ...prefs, look: e.target.value })}
            />
            <div className="ig-inline">
              <button className="vn-pill" onClick={() => void store.askLook()}>
                让指导模型读卡写一版
              </button>
            </div>
          </Row>
          <Row label="平时穿的">
            <textarea
              className="ig-input"
              rows={2}
              value={prefs.outfit}
              placeholder="white shirt, navy long skirt"
              onChange={(e) => changePrefs({ ...prefs, outfit: e.target.value })}
            />
          </Row>
          <Row label="性别">
            <Seg options={GENDERS} value={prefs.gender} onPick={(v) => changePrefs({ ...prefs, gender: v })} />
          </Row>
          <Row label="画师串" tip={IG_TIPS.card_artists}>
            <input className="ig-input" value={config.artists} onChange={(e) => set({ ...config, artists: e.target.value })} />
          </Row>
          {store.conn?.kind !== 'sdapi' && <ReferenceRows store={store} />}
          <Row label="不想画出来的">
            <input className="ig-input" value={prefs.negative} onChange={(e) => changePrefs({ ...prefs, negative: e.target.value })} />
          </Row>
          <Row label="全年龄">
            <Toggle checked={prefs.sfwOnly} onChange={(v) => changePrefs({ ...prefs, sfwOnly: v })}>
              这张卡只画全年龄(挡掉成人向的标签;NovelAI 换成 Curated 模型)
            </Toggle>
          </Row>
        </>
      )}

      <Group title="你(玩家)" tip={IG_TIPS.player} />
      <Row label="样子">
        <input className="ig-input" value={player.look} onChange={(e) => setPlayer({ look: e.target.value })} />
      </Row>
      <Row label="平时穿的" tip={IG_TIPS.player_outfit}>
        <input className="ig-input" value={player.outfit} onChange={(e) => setPlayer({ outfit: e.target.value })} />
      </Row>
      <Row label="性别">
        <Seg options={GENDERS} value={player.gender} onPick={(v) => setPlayer({ gender: v })} />
      </Row>
      <Row label="不想画出来的">
        <div className="ig-inline">
          <input className="ig-input ig-grow" value={player.negative} onChange={(e) => setPlayer({ negative: e.target.value })} />
          {(player.look !== DEFAULT_PLAYER.look || player.outfit !== DEFAULT_PLAYER.outfit || player.negative !== DEFAULT_PLAYER.negative) && (
            <button className="vn-pill" onClick={() => set({ ...config, player: DEFAULT_PLAYER })}>
              恢复默认
            </button>
          )}
        </div>
      </Row>
    </div>
  );
}

// ── 自动出图 ──

/** 导演什么时候出图(和后端说明书 SKILL_AUTO 的「值得出」对应) */
const AUTO_WHEN = ['第一次到某地', '身体接触', '强烈情绪', '换衣服'];
AUTO_WHEN.push('你说想看');

function AutoPage({ store }: { store: ImageGenStore }) {
  const { config, changeConfig: set } = store;
  return (
    <div className="vn-set-list">
      <Group
        title="自动出图"
        tip={`${IG_TIPS.auto}${AUTO_WHEN.join('、')}`}
      />
      <Row label="自动出图">
        <Seg
          options={[
            { value: true, name: '开' },
            { value: false, name: '关' },
          ]}
          value={config.auto.enabled}
          onPick={(v) => set({ ...config, auto: { ...config.auto, enabled: v } })}
        />
      </Row>
      <Row label="至少隔几条" value={config.auto.cooldown === 0 ? '不隔' : `${config.auto.cooldown} 条`} tip={IG_TIPS.cooldown}>
        <input
          type="range"
          min={0}
          max={20}
          value={config.auto.cooldown}
          aria-label="出过图以后至少隔几条回复"
          onChange={(e) => set({ ...config, auto: { ...config.auto, cooldown: Number(e.target.value) } })}
        />
      </Row>
      <Para text={IG_TIPS.cooldown} />
    </div>
  );
}

// ── 高级 ──

function SkillRow({
  label,
  tip,
  value,
  fallback,
  onChange,
}: {
  label: string;
  tip?: string;
  value: string | null;
  fallback: string | undefined;
  onChange: (v: string | null) => void;
}) {
  return (
    <Row label={label} tip={tip}>
      <textarea
        className="ig-input"
        rows={10}
        value={value ?? fallback ?? ''}
        onChange={(e) => onChange(e.target.value === fallback ? null : e.target.value)}
      />
      {value !== null && (
        <div className="ig-inline">
          <button className="vn-pill" onClick={() => onChange(null)}>
            恢复默认
          </button>
        </div>
      )}
    </Row>
  );
}

// 质量词、反向预设 10-12 照 NovelAI 网页挪到「画面」里了
function AdvancedPage({ store }: { store: ImageGenStore }) {
  const { config, changeConfig: set, defaults } = store;
  // 说明书是这张卡在每条连接下各存一份的(设计第 9 节):没选连接时没地方存
  if (!store.conn) {
    return (
      <div className="vn-set-list">
        <Group title="说明书" tip={IG_TIPS.manual} />
        <p className="vn-set-note ig-pad">先在「画面」里选画图连接。</p>
      </div>
    );
  }
  return (
    <div className="vn-set-list">
      <Group title="说明书" tip={IG_TIPS.manual} />
      <SkillRow
        label="画这一幕"
        value={config.skills.manual}
        fallback={defaults?.skills.manual}
        onChange={(v) => set({ ...config, skills: { ...config.skills, manual: v } })}
      />
      <SkillRow
        label="自动出图"
        value={config.skills.auto}
        fallback={defaults?.skills.auto}
        onChange={(v) => set({ ...config, skills: { ...config.skills, auto: v } })}
      />
      <SkillRow
        label="状态笔记"
        tip={IG_TIPS.note}
        value={config.skills.note}
        fallback={defaults?.skills.note}
        onChange={(v) => set({ ...config, skills: { ...config.skills, note: v } })}
      />
    </div>
  );
}

// ── 相册 ──

/** 相册和卡编辑器的「AI 生成」那一栏是同一份(useImageGen 的 album):这边收藏、删除,那边跟着变 */
function AlbumPage({ store }: { store: ImageGenStore }) {
  const { cardId, album: images, albumError: error, reloadAlbum } = store;
  // 打开这一页时重读一次(别的设备上刚画的)
  useEffect(() => {
    void reloadAlbum();
  }, [reloadAlbum]);
  return (
    <div className="vn-set-list">
      <Group
        title={store.cardId ? `${store.cardName} 画过的图` : '画过的图'}
        tip={IG_TIPS.album}
      />
      {!cardId ? (
        <p className="vn-set-note ig-pad">先选一张角色卡。</p>
      ) : error ? (
        <p className="vn-set-error">{error}</p>
      ) : images === null ? (
        <p className="vn-set-note ig-pad">读取中…</p>
      ) : images.length === 0 ? (
        <p className="vn-set-note ig-pad">这张卡还没画过图。</p>
      ) : (
        <div className="ig-album">
          {images.map((img) => (
            <div key={img.id} className="ig-album-item">
              {img.sha && (
                <a href={apiUrl(`/api/blobs/${img.sha}`)} target="_blank" rel="noreferrer" title="看原图">
                  <img src={apiUrl(`/api/blobs/${img.sha}?w=320`)} alt="" loading="lazy" />
                </a>
              )}
              <span className="ig-album-desc" title={img.description}>
                {img.title ? `${img.title} · ` : ''}
                {img.description || '(没有说明)'}
              </span>
              <span className="vn-set-note">
                {[
                  new Date(img.created_at).toLocaleString(),
                  img.trigger === 'auto' ? '自动' : img.trigger === 'reroll' ? '换一张' : '手动',
                  connectionText(img.params),
                  timingText(img.params.timing),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <div className="ig-album-actions">
                <button className="vn-pill" disabled={Boolean(img.kept_asset_id)} onClick={() => void store.keep(img.id)}>
                  {img.kept_asset_id ? '已收藏' : '收藏'}
                </button>
                <button className="vn-pill" onClick={() => void store.removeImage(img.id)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ImageGenSettings({ store, place }: { store: ImageGenStore; place: 'game' | 'console' }) {
  const [page, setPageState] = useState<Page>(lastPage);
  const [dialog, setDialog] = useState<Dialog>(null);
  const setPage = (p: Page) => {
    lastPage = p;
    setPageState(p);
  };
  const needCard = !store.cardId && !NO_CARD_OK.has(page);
  // 小窗用纸卡:游戏设置页跟外面的主题(变量往下传);调试台是深色底,用夜纸
  const dialogPaper = place === 'game' ? 'av-pcard' : 'av-pcard av-night';
  return (
    <ConsoleTips.Provider value={place === 'console'}>
      <div className={`ig-settings ${place}`}>
        {place === 'console' && (
          <div className="ig-settings-head">
            <span className="ig-settings-title">
              AI 生图 <span className="vn-beta">BETA</span>
            </span>
            <span className="vn-set-note">游戏里「菜单 → 设置 → AI 生图」是同一套</span>
          </div>
        )}
        {place === 'game' && (
          <p className="st-note ig-intro">
            点对话框里发送右边的画笔,指导模型读剧情写这一幕画什么,这张卡选的画图连接画出来,在那一句像 CG 一样淡入;右键画笔先设置再画。
          </p>
        )}
        {store.cardId && (
          <p className="vn-set-note ig-this-card">
            <span className="ig-card-tag">这张卡 · {store.cardName}</span>
            <Tip text={IG_TIPS.this_card} />
          </p>
        )}
        <div className={place === 'game' ? 'vn-sp-tabs ig-subtabs-paper' : 'ig-subtabs'} role="tablist">
          {PAGES.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={page === p.key}
              className={place === 'game' ? (page === p.key ? 'on' : '') : `ig-subtab${page === p.key ? ' active' : ''}`}
              onClick={() => setPage(p.key)}
            >
              {place === 'game' ? <span className="zh">{p.name}</span> : p.name}
            </button>
          ))}
        </div>
        {needCard ? (
          <p className="vn-set-note ig-pad">先选一张角色卡。</p>
        ) : (
          <>
            {page === 'picture' && (
              <PicturePage
                store={store}
                go={setPage}
                onAdd={() => setDialog({ kind: 'add' })}
                onTrial={(connId) => setDialog({ kind: 'trial', connId })}
              />
            )}
            {page === 'cast' && <CastPage store={store} />}
            {page === 'auto' && <AutoPage store={store} />}
            {page === 'conn' && <ConnPage store={store} onAdd={() => setDialog({ kind: 'add' })} />}
            {page === 'advanced' && <AdvancedPage store={store} />}
            {page === 'album' && <AlbumPage store={store} />}
          </>
        )}
        {dialog?.kind === 'add' && (
          <AddConnDialog
            store={store}
            paperClass={dialogPaper}
            onClose={() => setDialog(null)}
            onTrial={(connId) => setDialog({ kind: 'trial', connId })}
          />
        )}
        {dialog?.kind === 'trial' && (
          <TrialDialog store={store} connId={dialog.connId} paperClass={dialogPaper} onClose={() => setDialog(null)} />
        )}
      </div>
    </ConsoleTips.Provider>
  );
}
