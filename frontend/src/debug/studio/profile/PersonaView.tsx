import { useState } from 'react';
import { debugApi, type DebugPersona } from '../../lib/api';
import { avatarOf } from '../../lib/avatar';
import { forgetPersona, type PersonaBindings } from '../../lib/personaBinding';
import { Icon } from '../icons';
import { TERMS } from '../terms';
import type { Notify } from '../types';
import { Btn, Chip, FieldLabel, Inspector, Section, SwitchRow } from '../ui';
import { ArmedBtn } from './ArmedBtn';
import { useConfirm } from '../../vn/ui/confirm';

/**
 * 资料页 · 玩家人设(目录点「玩家人设」):主区是人设列表 + 选中那个的编辑,右栏是绑定和说明。
 * 逻辑照调试台的人设抽屉(PersonaDrawer):人设是全局一份清单,同一时刻只启用一个;
 * 点一行 = 启用它 + 装进下面的表单;名字、描述改完点「保存」;新建的直接启用。
 *
 * 列表用 DebugApp 手上那份(它拉、它刷新),增删改完叫 onRefresh 重拉 —— 和抽屉、组装用的是同一份。
 */

export interface PersonaPageProps {
  personas: readonly DebugPersona[];
  cardId: string;
  cardName: string;
  bindings: PersonaBindings;
  onChangeBindings: (next: PersonaBindings) => void;
  /** 改这张卡绑的人设:存下来并当场换过去(DebugApp 的 bindPersonaToCard) */
  onBindToCard: (personaId: string | null) => void;
  /** 增删改、启用完重拉列表(DebugApp 的 refreshPersonas,顺带把 {{user}} 和描述喂给组装) */
  onRefresh: () => Promise<void>;
  /** 换头像走 DebugApp 那套「选文件 → 裁剪 → 写回」 */
  onPickAvatar: (personaId: string) => void;
  /** 角色卡 id → 名字:列出一个人设绑了哪些卡 */
  cardNames: ReadonlyMap<string, string>;
  notify: Notify;
}

interface Form {
  /** 表单装的是哪个人设;新建时是 null */
  id: string | null;
  name: string;
  description: string;
}

const formOf = (p: DebugPersona | null): Form => ({
  id: p?.id ?? null,
  name: p?.name ?? '',
  description: p?.description ?? '',
});

