/**
 * 左上「模型」开的小窗口里那块(10-24 定,设计稿 kit/scene.js 的 AV.modelWindow):快速换连接、换模型、思考深浅、流式。
 * 内容照调试台顶栏「连接 / 模型」两个下拉和 ConnectionsDrawer:点一条连接 = 设成当前启用;模型只从这条连接上次拉到的列表里选;
 * 新建、地址、密钥、测试都在「打开模型页」(局内菜单 · 模型)。数据和动作由调试台给(DebugApp 的 modelQuick)。
 */

import type { ThinkingLevel } from '../lib/api';
import { GameIcon } from './ui/GameIcon';
import { Help } from './ui/Help';
import { PaperButton } from './ui/PaperButton';
import { Seg } from './ui/Seg';
import { Switch } from './ui/Switch';

export interface ModelQuick {
  connections: readonly { id: string; name: string; type: string; model: string; active: boolean }[];
  /** 当前连接上次拉到的模型 */
  models: readonly string[];
  model: string;
  /** 当前连接的思考深浅(null = 默认);Mock 没有这一行 */
  thinking: ThinkingLevel | null;
  mock: boolean;
  stream: boolean;
  refreshing: boolean;
  refreshedAt: string | null;
  onConnection: (id: string) => void;
  onModel: (model: string) => void;
  onRefresh: () => void;
  onThinking: (level: ThinkingLevel | null) => void;
  onStream: (on: boolean) => void;
}

const THINK: { value: ThinkingLevel | ''; name: string }[] = [
  { value: '', name: '默认' },
  { value: 'off', name: '关' },
  { value: 'low', name: '低' },
  { value: 'high', name: '高' },
  { value: 'max', name: '最大' },
];
const THINK_TIP =
  '想得越少,正文出得越快,剧情和格式可能粗糙一点。DeepSeek、Kimi 都认;GLM-5.3 关不掉思考,只能选低 / 高 / 最大;中转站多半不认,报错就改回默认。';
const STREAM_TIP = '边生成边显示,思维链单独渲染。有些中转站不吃 stream=true,报错就关掉它。';

const iconOf = (name: string) => name.replace(/[（(].*$/, '').trim().slice(0, 2).toUpperCase() || '?';

export function ModelWindowBody({ q, onMore }: { q: ModelQuick; onMore: () => void }) {
  const inList = q.models.includes(q.model);
  return (
    <div className="vn-mw">
      <section>
        <h4 className="vn-mw-gh">连接</h4>
        <div className="vn-mw-conns" role="radiogroup" aria-label="连接">
          {q.connections.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.active}
              className={`vn-mw-conn${c.active ? ' on' : ''}`}
              onClick={() => !c.active && q.onConnection(c.id)}
            >
              <span className="vn-mw-ic" aria-hidden="true">
                {iconOf(c.name)}
              </span>
              <span className="tx">
                <b>{c.name}</b>
                <small>
                  {c.type} · {c.model || '未设模型'}
                </small>
              </span>
              {c.active && <span className="vn-mw-now">当前启用</span>}
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className="vn-mw-row">
          <span className="vn-mw-k">模型</span>
          <div className="vn-mw-c">
            <select className="vn-mw-model" value={q.model} aria-label="模型" onChange={(e) => q.onModel(e.target.value)}>
              {!inList && (
                <option value={q.model} disabled>
                  {q.model || '未设模型'}
                  {q.model && q.models.length > 0 ? '(不在列表中)' : ''}
                </option>
              )}
              {q.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <PaperButton
              className={`vn-mw-ref${q.refreshing ? ' busy' : ''}`}
              disabled={q.refreshing}
              onClick={q.onRefresh}
              aria-label="重新拉取模型列表"
              title={q.refreshedAt ? `重新拉取模型列表(上次 ${new Date(q.refreshedAt).toLocaleString()})` : '拉取这条连接的模型列表'}
            >
              <GameIcon name="retry" size={16} />
            </PaperButton>
          </div>
        </div>
        {!q.mock && (
          <div className="vn-mw-row">
            <span className="vn-mw-k">
              思考 <Help tip={THINK_TIP} />
            </span>
            <div className="vn-mw-c">
              <Seg
                label="思考"
                options={THINK}
                value={q.thinking ?? ''}
                onPick={(v) => q.onThinking(v === '' ? null : v)}
              />
            </div>
          </div>
        )}
        <div className="vn-mw-row">
          <span className="vn-mw-k">
            流式输出 <Help tip={STREAM_TIP} />
          </span>
          <div className="vn-mw-c">
            <Switch label="流式输出" checked={q.stream} onChange={q.onStream} />
          </div>
        </div>
      </section>
      <footer className="vn-mw-foot">
        <PaperButton sm onClick={onMore}>
          打开模型页
        </PaperButton>
      </footer>
    </div>
  );
}
