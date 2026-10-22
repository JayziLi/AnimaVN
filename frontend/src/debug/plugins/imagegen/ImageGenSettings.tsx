/**
 * 生图的全部设置,像游戏设置那样分页(10-12 用户:「设置都在一面,像游戏那样分页设置」):
 * 画面 / 角色 / 自动出图 / 服务 / 高级 / 相册。
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
import { Group, Para, Row, Seg, Toggle } from './ui';
import type { ImageGenStore } from './useImageGen';

type Page = 'picture' | 'cast' | 'auto' | 'service' | 'advanced' | 'album';
const PAGES: readonly { key: Page; name: string }[] = [
  { key: 'picture', name: '画面' },
  { key: 'cast', name: '角色' },
  { key: 'auto', name: '自动出图' },
  { key: 'service', name: '服务' },
  { key: 'advanced', name: '高级' },
  { key: 'album', name: '相册' },
];
// 关掉再打开(游戏里换页、调试台换插件)回到上次那一页
let lastPage: Page = 'picture';

const GENDERS: readonly { value: Gender; name: string }[] = [
  { value: 'female', name: '女' },
  { value: 'male', name: '男' },
];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── 画面 ──

function StyleRows({ config, onChange }: { config: ImageGenConfig; onChange: (next: ImageGenConfig) => void }) {
  const style = config.styles.find((s) => s.id === config.styleId) ?? config.styles[0];
  const setStyle = (patch: Partial<ImageStyle>) =>
    onChange({ ...config, styles: config.styles.map((s) => (s.id === style.id ? { ...s, ...patch } : s)) });
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
    <>
      <Row label="用哪个画风">
        <div className="ig-inline">
          <select className="vn-set-select" value={style.id} onChange={(e) => onChange({ ...config, styleId: e.target.value })}>
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
            <button className="vn-pill" onClick={() => setStyle(builtin)}>
              恢复默认
            </button>
          )}
        </div>
      </Row>
      <Row label="名字">
        <input className="ig-input" value={style.name} onChange={(e) => setStyle({ name: e.target.value })} />
      </Row>
      <Row label="画风标签" tip={IG_TIPS.style_tags}>
        <textarea className="ig-input" rows={2} value={style.tags} onChange={(e) => setStyle({ tags: e.target.value })} />
      </Row>
      <Row label="画师串" tip={IG_TIPS.artists}>
        <input className="ig-input" value={style.artists} onChange={(e) => setStyle({ artists: e.target.value })} />
      </Row>
      <Row label="不想要的">
        <input className="ig-input" value={style.negative} onChange={(e) => setStyle({ negative: e.target.value })} />
      </Row>
    </>
  );
}

/** 摘要里太长的长相截一截 */
function short(text: string, n = 48) {
  const t = text.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 画面:照 NovelAI 网页的顺序排(模型 → 基础提示词 → 反向 → 角色提示词 → 参考图 → 图像设置),
 *  名字下面小字是网页上的叫法。两个人、参考图只放摘要,改在「角色」页(不放两份开关) */
function PicturePage({ store, go }: { store: ImageGenStore; go: (p: Page) => void }) {
  const { config, changeConfig: set, prefs, defaults, account } = store;
  const v5 = !supportsReference(config.model);
  const size = sizeOf(config, config.size, { width: window.innerWidth, height: window.innerHeight });
  // 账户查不到时按 Opus 算(免费范围、「允许扣 Anlas」也都是照 Opus 的)
  const opus = account ? account.tier === 3 : true;
  const cost = anlasCost({ model: config.model, w: size.w, h: size.h, steps: config.steps, opus });
  const withRef = Boolean(store.cardId) && usesReference(config, prefs);
  const total = cost + (withRef ? REFERENCE_ANLAS : 0);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !store.status?.has_token || account) return;
    asked.current = true;
    void store.checkAccount();
  }, [store, account]);

  // 只画全年龄的卡画的时候换成 Curated:预设原文照那个模型的显示
  const model = prefs.sfwOnly ? (SFW_MODEL[config.model] ?? config.model) : config.model;
  const qualityValue = qualityOptions(config.model).some((q) => q.value === config.quality) ? config.quality : 'standard';
  const qualities = defaults?.quality_presets[model];
  const qualityText = qualityValue === 'none' ? '' : (qualities?.[qualityValue] ?? qualities?.standard ?? '');
  const ucText = defaults?.uc_presets[model]?.[config.ucPreset] ?? '';
  const scaleDefault = defaultScale(config.model);
  const custom = config.res === 'custom';
  const setSide = (k: 'w' | 'h', v: number) => set({ ...config, custom: { ...config.custom, [k]: v } });
  const refText = v5
    ? 'V5 用不了参考图:画的时候用写的长相(要用就换 V4.5)'
    : !store.cardId
      ? '先选一张角色卡'
      : prefs.ref.kind === 'off'
        ? '不用'
        : `${prefs.ref.kind === 'upload' ? '上传的那张' : '立绘'} · ${prefs.ref.style ? '连画风一起参考' : '只参考人'} · 每张 ${REFERENCE_ANLAS} Anlas`;
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
    account ? `余额 ${account.anlas}` : store.accountError ? '没查到账户,按 Opus 算' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="vn-set-list">
      <Row
        label="模型"
        en="Model"
        tip={v5 ? IG_TIPS.model_v5 : IG_TIPS.model_v45}
      >
        <select className="vn-set-select" value={config.model} onChange={(e) => set({ ...config, model: e.target.value })}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Row>

      <Group title="基础提示词" en="Base Prompt" tip={IG_TIPS.base} />
      <StyleRows config={config} onChange={set} />
      <Row label="质量词" en="Quality Tags" note={qualityText ? `加在最后:${qualityText}` : '不加'}>
        <Seg options={qualityOptions(config.model)} value={qualityValue} onPick={(v) => set({ ...config, quality: v })} />
      </Row>

      <Group title="反向" en="Undesired Content" />
      <Row label="反向预设" en="UC Preset" note={ucText ? `加在最前:${ucText}` : '不加预设'}>
        <Seg options={UC_PRESETS} value={config.ucPreset} onPick={(v) => set({ ...config, ucPreset: v })} />
      </Row>
      <Row label="另外加的" tip={IG_TIPS.uc_extra}>
        <textarea className="ig-input" rows={2} value={config.uc} onChange={(e) => set({ ...config, uc: e.target.value })} />
      </Row>

      <Group title="角色提示词" en="Character Prompts" tip={IG_TIPS.char_prompts} />
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
      <Row
        label="镜头"
        tip={IG_TIPS.camera}
      >
        <Seg options={CAMERAS} value={config.camera} onPick={(v) => set({ ...config, camera: v })} />
      </Row>

      <Group title="参考图" en="Character Reference" />
      <Row label="她的参考图">
        <div className="ig-inline">
          <span className="ig-grow vn-set-note">{refText}</span>
          {store.cardId && !v5 && (
            <button className="vn-pill" onClick={() => go('cast')}>
              去「角色」改
            </button>
          )}
        </div>
      </Row>

      <Group title="图像设置" en="Image Settings" />
      <Row
        label="分辨率"
        en="Resolution"
        note={`现在这张:${size.w} × ${size.h}${custom ? '(自定义的宽高按方向对调,方的取同样面积)' : ''}`}
      >
        <div className="ig-inline">
          <select
            className="vn-set-select"
            value={config.res}
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
      {config.scale !== scaleDefault && (
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
      <details className="ig-more">
        <summary>更多</summary>
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
      </details>
      <div className={`ig-cost${total > 0 ? ' paid' : ''}`}>
        <span>
          画一张 <b>{total} Anlas</b>
        </span>
        <span className="vn-set-note">{costNote}</span>
      </div>
      {cost > 0 && opus && !config.allowPaid && (
        <p className="vn-set-error">超出免费范围要扣 Anlas:不在「服务」里打开「允许超出免费范围」就画不了。</p>
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
        tip={supportsReference(config.model) ? IG_TIPS.ref : IG_TIPS.ref_unsupported}
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
              placeholder="adult, pink hair, very long hair, side braid, purple eyes"
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
              placeholder="white off-shoulder blouse, lavender long skirt"
              onChange={(e) => changePrefs({ ...prefs, outfit: e.target.value })}
            />
          </Row>
          <Row label="性别">
            <Seg options={GENDERS} value={prefs.gender} onPick={(v) => changePrefs({ ...prefs, gender: v })} />
          </Row>
          <Row label="画风">
            <select
              className="vn-set-select"
              value={prefs.styleId ?? ''}
              onChange={(e) => changePrefs({ ...prefs, styleId: e.target.value || null })}
            >
              <option value="">跟「画面」里的</option>
              {config.styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="画师串" tip={IG_TIPS.card_artists}>
            <input className="ig-input" value={prefs.artists} onChange={(e) => changePrefs({ ...prefs, artists: e.target.value })} />
          </Row>
          <ReferenceRows store={store} />
          <Row label="不想画出来的">
            <input className="ig-input" value={prefs.negative} onChange={(e) => changePrefs({ ...prefs, negative: e.target.value })} />
          </Row>
          <Row label="全年龄">
            <Toggle checked={prefs.sfwOnly} onChange={(v) => changePrefs({ ...prefs, sfwOnly: v })}>
              这张卡只画全年龄(换成 Curated 模型、挡掉成人向的标签)
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
  const { config, changeConfig: set, prefs, changePrefs } = store;
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
      {store.cardId && (
        <Row label="这张卡">
          <Toggle checked={prefs.autoOff} onChange={(v) => changePrefs({ ...prefs, autoOff: v })}>
            {store.cardName} 不自动出图
          </Toggle>
          <Tip k="card_only" />
        </Row>
      )}
    </div>
  );
}

// ── 服务 ──

function ServicePage({ store }: { store: ImageGenStore }) {
  const { config, changeConfig: set } = store;
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(false);
  const { account, accountError: error } = store;
  const has = store.status?.has_token;
  const check = async () => {
    setChecking(true);
    await store.checkAccount();
    setChecking(false);
  };
  const writerMissing = config.writer.connectionId !== null && !store.connections.some((c) => c.id === config.writer.connectionId);
  return (
    <div className="vn-set-list">
      <Group title="NovelAI" tip={IG_TIPS.nai} />
      <Row label="Token" tip={IG_TIPS.token}>
        <div className="ig-inline">
          <input
            className="ig-input ig-grow"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={has ? (store.status?.source === 'env' ? '用的是环境变量 NOVELAI_TOKEN' : '已保存(留空保持不变)') : 'pst- 开头的那串'}
          />
          <button className="vn-pill accent" disabled={!token.trim()} onClick={() => void store.saveToken(token).then(() => setToken(''))}>
            保存
          </button>
          {has && store.status?.source === 'settings' && (
            <button className="vn-pill" onClick={() => void store.saveToken('')}>
              删除
            </button>
          )}
        </div>
      </Row>
      <Row label="额度">
        <div className="ig-inline">
          <button className="vn-pill" disabled={!has || checking} onClick={() => void check()}>
            {checking ? '查询中…' : '查额度'}
          </button>
          {account && (
            <span className="vn-set-note ig-account">
              {account.tier === 3 ? 'Opus' : `等级 ${account.tier ?? '?'}`} · Anlas {account.anlas}
              {account.v5_percent !== null && ` · V5 额度还剩 ${account.v5_percent}%`}
            </span>
          )}
        </div>
        {error && <span className="vn-set-error">{error}</span>}
      </Row>
      <Row label="扣费">
        <Toggle checked={config.allowPaid} onChange={(v) => set({ ...config, allowPaid: v })}>
          允许超出免费范围(每张扣 Anlas)
        </Toggle>
      </Row>

      <Group title="指导模型" tip={IG_TIPS.writer} />
      <Row label="用哪个连接" note={writerMissing ? '选的连接不在了,现在跟聊天用同一个' : undefined}>
        <select
          className="vn-set-select"
          value={config.writer.connectionId ?? ''}
          onChange={(e) => set({ ...config, writer: { ...config.writer, connectionId: e.target.value || null } })}
        >
          <option value="">跟聊天用同一个</option>
          {store.connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.model ? ` · ${c.model}` : ''}
            </option>
          ))}
        </select>
      </Row>
      <Row label="思考" tip={IG_TIPS.thinking}>
        <Seg
          options={[
            { value: 'off' as const, name: '关(推荐)' },
            { value: 'conn' as const, name: '照连接的设置' },
          ]}
          value={config.writer.thinking}
          onPick={(v) => set({ ...config, writer: { ...config.writer, thinking: v } })}
        />
      </Row>
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
                {new Date(img.created_at).toLocaleString()} · {img.trigger === 'auto' ? '自动' : img.trigger === 'reroll' ? '换一张' : '手动'}
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
  const setPage = (p: Page) => {
    lastPage = p;
    setPageState(p);
  };
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
          <p className="vn-set-note ig-intro">
            点对话框里发送右边的画笔,指导模型读剧情写这一幕画什么,NovelAI 画出来,在那一句像 CG 一样淡入;右键画笔先设置再画。
          </p>
        )}
        <div className="ig-subtabs" role="tablist">
          {PAGES.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={page === p.key}
              className={`ig-subtab${page === p.key ? ' active' : ''}`}
              onClick={() => setPage(p.key)}
            >
              {p.name}
            </button>
          ))}
        </div>
        {page === 'picture' && <PicturePage store={store} go={setPage} />}
        {page === 'cast' && <CastPage store={store} />}
        {page === 'auto' && <AutoPage store={store} />}
        {page === 'service' && <ServicePage store={store} />}
        {page === 'advanced' && <AdvancedPage store={store} />}
        {page === 'album' && <AlbumPage store={store} />}
      </div>
    </ConsoleTips.Provider>
  );
}
