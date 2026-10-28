import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DebugConnection } from '../../lib/api';
import { ConnectionsGame, type ConnGameProps } from './ConnectionsGame';
import type { ConnFormState } from './connModel';

const conn = (p: Partial<DebugConnection>): DebugConnection => ({
  id: 'a',
  name: 'Openrouter',
  api_type: 'openai_compatible',
  base_url: 'https://relay.example/v1',
  model: 'deepseek-v4-pro',
  has_api_key: true,
  is_active: true,
  stream: true,
  thinking: 'low',
  cached_models: [],
  cached_models_at: null,
  ...p,
});

const formOf = (c: DebugConnection | null): ConnFormState => ({
  name: c?.name ?? '',
  api_type: (c?.api_type as ConnFormState['api_type']) ?? 'openai_compatible',
  base_url: c?.base_url ?? '',
  api_key: '',
  model: c?.model ?? '',
  stream: c?.stream ?? true,
  thinking: c?.thinking ?? null,
});

const noop = () => {};

function props(over: Partial<ConnGameProps> = {}): ConnGameProps {
  const a = conn({});
  return {
    connections: [a, conn({ id: 'b', name: 'Mock（本地测试）', api_type: 'mock', model: 'mock', is_active: false })],
    selectedId: 'a',
    selected: a,
    form: formOf(a),
    onForm: noop,
    dirty: false,
    cachedModels: [],
    testMessage: 'Hi!',
    onTestMessage: noop,
    busy: null,
    deleteArmed: false,
    result: null,
    jev: { status: { has_key: true, source: 'settings' }, onOpen: noop },
    onSelect: noop,
    onNew: noop,
    onSave: noop,
    onDelete: noop,
    onRefresh: noop,
    onPickModel: noop,
    onPing: noop,
    onSendTest: noop,
    ...over,
  };
}

const render = (over?: Partial<ConnGameProps>) => renderToStaticMarkup(<ConnectionsGame {...props(over)} />);

describe('ConnectionsGame 三栏', () => {
  it('左 连接列表 + Jev,中 表单,右 测试', () => {
    const html = render();
    expect(html).toContain('vn-cn-list');
    expect(html).toContain('vn-cn-form');
    expect(html).toContain('vn-cn-test');
    expect(html).toContain('判断模型 Jev');
    expect(html).toContain('已填 key');
  });

  it('选中的那行 aria-checked + on;当前启用的写「当前启用」', () => {
    const html = render();
    expect(html).toMatch(/aria-checked="true" class="vn-cn-row on"/);
    expect(html).toMatch(/aria-checked="false" class="vn-cn-row"/);
    expect(html).toContain('当前启用');
  });

  it('Base URL 不遮:地址原样在输入框里', () => {
    expect(render()).toContain('value="https://relay.example/v1"');
  });

  it('API Key 是密码框,已保存时提示留空保持不变,明文不回传', () => {
    const html = render();
    expect(html).toContain('type="password"');
    expect(html).toContain('已保存密钥(留空保持不变)');
  });

  it('表单里有:名称 类型 模型名 刷新列表 流式 思考', () => {
    const html = render();
    for (const t of ['名称', '类型', '模型名', '刷新列表', '流式输出', '思考', '保存', '删除']) expect(html).toContain(t);
    expect(html).toMatch(/role="switch"[^>]*checked/);
    // 思考五档是一个下拉,选中「低」
    expect(html).toMatch(/<option value="low" selected="">低 —— 想得短<\/option>/);
  });

  it('流式、思考下面各有一行淡字(设计稿 .tl-fnote),名词旁还有「?」', () => {
    const html = render();
    expect(html).toContain('有些中转站不吃');
    expect(html).toContain('想得越少,正文出得越快');
    expect(html).toContain('aria-label="说明"');
  });

  it('页头有 新建 / 保存 / 删除,下面一行写这条连接和「同一份数据」', () => {
    const html = render();
    expect(html).toMatch(/>新建</);
    expect(html).toContain('与左上「模型」小窗口同一份数据');
  });

  it('还没测的时候,结果框里是一句怎么用', () => {
    expect(render()).toContain('「发送测试消息」会真发一句');
  });

  it('有拉到的模型列表才出「可用模型」', () => {
    expect(render()).not.toContain('可用模型');
    const html = render({ cachedModels: ['m1', 'm2'] });
    expect(html).toContain('可用模型 · 2 个');
    expect(html).toContain('<option value="m2">m2</option>');
  });

  it('Mock:没有地址、key、思考,也没有刷新列表', () => {
    const b = conn({ id: 'b', name: 'Mock', api_type: 'mock', model: 'mock' });
    const html = render({ selectedId: 'b', selected: b, form: formOf(b) });
    expect(html).not.toContain('Base URL');
    expect(html).not.toContain('API Key');
    expect(html).not.toContain('刷新列表');
    expect(html).not.toContain('思考');
    expect(html).toContain('流式输出');
  });

  it('新建:列表里多一行「还没保存」,没有删除,测试按钮不可点', () => {
    const html = render({ selectedId: null, selected: null, form: formOf(null) });
    expect(html).toContain('还没保存');
    expect(html).toContain('新建连接');
    expect(html).not.toContain('>删除<');
    expect(html).toContain('先保存这条连接');
    expect(html).toMatch(/disabled[^>]*>连接</);
  });

  it('删除点第一下变「确认删除?」', () => {
    expect(render({ deleteArmed: true })).toContain('确认删除?');
  });

  it('有没保存的改动时页头提示', () => {
    expect(render({ dirty: true })).toContain('有没保存的改动');
    expect(render()).not.toContain('有没保存的改动');
  });

  it('不给 jev 就没有 Jev 那一块', () => {
    expect(render({ jev: undefined })).not.toContain('判断模型 Jev');
  });

  it('测试结果:忙 / 成功 / 失败(后台英文原文照放)', () => {
    expect(render({ result: { kind: 'busy', what: 'test' } })).toContain('发送中…');
    const ok = render({ result: { kind: 'ok', what: 'test', text: 'Hello there.', ms: 1640 } });
    expect(ok).toContain('收到回复');
    expect(ok).toContain('用时 1.6 秒');
    expect(ok).toContain('Hello there.');
    const bad = render({ result: { kind: 'error', what: 'ping', text: '401 Unauthorized: invalid api key', ms: 300 } });
    expect(bad).toContain('没连上');
    expect(bad).toContain('401 Unauthorized: invalid api key');
    expect(bad).toContain('role="alert"');
  });

  it('忙的时候列表和按钮都不能点', () => {
    const html = render({ busy: 'save' });
    expect(html).toContain('保存中…');
    expect(html).toMatch(/class="vn-cn-row[^"]*" disabled/);
  });
});
