/**
 * 「绑定到角色卡…」:勾选哪些卡用这个包(声音)。打开时勾着的 = 现在绑着它的卡;改完点「保存」,
 * 新勾上的绑上、取消勾的拿掉 —— 一张张读出那张卡现在的绑定、改这一处、写回去(libraryModel.bindingWith)。
 * 背景 / BGM 页只动那一边;声音:没有音色的卡当音色,有了就当备用。
 * 写的方法外面给(DebugApp:当前这张卡走 hook,游戏里马上换)。
 */

import { useMemo, useState } from 'react';
import { cardFaceUrl } from '../lib/api';
import { Icon } from '../studio/icons';
import { CardAvatar } from '../studio/StudioAside';
import { Btn, Modal } from '../studio/ui';
import { readBinding, writeBinding, type CardBindingWriter } from './libraryApi';
import { bindChanges, bindingWith, type LibraryItem, type LibraryKind } from './libraryModel';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 卡列表里的一张(DebugApp 的 savedCards) */
export interface LibraryCard {
  id: string;
  name: string;
  /** 是哪张主卡的状态卡;普通的卡是 null */
  stateOf: string | null;
}

const HINT: Record<LibraryKind, (other: boolean) => string> = {
  sprite: () => '勾上的卡多一套服装可换(游戏菜单「角色」页);还没有立绘的卡直接穿上它。取消勾选 = 那张卡不再用它,包留着。',
  voice: () => '没有音色的卡用它当音色,已经有的加成备用声音(卡里别的角色说话时按名字对上才念)。',
  bg: (other) =>
    `只绑背景这一边${other ? '(包里的曲子要在 BGM 页另绑)' : ''}。排在卡的背景栏最后,换开场背景到卡编辑器里拖。`,
  bgm: (other) => `只绑 BGM 这一边${other ? '(包里的背景要在背景页另绑)' : ''}。排在卡的 BGM 栏最后。`,
  cg: () => '勾上的卡游戏里能用这些 CG。',
};

export interface BindResult {
  /** 改成功了的卡 */
  changed: string[];
  /** 没改成的:卡名 + 原因 */
  failed: { name: string; error: string }[];
}

export interface BindDialogProps {
  kind: LibraryKind;
  item: LibraryItem;
  cards: readonly LibraryCard[];
  /** 场景包另一边也有东西(提示里说一声另一边要另绑) */
  otherSide: boolean;
  writer: CardBindingWriter;
  onDone: (result: BindResult) => void;
  onCancel: () => void;
}

export function BindDialog({ kind, item, cards, otherSide, writer, onDone, onCancel }: BindDialogProps) {
  // 打开时排好:绑着的在前,别的按卡列表的顺序;勾来勾去不重排
  const [order] = useState(() => {
    const bound = new Set(item.card_ids);
    return [...cards.filter((c) => bound.has(c.id)), ...cards.filter((c) => !bound.has(c.id))];
  });
  const names = useMemo(() => new Map(cards.map((c) => [c.id, c.name])), [cards]);
  const [checked, setChecked] = useState(() => new Set(item.card_ids));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const changes = bindChanges(
    order.map((c) => c.id),
    item.card_ids,
    checked,
  );
  const dirty = changes.add.length + changes.remove.length;
  const q = query.trim().toLowerCase();
  const rows = q ? order.filter((c) => c.name.toLowerCase().includes(q)) : order;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setBusy(true);
    const result: BindResult = { changed: [], failed: [] };
    const jobs = [...changes.add.map((id) => ({ id, on: true })), ...changes.remove.map((id) => ({ id, on: false }))];
    for (const { id, on } of jobs) {
      try {
        const current = await readBinding(kind, id);
        await writeBinding(writer, kind, id, bindingWith(kind, current, item.id, on));
        result.changed.push(id);
      } catch (e) {
        result.failed.push({ name: names.get(id) ?? id, error: errText(e) });
      }
    }
    setBusy(false);
    onDone(result);
  };

  return (
    <Modal
      title={`把「${item.name}」绑定到角色卡`}
      className="lib-bind"
      onCancel={busy ? () => undefined : onCancel}
      footer={
        <>
          <span className="lib-bind-count">
            {dirty === 0
              ? `已绑定 ${checked.size} 张卡`
              : [changes.add.length && `新绑 ${changes.add.length} 张`, changes.remove.length && `拿掉 ${changes.remove.length} 张`]
                  .filter(Boolean)
                  .join(' · ')}
          </span>
          <span className="st-flex" />
          <Btn disabled={busy} onClick={onCancel}>
            取消
          </Btn>
          <Btn kind="primary" disabled={busy || dirty === 0} onClick={() => void save()}>
            {busy ? '保存中…' : '保存'}
          </Btn>
        </>
      }
    >
      <p className="st-dialog-p">{HINT[kind](otherSide)}</p>
      {cards.length > 8 && (
        <label className="st-picker-search">
          <Icon name="search" size={15} />
          <input
            className="st-input"
            value={query}
            placeholder="搜索卡名"
            aria-label="搜索卡名"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      <div className="lib-bind-list" role="group" aria-label="角色卡">
        {rows.map((c) => {
          const on = checked.has(c.id);
          const was = item.card_ids.includes(c.id);
          const main = c.stateOf ? names.get(c.stateOf) : null;
          return (
            <label key={c.id} className={`lib-bind-row${on ? ' on' : ''}`}>
              <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(c.id)} />
              <CardAvatar className="lib-bind-avatar" sources={[cardFaceUrl(c.id, 72)]} name={c.name} />
              <span className="lib-bind-text">
                <span className="lib-bind-name">{c.name}</span>
                {main && <span className="lib-bind-sub">「{main}」的状态卡</span>}
              </span>
              <span className="lib-bind-state">{on === was ? (was ? '已绑定' : '') : on ? '新绑' : '拿掉'}</span>
            </label>
          );
        })}
        {rows.length === 0 && <div className="st-picker-empty">{q ? `没有名字里带「${query.trim()}」的卡` : '还没有角色卡'}</div>}
      </div>
    </Modal>
  );
}
