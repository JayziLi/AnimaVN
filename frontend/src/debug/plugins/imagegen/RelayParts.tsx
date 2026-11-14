/**
 * 中转站连接才有的几项(设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 2、6 节):
 * 画面页的模型(下拉来自 /v1/models,也能手填),连接页的接口、可用尺寸、额外参数
 */

import { useCallback, useEffect, useState } from 'react';
import { Tip } from '../../components/drawer/Tip';
import { ModelSelect } from '../../vn/ModelWindow';
import { imagegenApi, type ImageConn } from './api';
import { extraError, RELAY_APIS, relaySizes, type RelayApi } from './connModel';
import { IG_TIPS } from './tips';
import { Seg } from './ui';
import type { ImageGenStore } from './useImageGen';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 画面页的模型:站点列得出来就下拉,列不出来或者想用列表外的就手填 */
export function RelayModelPick({
  connId,
  model,
  onModel,
}: {
  connId: string;
  model: string;
  onModel: (m: string) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await imagegenApi.connectionOptions(connId);
      setModels(r.models ?? []);
    } catch (e) {
      setModels([]);
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [connId]);
  useEffect(() => {
    void load();
  }, [load]);

  const commit = () => {
    const v = typed.trim();
    if (v && v !== model) onModel(v);
    setTyping(false);
  };

  return (
    <>
      <div className="ig-inline">
        {typing ? (
          <input
            className="ig-input ig-grow"
            autoFocus
            value={typed}
            aria-label="手填模型名"
            placeholder="模型名,比如 gpt-image-2"
            onChange={(e) => setTyped(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
            }}
          />
        ) : (
          <ModelSelect models={models} model={model} refreshing={busy} refreshedAt={null} onModel={onModel} onRefresh={() => void load()} />
        )}
        {!typing && (
          <button
            type="button"
            className="vn-pill"
            onClick={() => {
              setTyped(model);
              setTyping(true);
            }}
          >
            手填
          </button>
        )}
      </div>
      {error && <span className="vn-set-error ig-raw">{error}</span>}
    </>
  );
}

/** 连接页展开后的三项:改完就存(换接口时把「试出来的接口」清掉,重新试) */
export function RelayFields({ store, conn }: { store: ImageGenStore; conn: ImageConn }) {
  const api = (typeof conn.options.api === 'string' ? conn.options.api : 'auto') as RelayApi;
  const [sizes, setSizes] = useState(relaySizes(conn));
  const [extra, setExtra] = useState(typeof conn.options.extra === 'string' ? conn.options.extra : '');
  const [error, setError] = useState<string | null>(null);

  const save = async (options: Record<string, unknown>) => {
    setError(null);
    try {
      await store.updateConn(conn.id, { options });
    } catch (e) {
      setError(errText(e));
    }
  };
  const pickApi = (v: RelayApi) => {
    if (v === api) return;
    const rest = { ...conn.options };
    delete rest.resolved;
    void save({ ...rest, api: v });
  };
  const saveSizes = () => {
    if (sizes !== relaySizes(conn)) void save({ ...conn.options, sizes: sizes.trim() });
  };
  const saveExtra = () => {
    const v = extra.trim();
    const bad = extraError(v);
    if (bad) return setError(bad);
    setError(null);
    if (v !== (conn.options.extra ?? '')) void save({ ...conn.options, extra: v });
  };

  return (
    <>
      <div className="ig-field ig-span">
        <span>
          接口
          <Tip text={IG_TIPS.relay_api} />
        </span>
        <Seg options={RELAY_APIS} value={api} onPick={pickApi} />
      </div>
      <label className="ig-field ig-span">
        <span>
          可用尺寸
          <Tip text={IG_TIPS.relay_sizes} />
        </span>
        <input className="ig-input" value={sizes} placeholder="留空 = 按画面页的尺寸原样发" onChange={(e) => setSizes(e.target.value)} onBlur={saveSizes} />
      </label>
      <label className="ig-field ig-span">
        <span>
          额外参数
          <Tip text={IG_TIPS.relay_extra} />
        </span>
        <textarea className="ig-input" rows={2} value={extra} placeholder='{"quality": "low"}' onChange={(e) => setExtra(e.target.value)} onBlur={saveExtra} />
      </label>
      {error && <p className="vn-set-error ig-raw ig-span">{error}</p>}
    </>
  );
}
