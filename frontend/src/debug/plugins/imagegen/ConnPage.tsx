/**
 * 生图设置的「连接」页(11-07 由「服务」页改名,效果图 1,设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 11 节):
 * - 画图连接一行一条(小字「类型 · 地址」),右边查连接、下面一行结果;点一条就地展开,改名字、地址、key,删(点两下)
 * - 「加一条连接」弹小窗(dialogs.tsx 的 AddConnDialog,开在 ImageGenSettings 里)
 * - 下面是指导模型那一组(10-31 起照主模型窗口那样选,按卡存)
 * 连接是全局的,没选卡也能改。NovelAI 的「查连接」就是查额度(同一个 /user/subscription),只放「查额度」
 */

import { useEffect, useState } from 'react';
import { Tip } from '../../components/drawer/Tip';
import { ConnectionCards, ModelSelect } from '../../vn/ModelWindow';
import type { ImageConn } from './api';
import { accountText, addressText, checkText, connPatch, keyHint, KIND_FIELDS, KIND_NAMES, urlChanged } from './connModel';
import { RelayFields } from './RelayParts';
import { IG_TIPS } from './tips';
import { DeleteTwice, Group, Row, Seg } from './ui';
import type { ImageGenStore } from './useImageGen';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const iconOf = (name: string) => name.replace(/[（(].*$/, '').trim().slice(0, 2).toUpperCase() || '?';

/** 展开的那一块:名字(离开输入框就存)、地址和 key(改了才有「保存」「不改了」)、删除 */
function ConnEdit({
  store,
  conn,
  onClose,
  onSaved,
}: {
  store: ImageGenStore;
  conn: ImageConn;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fields = KIND_FIELDS[conn.kind];
  const novelai = conn.kind === 'novelai';
  const [name, setName] = useState(conn.name);
  const [url, setUrl] = useState(conn.base_url ?? '');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const used = store.usage[conn.id] ?? 0;
  const usedTag = used > 0 ? <span className="ig-card-tag">{used} 张卡在用</span> : null;
  const patch = connPatch(conn, url, key);

  const saveName = async () => {
    const v = name.trim();
    if (!v) {
      setName(conn.name);
      return;
    }
    if (v === conn.name) return;
    try {
      await store.updateConn(conn.id, { name: v });
    } catch (e) {
      setError(errText(e));
    }
  };
  const save = async () => {
    if (!patch) return;
    setBusy(true);
    setError(null);
    try {
      await store.updateConn(conn.id, patch);
      setKey('');
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ig-cc-edit">
      <div className="ig-fgrid">
        <label className="ig-field">
          <span>名字</span>
          <input
            className="ig-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveName();
            }}
          />
        </label>
        {fields.url && (
          <div className="ig-field">
            <span className={urlChanged(conn, url) ? 'ig-changed' : undefined}>
              地址
              {conn.kind === 'sdapi' && <Tip text={IG_TIPS.sd_url} />}
              {usedTag}
            </span>
            <input
              className="ig-input"
              value={url}
              placeholder={fields.urlPlaceholder}
              aria-label="地址"
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        )}
        <div className={`ig-field${fields.url ? ' ig-span' : ''}`}>
          <span>
            {fields.key}
            {novelai && <Tip text={IG_TIPS.token} />}
            {!fields.url && usedTag}
          </span>
          <input
            className="ig-input"
            type="password"
            autoComplete="off"
            aria-label={fields.key}
            value={key}
            placeholder={keyHint(conn, url)}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        {conn.kind === 'openai' && <RelayFields store={store} conn={conn} />}
      </div>
      {error && <p className="vn-set-error ig-raw">{error}</p>}
      <div className="ig-cc-actions">
        {patch && (
          <>
            <button type="button" className="vn-pill accent" disabled={busy} onClick={() => void save()}>
              保存
            </button>
            <button
              type="button"
              className="vn-pill"
              disabled={busy}
              onClick={() => {
                setUrl(conn.base_url ?? '');
                setKey('');
                setError(null);
              }}
            >
              不改了
            </button>
          </>
        )}
        <span className="ig-push">
          <DeleteTwice onConfirm={() => void store.deleteConn(conn.id).then(onClose, (e: unknown) => setError(errText(e)))} />
        </span>
      </div>
    </div>
  );
}

/** 一条连接:点头上展开 / 收起;右边查连接(NovelAI 是查额度),结果留在下面一行,收起了也看得到 */
function ConnCard({
  store,
  conn,
  open,
  onToggle,
}: {
  store: ImageGenStore;
  conn: ImageConn;
  open: boolean;
  onToggle: () => void;
}) {
  const novelai = conn.kind === 'novelai';
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ ok: boolean; text: string } | null>(null);
  const account = store.accounts[conn.id];
  const accountError = store.accountErrors[conn.id];
  const status = novelai
    ? accountError
      ? { ok: false, text: accountError }
      : account
        ? { ok: true, text: accountText(account) }
        : null
    : checked;

  const check = async () => {
    setChecking(true);
    try {
      if (novelai) {
        await store.checkAccount(conn.id);
      } else {
        const r = await store.checkConn(conn.id);
        setChecked({ ok: r.ok, text: checkText(r) });
      }
    } catch (e) {
      setChecked({ ok: false, text: errText(e) });
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className={`ig-cc${open ? ' on' : ''}`}>
      <button type="button" className="ig-cc-h" aria-expanded={open} onClick={onToggle}>
        <span className="ig-cc-ic" aria-hidden="true">
          {iconOf(conn.name)}
        </span>
        <span className="ig-cc-tx">
          <b>
            {conn.name}
            {store.conn?.id === conn.id && <span className="ig-card-tag">{store.cardName} 在用</span>}
          </b>
          <small>
            {KIND_NAMES[conn.kind]} · {addressText(conn)}
          </small>
        </span>
      </button>
      <button type="button" className="vn-pill ig-x" disabled={checking} onClick={() => void check()}>
        {novelai ? '查额度' : '查连接'}
      </button>
      {checking ? (
        <div className="ig-cc-st">
          <span className="ig-cc-msg">查询中…</span>
        </div>
      ) : (
        status && (
          <div className={`ig-cc-st ${status.ok ? 'good' : 'bad'}`}>
            <i className="ig-cc-dot" />
            <span className="ig-cc-msg">{status.text}</span>
          </div>
        )
      )}
      {open && (
        <ConnEdit
          store={store}
          conn={conn}
          onClose={onToggle}
          // 地址、key 改了:上次查的结果不算数了。NovelAI 换了 token 马上重查一次额度(不花钱)
          onSaved={() => {
            setChecked(null);
            if (novelai) void store.checkAccount(conn.id);
          }}
        />
      )}
    </div>
  );
}

const API_TYPE_LABEL: Record<string, string> = { openai_compatible: 'OpenAI 兼容', anthropic: 'Anthropic', mock: 'Mock' };

/** 指导模型用哪条连接、哪个模型:和主模型窗口同一套(连接卡片 + 模型下拉 + 重新拉取),改的模型就是连接上存的那个 */
function WriterRows({ store }: { store: ImageGenStore }) {
  const { config, changeConfig: set } = store;
  const missing = config.writer.connectionId !== null && !store.connections.some((c) => c.id === config.writer.connectionId);
  const chosen = store.connections.find((c) => c.id === config.writer.connectionId) ?? null;
  const chat = store.connections.find((c) => c.is_active) ?? null;
  const target = chosen ?? chat;
  // 先乐观显示刚选的,DebugApp 重读完连接再换成存下来的
  const [picked, setPicked] = useState<{ id: string; model: string } | null>(null);
  const model = picked && picked.id === target?.id ? picked.model : (target?.model ?? '');
  const cards = [
    {
      id: '',
      name: '跟聊天用同一个',
      type: chat ? `现在是 ${chat.name}` : '',
      model: chat?.model ?? '',
      active: chosen === null,
    },
    ...store.connections.map((c) => ({
      id: c.id,
      name: c.name,
      type: API_TYPE_LABEL[c.api_type] ?? c.api_type,
      model: c.model,
      active: c.id === chosen?.id,
    })),
  ];
  return (
    <>
      <Row label="连接" note={missing ? '选的连接不在了,现在跟聊天用同一个' : undefined}>
        <div className="ig-writer-conns">
          <ConnectionCards
            connections={cards}
            now="画图在用"
            onPick={(id) => set({ ...config, writer: { ...config.writer, connectionId: id || null } })}
          />
        </div>
      </Row>
      {target && target.api_type !== 'mock' && (
        <Row label="模型" tip={IG_TIPS.writerModel}>
          <ModelSelect
            models={target.cached_models}
            model={model}
            refreshing={store.modelsRefreshing}
            refreshedAt={target.cached_models_at}
            onModel={(m) => {
              setPicked({ id: target.id, model: m });
              void store.setConnectionModel(target.id, m);
            }}
            onRefresh={() => void store.refreshModels(target.id)}
          />
        </Row>
      )}
    </>
  );
}

export function ConnPage({ store, onAdd }: { store: ImageGenStore; onAdd: () => void }) {
  const { config, changeConfig: set, imageConns: conns, reloadConns } = store;
  const [open, setOpen] = useState<string | null>(null);
  // 打开这一页时重读一次(「几张卡在用」可能变了)
  useEffect(() => {
    void reloadConns();
  }, [reloadConns]);
  return (
    <div className="vn-set-list">
      <Group title="画图连接" en="Connections" tip={IG_TIPS.conns} />
      {conns === null ? (
        <p className="vn-set-note ig-pad">读取中…</p>
      ) : (
        <div className="ig-conns">
          {conns.map((c) => (
            <ConnCard key={c.id} store={store} conn={c} open={c.id === open} onToggle={() => setOpen(c.id === open ? null : c.id)} />
          ))}
          <button type="button" className="ig-cc-new" onClick={onAdd}>
            <b>+</b> 加一条连接
          </button>
        </div>
      )}

      <Group title="指导模型" en="Writer" tip={IG_TIPS.writer} />
      {store.cardId ? (
        <>
          <WriterRows store={store} />
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
        </>
      ) : (
        <p className="vn-set-note ig-pad">指导模型按卡存:先选一张角色卡。</p>
      )}
    </div>
  );
}
