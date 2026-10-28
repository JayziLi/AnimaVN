/**
 * 插件抽屉全局组「自动补块」(第 2 步 D4、P4):预设缺了插件块时发送那一刻自动补上(core.assembly.autoFill,core/assembly.ts)。
 * 开关下面列出当前聊天这张卡这次会补哪几块(core/sendPlan.ts 的 autoRows,和组装用的是同一份);
 * 抽屉里看的不是这张卡时照样列当前聊天这张卡的,写明只看得到它的。
 */

import { autoRows, type SendView } from '../../../core/sendPlan';
import { SettingRow } from '../../settings/SettingRow';
import { PageHead, PageShell, Panel, Section } from '../frame';
import './sendPages.css';

export function AutoFillPage({
  autoFill,
  onChange,
  send,
  viewCard,
}: {
  autoFill: boolean;
  onChange: (on: boolean) => void;
  /** 当前聊天这张卡这次怎么发;不传就不列 */
  send?: SendView;
  /** 抽屉里正在看的那张卡 */
  viewCard?: { id: string; name: string } | null;
}) {
  const card = send?.card ?? null;
  const rows = send ? autoRows(send.plan, send.auto) : [];
  const other = card !== null && viewCard != null && viewCard.id !== card.id;
  const empty = !card
    ? '还没选卡。'
    : !send?.presetName
      ? '还没选预设。'
      : !autoFill
        ? '自动补块关着,这次不补。'
        : rows.length === 0
          ? '这次不用补'
          : null;
  return (
    <PageShell
      commonFirst
      head={<PageHead title="自动补块" tip="autofill" inUse={{ on: autoFill, text: autoFill ? '开着' : '关着' }} tags={[]} />}
      common={
        <Section title="常用" en="Common">
          <SettingRow label="缺块时补上" control={{ kind: 'toggle' }} value={autoFill} default={true} onChange={onChange} />
        </Section>
      }
      preview={
        send && (
          <Panel title={`${card?.name || '这张卡'}这次会补`} tip="auto_fill">
            <div className="dw-send-body">
              {other && <div className="dw-muted">只看得到当前聊天这张卡({card?.name})的。</div>}
              {send.presetName && <div className="dw-muted">当前预设「{send.presetName}」</div>}
              {empty !== null ? (
                <div className="dw-send-empty">{empty}</div>
              ) : (
                <ul className="dw-send-list">
                  {rows.map((r) => (
                    <li key={r.identifier} className="dw-send-item">
                      <span className="dw-send-name">{r.name}</span>
                      <span className="dw-send-note">{r.note}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        )
      }
    />
  );
}
