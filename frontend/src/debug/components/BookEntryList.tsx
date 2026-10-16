import { entryTitle, type CharacterBookEntry } from '../lib/characterBook';
import { estimateTokens, formatTokens } from '../lib/tokens';

/**
 * 世界书条目列表(只读)。一行一条,点开看正文。块详情弹窗用;要改去卡编辑器的资料页。
 *
 * 顺序按 insertion_order 排,和组装器拼进提示词的顺序一致。
 */
export function BookEntryList({ entries }: { entries: CharacterBookEntry[] }) {
  const sorted = [...entries].sort((a, b) => a.insertion_order - b.insertion_order);
  return (
    <div className="ce-book">
      {sorted.map((e, i) => (
        <details key={i} className={`ce-book-entry${e.enabled ? '' : ' off'}`}>
          <summary className="ce-book-row">
            <span className="ce-book-order">{e.insertion_order}</span>
            <span className="ce-book-keys">{entryTitle(e)}</span>
            <span className="wi-tag">{e.constant ? '常驻' : '关键词'}</span>
            {!e.enabled && <span className="ce-book-token">已关闭</span>}
            <span className="ce-book-token">{formatTokens(estimateTokens(e.content))}</span>
          </summary>
          <div className="ce-book-body">
            {e.keys.length > 0 && (
              <div className="ce-book-meta">关键词:{e.keys.join('、')}</div>
            )}
            <pre className="ce-book-content">{e.content || '(空)'}</pre>
          </div>
        </details>
      ))}
    </div>
  );
}
