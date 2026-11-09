/**
 * 本地 SD 连接才有的几项(设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 5、11 节,效果图 3、5):
 * 画面页的模型、采样器 / 调度器、LoRA 一排小标签;「画这一幕」里同一排 LoRA 开关。
 * 下拉的内容来自这条连接的 /options,拿不到的项不显示;LoRA 拿不到列表时手填文件名
 */

import { useState } from 'react';
import type { ImageGenConfig } from './config';
import { modelOf, sdSampler } from './connModel';
import {
  addLora,
  LORA_MAX,
  LORA_WEIGHT,
  loraChoices,
  loraNames,
  loraTag,
  loraWeightText,
  patchLora,
  removeLora,
  toggleLora,
  type LoraPick,
} from './loras';
import { IG_TIPS } from './tips';
import { Row } from './ui';
import type { SdOptions } from './useSdOptions';

/** 模型:第一项用服务现在加载的(不发模型名);列表拿不到就不显示这一行 */
export function SdModelRow({ config, onChange, sd }: { config: ImageGenConfig; onChange: (next: ImageGenConfig) => void; sd: SdOptions }) {
  const models = sd.options?.models;
  if (!models) return null;
  const value = modelOf('sdapi', config.model);
  return (
    <Row label="模型" en="Model">
      <div className="ig-inline">
        <select className="vn-set-select ig-grow" aria-label="模型" value={value} onChange={(e) => onChange({ ...config, model: e.target.value })}>
          <option value="">用服务现在加载的</option>
          {value && !models.includes(value) && <option value={value}>{value}(不在列表里)</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="button" className="vn-pill" disabled={sd.busy} onClick={() => void sd.reload()}>
          {sd.busy ? '拉取中…' : '重新拉取'}
        </button>
      </div>
    </Row>
  );
}

/** 「更多」里的采样器、调度器:第一项服务默认,列表拿不到就隐藏对应行 */
export function SdSamplerRows({ config, onChange, sd }: { config: ImageGenConfig; onChange: (next: ImageGenConfig) => void; sd: SdOptions }) {
  const samplers = sd.options?.samplers;
  const schedulers = sd.options?.schedulers;
  const sampler = sdSampler(config.sampler);
  return (
    <>
      {samplers && (
        <Row label="采样器" en="Sampler">
          <select className="vn-set-select" aria-label="采样器" value={sampler} onChange={(e) => onChange({ ...config, sampler: e.target.value })}>
            <option value="">服务默认</option>
            {sampler && !samplers.includes(sampler) && <option value={sampler}>{sampler}</option>}
            {samplers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Row>
      )}
      {schedulers && (
        <Row label="调度器" en="Schedule Type">
          <select className="vn-set-select" aria-label="调度器" value={config.scheduler} onChange={(e) => onChange({ ...config, scheduler: e.target.value })}>
            <option value="">服务默认</option>
            {config.scheduler && !schedulers.includes(config.scheduler) && <option value={config.scheduler}>{config.scheduler}</option>}
            {schedulers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Row>
      )}
    </>
  );
}

/** 小标签的样子:名字 · 权重 + 开着的实心点 */
function ChipFace({ lora }: { lora: LoraPick }) {
  return (
    <>
      <span className="ig-lora-name">{lora.name}</span>
      <span className="ig-lora-w">· {loraWeightText(lora.weight)}</span>
      <i aria-hidden="true" />
    </>
  );
}

/** 调一个 LoRA:权重、触发词、删掉 */
function LoraEditBox({
  lora,
  onPatch,
  onRemove,
}: {
  lora: LoraPick;
  onPatch: (patch: Partial<Pick<LoraPick, 'weight' | 'trigger'>>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="ig-lora-box">
      <div className="ig-lora-line">
        <span className="ig-lora-k">权重</span>
        <input
          type="range"
          className="ig-grow"
          min={LORA_WEIGHT.min}
          max={LORA_WEIGHT.max}
          step={LORA_WEIGHT.step}
          value={lora.weight}
          aria-label={`${lora.name} 的权重`}
          onChange={(e) => onPatch({ weight: Number(e.target.value) })}
        />
        <span className="ig-lora-v">{loraWeightText(lora.weight)}</span>
      </div>
      <div className="ig-lora-line">
        <span className="ig-lora-k">触发词</span>
        <input className="ig-input ig-grow" value={lora.trigger} placeholder="没有就空着" aria-label={`${lora.name} 的触发词`} onChange={(e) => onPatch({ trigger: e.target.value })} />
      </div>
      <div className="ig-lora-line ig-lora-end">
        <button type="button" className="vn-pill" onClick={onRemove}>
          删掉
        </button>
      </div>
    </div>
  );
}

/** 「+」打开的那块:有列表就搜着选(LoRA 可能几十个),拿不到列表手填文件名;「刷新」先让服务重新扫一遍 */
function LoraAddBox({ picked, names, sd, onAdd }: { picked: readonly LoraPick[]; names: string[] | null; sd: SdOptions; onAdd: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const choices = names ? loraChoices(names, picked, query) : [];
  const commit = () => {
    if (!typed.trim()) return;
    onAdd(typed);
    setTyped('');
  };
  return (
    <div className="ig-lora-box">
      {names ? (
        <>
          <div className="ig-lora-line">
            <input className="ig-input ig-grow" value={query} placeholder={`搜 ${names.length} 个 LoRA`} aria-label="搜 LoRA" onChange={(e) => setQuery(e.target.value)} />
            <button type="button" className="vn-pill" disabled={sd.busy} onClick={() => void sd.refreshLoras()}>
              {sd.busy ? '刷新中…' : '刷新'}
            </button>
          </div>
          <div className="ig-lora-list">
            {choices.length === 0 ? (
              <span className="vn-set-note">{names.length === 0 ? '这个服务上没有 LoRA' : '没有了'}</span>
            ) : (
              choices.map((n) => (
                <button type="button" key={n} onClick={() => onAdd(n)}>
                  {n}
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="ig-lora-line">
          <input
            className="ig-input ig-grow"
            value={typed}
            placeholder="LoRA 文件名(不带扩展名)"
            aria-label="LoRA 文件名"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
            }}
          />
          <button type="button" className="vn-pill accent" disabled={!typed.trim()} onClick={commit}>
            加上
          </button>
          <button type="button" className="vn-pill" disabled={sd.busy} onClick={() => void sd.reload()}>
            {sd.busy ? '拉取中…' : '重新拉取'}
          </button>
        </div>
      )}
      {sd.error && <p className="vn-set-error ig-raw">{sd.error}</p>}
    </div>
  );
}

/** 画面页的 LoRA:一排小标签,点一下开关,「⋯」调权重、填触发词、删掉,最后的「+」加一个。改的是这张卡在这条连接下的设置 */
export function LoraRow({ config, onChange, sd }: { config: ImageGenConfig; onChange: (next: ImageGenConfig) => void; sd: SdOptions }) {
  const [open, setOpen] = useState<{ what: 'edit'; name: string } | { what: 'add' } | null>(null);
  const loras = config.loras;
  const set = (next: LoraPick[]) => onChange({ ...config, loras: next });
  const editing = open?.what === 'edit' ? (loras.find((l) => l.name === open.name) ?? null) : null;
  return (
    <Row label="LoRA" tip={IG_TIPS.lora}>
      <div className="ig-loras">
        {loras.map((l) => (
          <span key={l.name} className={`ig-lora${l.on ? ' on' : ''}`}>
            <button type="button" className="ig-lora-main" aria-pressed={l.on} title={loraTag(l)} onClick={() => set(toggleLora(loras, l.name))}>
              <ChipFace lora={l} />
            </button>
            <button
              type="button"
              className="ig-lora-more"
              aria-label={`调 ${l.name}`}
              aria-expanded={editing?.name === l.name}
              onClick={() => setOpen(editing?.name === l.name ? null : { what: 'edit', name: l.name })}
            >
              ⋯
            </button>
          </span>
        ))}
        {loras.length < LORA_MAX && (
          <button
            type="button"
            className="ig-lora-add"
            aria-label="加一个 LoRA"
            aria-expanded={open?.what === 'add'}
            onClick={() => setOpen(open?.what === 'add' ? null : { what: 'add' })}
          >
            +
          </button>
        )}
      </div>
      {editing && (
        <LoraEditBox
          lora={editing}
          onPatch={(patch) => set(patchLora(loras, editing.name, patch))}
          onRemove={() => {
            set(removeLora(loras, editing.name));
            setOpen(null);
          }}
        />
      )}
      {open?.what === 'add' && (
        <LoraAddBox
          picked={loras}
          names={loraNames(sd.options?.loras)}
          sd={sd}
          onAdd={(name) => {
            set(addLora(loras, name));
            setOpen(null);
          }}
        />
      )}
    </Row>
  );
}

/** 「画这一幕」里那一排:只开关,不增删,和画面页是同一份 */
export function LoraToggles({ config, onChange }: { config: ImageGenConfig; onChange: (next: ImageGenConfig) => void }) {
  return (
    <div className="ig-loras sm">
      {config.loras.map((l) => (
        <span key={l.name} className={`ig-lora${l.on ? ' on' : ''}`}>
          <button
            type="button"
            className="ig-lora-main"
            aria-pressed={l.on}
            title={loraTag(l)}
            onClick={() => onChange({ ...config, loras: toggleLora(config.loras, l.name) })}
          >
            <ChipFace lora={l} />
          </button>
        </span>
      ))}
    </div>
  );
}