export function PersonaView(props: PersonaPageProps) {
  const { personas, cardId, cardName, bindings, notify } = props;
  const [selId, setSelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = personas.find((p) => p.is_active) ?? null;
  // 选的那个没了(删掉了)就退回当前启用的,再没有就第一个
  const editing = creating ? null : (personas.find((p) => p.id === selId) ?? active ?? personas[0] ?? null);

  // 表单跟着「正在看哪个」走:换了人设就重新装(新建时不动)
  const [form, setForm] = useState<Form>(() => formOf(editing));
  if (!creating && (editing?.id ?? null) !== form.id) setForm(formOf(editing));

  const dirty = editing !== null && (form.name.trim() !== editing.name || form.description !== editing.description);
  const unsaved = dirty || (creating && (form.name.trim() !== '' || form.description.trim() !== ''));
  const confirm = useConfirm();
  const confirmDiscard = async () =>
    !unsaved ||
    (await confirm({
      title: '放弃这些改动?',
      body: '人设的改动还没保存',
      en: 'Unsaved',
      del: '放弃改动',
      keep: '继续改',
      message: '人设的改动还没保存,放弃这些改动?',
    }));

  const fail = (e: unknown) => notify('error', e instanceof Error ? e.message : String(e));

  /** 点一行 = 启用它 + 装进表单(选身份和看详情是同一个动作,和人设抽屉一样) */
  const pick = async (p: DebugPersona) => {
    if (p.id !== editing?.id) {
      if (!(await confirmDiscard())) return;
      setCreating(false);
      setSelId(p.id);
      setForm(formOf(p));
    }
    if (p.is_active) return;
    setBusy(true);
    try {
      await debugApi.activatePersona(p.id);
      await props.onRefresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const startNew = async () => {
    if (!(await confirmDiscard())) return;
    setCreating(true);
    setForm(formOf(null));
  };

  const cancelNew = async () => {
    if (!(await confirmDiscard())) return;
    setCreating(false);
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      notify('error', '人设名字不能为空');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        // 只发改过的字段
        const patch: { name?: string; description?: string } = {};
        if (name !== editing.name) patch.name = name;
        if (form.description !== editing.description) patch.description = form.description;
        if (Object.keys(patch).length > 0) await debugApi.updatePersona(editing.id, patch);
        await props.onRefresh();
        notify('ok', '人设已保存');
      } else {
        const created = await debugApi.createPersona({ name, description: form.description });
        // 新建的直接启用 —— 建它就是为了用它
        await debugApi.activatePersona(created.id);
        await props.onRefresh();
        setSelId(created.id);
        setCreating(false);
        setForm(formOf(created));
        notify('ok', `人设「${created.name}」已创建并启用`);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await debugApi.deletePersona(editing.id);
      // 指向它的绑定和默认一起清掉
      const cleaned = forgetPersona(bindings, editing.id);
      if (JSON.stringify(cleaned) !== JSON.stringify(bindings)) props.onChangeBindings(cleaned);
      await props.onRefresh();
      setSelId(null);
      notify('ok', '人设已删除');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // 正在看的人设绑了哪些卡(同名的卡合在一起数)
  const boundNames = (() => {
    if (!editing) return '';
    const count = new Map<string, number>();
    for (const [cid, pid] of Object.entries(bindings.cards)) {
      if (pid !== editing.id) continue;
      const n = props.cardNames.get(cid) ?? '(已删除的卡)';
      count.set(n, (count.get(n) ?? 0) + 1);
    }
    return [...count].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join('、');
  })();
  const boundHere = editing !== null && bindings.cards[cardId] === editing.id;
  const isDefault = editing !== null && bindings.default === editing.id;

  return (
    <>
      <main className="st-main pf-main" aria-label="玩家人设">
        <div className="pf-title-row">
          <h2 className="pf-title">玩家人设</h2>
          <span className="pf-title-note">全局一份清单,同一时刻只启用一个;点一行就换成它</span>
          <span className="st-flex" />
          <Btn icon="plus" onClick={startNew} disabled={busy}>
            新建人设
          </Btn>
        </div>

        <div className="pf-persona-list" role="list">
          {personas.length === 0 && <div className="pf-empty">还没有人设,点右上「新建人设」建一个。</div>}
          {personas.map((p) => (
            <button
              key={p.id}
              type="button"
              role="listitem"
              className={`pf-persona${p.id === editing?.id ? ' selected' : ''}`}
              aria-current={p.id === editing?.id ? 'true' : undefined}
              disabled={busy}
              title={p.is_active ? '当前启用的人设' : '点一下启用并查看详情'}
              onClick={() => void pick(p)}
            >
              <img className="pf-persona-avatar" src={avatarOf(p)} alt="" draggable={false} />
              <span className="pf-persona-text">
                <span className="pf-persona-name">
                  {p.name}
                  {p.is_active && <Chip strong>当前</Chip>}
                  {bindings.cards[cardId] === p.id && <Chip>本卡</Chip>}
                  {bindings.default === p.id && <Chip>默认</Chip>}
                </span>
                <span className="pf-persona-desc">{p.description || '(没有人设描述)'}</span>
              </span>
            </button>
          ))}
        </div>

        {(creating || editing) && (
          <section className="pf-sec pf-persona-form" aria-label={creating ? '新建人设' : `编辑「${editing?.name ?? ''}」`}>
            <div className="pf-sec-head">
              <span className="pf-sec-title">{creating ? '新建人设' : `详情「${editing?.name ?? ''}」`}</span>
            </div>
            <div className="pf-persona-id">
              {editing && (
                <button
                  type="button"
                  className="pf-avatar-btn"
                  title="点击更换头像(裁成 1:1)"
                  aria-label="更换人设头像"
                  disabled={busy}
                  onClick={() => props.onPickAvatar(editing.id)}
                >
                  <img className="pf-avatar" src={avatarOf(editing)} alt="" draggable={false} />
                  <span className="pf-avatar-badge" aria-hidden="true">
                    <Icon name="image" size={12} />
                  </span>
                </button>
              )}
              <label className="pf-persona-name-field">
                <FieldLabel text="名字 · {{user}}" />
                <input
                  className="st-input"
                  value={form.name}
                  placeholder="提示词里的玩家名,如:旅行者"
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
            </div>
            <label className="pf-persona-desc-field">
              <FieldLabel text="人设描述" />
              <textarea
                className="pf-textarea"
                rows={5}
                style={{ minHeight: 5 * 23 + 24 }}
                value={form.description}
                placeholder="外貌、性格、和角色的关系……会填进预设的 personaDescription 块"
                disabled={busy}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <div className="pf-sec-foot">
              <Btn onClick={() => void save()} disabled={busy}>
                {creating ? '创建并启用' : '保存'}
              </Btn>
              {creating && (
                <Btn kind="ghost" onClick={cancelNew} disabled={busy}>
                  取消
                </Btn>
              )}
              {dirty && <span className="pf-title-note">有没保存的改动</span>}
            </div>
          </section>
        )}
      </main>

      <Inspector
        label="人设的绑定"
        footer={
          <>
            <span className="st-flex" />
            <ArmedBtn label="删除人设" disabled={busy || !editing} onConfirm={() => void remove()} />
          </>
        }
      >
        <div className="pf-side">
          <Section title="绑定" help={TERMS.bind} first />
          <SwitchRow
            label={`绑定到这张卡「${cardName}」`}
            checked={boundHere}
            disabled={busy || !editing}
            note="选这张卡就切到这个人设"
            onChange={(on) => editing && props.onBindToCard(on ? editing.id : null)}
          />
          <SwitchRow
            label="设为默认人设"
            checked={isDefault}
            disabled={busy || !editing}
            note="选没绑人设的卡时切回它"
            onChange={(on) => editing && props.onChangeBindings({ ...bindings, default: on ? editing.id : null })}
          />
          {boundNames && <div className="pf-side-note">绑定的角色卡:{boundNames}</div>}

          <Section title="说明" />
          <div className="pf-help">
            <p>
              <b>人设 = 你在故事里是谁。</b>全局一份清单,同一时刻只启用一个;换完立刻影响下一次请求。
            </p>
            <p>
              <b>名字</b>替换提示词里所有的 <code>{'{{user}}'}</code> —— 角色描述、开场白、预设块里的都算。
            </p>
            <p>
              <b>描述</b>填进预设的 <code>personaDescription</code> 块(目录里「玩家人设」那一行),位置由预设编排决定;
              编排里关掉它,描述就完全不进提示词。
            </p>
            <p>
              <b>头像</b>只在界面上显示,不进提示词,也不占 token。
            </p>
            <p className="pf-help-dim">一个人设都没有时,{'{{user}}'} 是「User」,空的描述块会自动跳过。</p>
          </div>
        </div>
      </Inspector>
    </>
  );
}
