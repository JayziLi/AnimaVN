/**
 * 插件总表 —— 全部插件在这里登记一行。别处要「有哪些插件、哪几个有提示词块、哪几类能让 Jev 标、
 * 叫什么名字」都从这里取,不再各写一份清单。
 *
 * 一行写这几样(用不到的不写):
 *   id          插件的 id;插件抽屉左栏的那一页也用它
 *   name        统一的叫法(设计稿 2.9 第 8 条):插件抽屉左栏、聊天区、视觉小说控制台用的都是它
 *   blockId     提示词块的 identifier(语音没有提示词块)
 *   settingKey  插件设置存在后端 app_settings 的哪个键
 *   tagKind     视觉小说认的那类标签(vn/script.ts 的 TagKind.kind)
 *   jevKind     能让 Jev 标的那一类。存档里 swipe_info.jev.kinds 记的就是它,写死、不跟着 id 改
 *   beta        插件抽屉里标 BETA
 *
 * 表的先后就是插件抽屉左栏的先后(卡带的那一页按它说的 after 插进来);从里面挑出来的清单也保持这个先后 —— PLUGIN_BLOCK_IDS 的先后有用
 * (新插件块插在已有插件块后面,见 common.ts 的 insertPluginBlock)。
 *
 * 这个文件不 import 别的插件文件:插件文件反过来从这里取自己的块和设置键,免得互相 import 绕圈。
 */

/** 总表的一行(不按具体哪个插件区分类型,遍历全表时用) */
export interface PluginRow {
  id: string;
  name: string;
  blockId?: string;
  settingKey?: string;
  tagKind?: string;
  jevKind?: string;
  beta?: boolean;
}

export const PLUGINS = [
  { id: 'sprite', name: '立绘', blockId: 'anima_sprite', settingKey: 'plugin.sprite', tagKind: 'sprite', jevKind: 'sprite' },
  { id: 'bg', name: '背景', blockId: 'anima_bg', settingKey: 'plugin.bg', tagKind: 'bg', jevKind: 'bg' },
  { id: 'bgm', name: '音乐', blockId: 'anima_bgm', settingKey: 'plugin.bgm', tagKind: 'bgm', jevKind: 'bgm' },
  { id: 'cg', name: 'CG', blockId: 'anima_cg', settingKey: 'plugin.cg', tagKind: 'cg', jevKind: 'cg' },
  { id: 'voice', name: '语音', settingKey: 'plugin.voice' },
  { id: 'lang', name: '外语', blockId: 'anima_lang', settingKey: 'plugin.lang' },
  { id: 'player', name: '玩家台词', blockId: 'anima_player', settingKey: 'plugin.player', tagKind: 'player', jevKind: 'player' },
] as const satisfies readonly PluginRow[];

type Row = (typeof PLUGINS)[number];
type BlockRow = Extract<Row, { blockId: string }>;
type JevRow = Extract<Row, { jevKind: string }>;

/** 全部插件(插件抽屉左栏的每一页) */
export type PluginId = Row['id'];
/** 有提示词块的插件 */
export type BlockPluginId = BlockRow['id'];
/** 能让 Jev 标的几类 */
export type JevKind = JevRow['jevKind'];

/** 按 id 取一行 */
export const PLUGIN = Object.fromEntries(PLUGINS.map((p) => [p.id, p])) as {
  [K in PluginId]: Extract<Row, { id: K }>;
};

const BLOCK_ROWS = PLUGINS.filter((p): p is BlockRow => 'blockId' in p);
const JEV_ROWS = PLUGINS.filter((p): p is JevRow => 'jevKind' in p);

/** 所有插件块的 identifier。新的插件块插在已有插件块后面,几块挨在一起 */
export const PLUGIN_BLOCK_IDS: readonly string[] = BLOCK_ROWS.map((p) => p.blockId);

/** 插件块的 identifier:立绘、背景、音乐、CG、外语、玩家台词各一块 */
export const blockIdOf = (id: BlockPluginId): string => PLUGIN[id].blockId;

/** 预设里的插件块 → 它属于哪个插件;不是插件块的当立绘(和原来的写法一样) */
export const pluginOfBlock = (identifier: string): BlockPluginId =>
  BLOCK_ROWS.find((p) => p.blockId === identifier)?.id ?? 'sprite';

/** 能让 Jev 标的几类,按总表的先后 */
export const JEV_KINDS: readonly JevKind[] = JEV_ROWS.map((p) => p.jevKind);

/** Jev 标的那一类 → 它的提示词块(在用 Jev 时这块不发) */
export const BLOCK_OF = Object.fromEntries(JEV_ROWS.map((p) => [p.jevKind, p.blockId])) as Record<JevKind, string>;

/** 不按具体哪个插件区分类型的全表 */
const ROWS: readonly PluginRow[] = PLUGINS;

/** 插件抽屉左栏的一项 */
export interface NavItem {
  id: string;
  name: string;
  beta: boolean;
}

/** 卡带的一页在左栏里要的几样(plugins/cartridges.ts 的 CartridgePanel) */
interface NavPanel {
  key: string;
  title: string;
  beta?: boolean;
  after: string;
}

/**
 * 插件抽屉左栏:照总表的先后;卡带的页(一页或几页)各插在它说的 after 那个插件后面,
 * 同一个插件后面有几页时按传进来的先后;after 不在表里就排最后
 */
export function navItems(panels: NavPanel | readonly NavPanel[] | null): NavItem[] {
  const list: readonly NavPanel[] = !panels ? [] : 'key' in panels ? [panels] : panels;
  const own = (p: NavPanel): NavItem => ({ id: p.key, name: p.title, beta: Boolean(p.beta) });
  const out: NavItem[] = [];
  for (const p of ROWS) {
    out.push({ id: p.id, name: p.name, beta: Boolean(p.beta) });
    for (const c of list) if (c.after === p.id) out.push(own(c));
  }
  for (const c of list) if (!ROWS.some((p) => p.id === c.after)) out.push(own(c));
  return out;
}

const KIND_NAMES = new Map<string, string>();
for (const p of ROWS) {
  if (p.tagKind) KIND_NAMES.set(p.tagKind, p.name);
  if (p.jevKind) KIND_NAMES.set(p.jevKind, p.name);
}

/** 标签种类 / Jev 的那一类 → 统一的叫法;不认识的原样返回 */
export const kindName = (kind: string): string => KIND_NAMES.get(kind) ?? kind;
