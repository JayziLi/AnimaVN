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
// .vn-mw-* 在这里:生图设置里也用连接卡片和模型下拉,那边不一定开过小窗口
import './ui/popWindow.css';

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

/** 连接一行一条,点一条 = 选它(选中那条右边写 now)。生图设置的「指导模型」也用这一块(10-31 用户:做成和主模型一样) */
export function ConnectionCards({
  connections,
  now = '当前启用',
  onPick,
}: {
  connections: ModelQuick['connections'];
  now?: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="vn-mw-conns" role="radiogroup" aria-label="连接">
      {connections.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={c.active}
          className={`vn-mw-conn${c.active ? ' on' : ''}`}
          onClick={() => !c.active && onPick(c.id)}
        >
          <span className="vn-mw-ic" aria-hidden="true">
            {iconOf(c.name)}
          </span>
          <span className="tx">
            <b>{c.name}</b>
            <small>
              {c.type ? `${c.type} · ` : ''}
              {c.model || '未设模型'}
            </small>
          </span>
          {c.active && <span className="vn-mw-now">{now}</span>}
        </button>
      ))}
    </div>
  );
}

/** 模型下拉(只从这条连接上次拉到的列表里选)+ 重新拉取 */
export function ModelSelect({
  models,
  model,
  refreshing,
  refreshedAt,
  onModel,
  onRefresh,
}: Pick<ModelQuick, 'models' | 'model' | 'refreshing' | 'refreshedAt' | 'onModel' | 'onRefresh'>) {
  const inList = models.includes(model);
  return (
    <div className="vn-mw-c">
      <select className="vn-mw-model" value={model} aria-label="模型" onChange={(e) => onModel(e.target.value)}>
        {!inList && (
          <option value={model} disabled>
            {model || '未设模型'}
            {model && models.length > 0 ? '(不在列表中)' : ''}
          </option>
        )}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <PaperButton
        className={`vn-mw-ref${refreshing ? ' busy' : ''}`}
        disabled={refreshing}
        onClick={onRefresh}
        aria-label="重新拉取模型列表"
        title={refreshedAt ? `重新拉取模型列表(上次 ${new Date(refreshedAt).toLocaleString()})` : '拉取这条连接的模型列表'}
      >
        <GameIcon name="retry" size={16} />
      </PaperButton>
    </div>
  );
}

export function ModelWindowBody({ q, onMore }: { q: ModelQuick; onMore: () => void }) {
  return (
    <div className="vn-mw">
      <section>
        <h4 className="vn-mw-gh">连接</h4>
        <ConnectionCards connections={q.connections} onPick={q.onConnection} />
      </section>
      <section>
        <div className="vn-mw-row">
          <span className="vn-mw-k">模型</span>
          <ModelSelect
            models={q.models}
            model={q.model}
            refreshing={q.refreshing}
            refreshedAt={q.refreshedAt}
            onModel={q.onModel}
            onRefresh={q.onRefresh}
          />
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
