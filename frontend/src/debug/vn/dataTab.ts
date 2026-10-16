/**
 * 设置页「数据」一栏的文字:数据库升级到哪了、上次整库备份是什么时候、文件仓库、表情认法和认词记录。
 * 只有纯函数(只 import 类型:运行时 import api.ts 会读 location,node 里的测试跑不了);
 * 取数据和样子在 VNSettingsPage 的 DataTab 里。
 */
import type {
  MigrationStatus,
  RecordsSummary,
  StorageCheckResult,
  StorageCleanResult,
  StorageStatus,
} from '../lib/api';
import type { MarksUploadReport } from '../plugins/cartridges';

export function describeDb(s: MigrationStatus): string {
  if (s.status === 'failed' || s.status === 'blocked') return s.message;
  if (s.status === 'skipped') return s.message || '这次启动没有检查数据库';
  if (s.pending.length === 0) return `已是最新(${s.applied + s.detected} 步升级都做过了)`;
  const titles = s.pending.map((p) => p.title).join('、');
  const how = s.mode === 'report' ? '现在只检查、不自动升级' : '下次启动后端时会先备份再升级';
  return `有 ${s.pending.length} 步待升级:${titles}。${how}`;
}

/** 字节数写成 KB / MB / GB */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

/** 文件仓库:多少个文件、多大,复制进度 */
export function describeStorage(s: StorageStatus | 'error' | null): string {
  if (s === 'error') return '读不到:后端还是旧版,重启后端以后再看';
  if (s === null) return '读取中…';
  if (!s.enabled) return '文件仓库关着:图和曲子都从数据库里读';
  const head = `${s.files} 个文件 · ${formatBytes(s.bytes)}`;
  const copy = s.copy;
  if (copy?.state === 'running') return `${head} · 正在从数据库复制 ${copy.done}/${copy.total}`;
  if (copy?.state === 'failed') return `${head} · 复制没做完(${copy.message}),下次启动后端接着做`;
  if (s.pending > 0) return `${head} · 还有 ${s.pending} 个在数据库里没复制,下次启动后端会复制`;
  return `${head} · 都复制好了`;
}

export const STORAGE_NOTE =
  '立绘、背景、CG、曲子存成文件放在数据库旁边的 blobs 文件夹里,数据库只记它们的指纹。' +
  '备份:把数据库在线拷一份到 backups(手动的留最近 5 份),文件不用跟着拷 —— 清理时留着的备份要的文件都不删。' +
  '清理:没有任何地方用到的文件挪进回收区,30 天后才真删';

export function describeClean(r: StorageCleanResult): string {
  const moved = r.moved ? `${r.moved} 个没人用的文件挪进了回收区(${formatBytes(r.moved_bytes)})` : '没有要清的文件';
  const young = r.young ? `,另有 ${r.young} 个刚放进来不到一天,先留着` : '';
  const purged = r.purged ? `;回收区里过了 30 天的 ${r.purged} 个已删掉` : '';
  return `${moved}${young}${purged}`;
}

export function describeCheck(r: StorageCheckResult): string {
  if (r.ok) return `查了 ${r.checked} 个,都在、内容都对`;
  const parts = [
    r.missing.length ? `缺 ${r.missing.length} 个文件(其中 ${r.restorable} 个数据库里还有,下次启动后端会补回)` : '',
    r.damaged.length ? `${r.damaged.length} 个文件内容不对` : '',
  ].filter(Boolean);
  const sample = [...r.missing, ...r.damaged].slice(0, 3).join('、');
  return `查了 ${r.checked} 个:${parts.join(',')}。比如 ${sample}`;
}

const two = (n: number) => String(n).padStart(2, '0');

/** 今天的写「今天 01:34」,今年的写「10-08 23:05」,更早的写日期 */
export function formatWhen(at: Date, now: Date): string {
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
  if (at.toDateString() === now.toDateString()) return `今天 ${time}`;
  if (at.getFullYear() === now.getFullYear()) return `${two(at.getMonth() + 1)}-${two(at.getDate())} ${time}`;
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

export function describeBackup(b: MigrationStatus['last_backup'], now = new Date()): string {
  if (!b) return '还没有整库备份';
  return `${formatWhen(new Date(b.at), now)} · ${formatBytes(b.size)} · ${b.name}`;
}

export const UPLOAD_NOTE =
  '切换形态时留下的记号,以前只存在这个浏览器里,换设备、读档就没了。点一下存进存档;每台设备(包括手机)' +
  '用过的每个地址(localhost、局域网 IP、Tailscale)各点一次,重复点不会重复写';

export function describeUpload(r: MarksUploadReport, host: string): string {
  if (r.read === 0) return `这个地址(${host})的浏览器里没有存过形态记号,不用传`;
  const gone = r.orphaned > 0 ? `,${r.orphaned} 个所在的消息或对话已经删了、用不上` : '';
  return (
    `这个地址(${host})读到 ${r.read} 个记号(${r.chats} 个对话),${r.saved} 个已存进存档${gone}。` +
    '别的地址(局域网 IP、Tailscale、手机)打开时也各点一次'
  );
}

export const ENGINE_NOTE =
  '名字对不上立绘的词怎么认。旧算法:每次打开对话都让本地模型重新认,后端重启以后个别词可能认成别的;' +
  '认词记录:认过一次就记下来,以后都按记下的走。换成认词记录以前,要先把旧对话的结果填进认词记录,旧存档才和现在一样';

export function describeRecords(s: RecordsSummary | 'error' | null): string {
  if (s === 'error') return '读不到认词记录:后端还是旧版,重启后端以后再看';
  if (s === null) return '读取中…';
  if (s.total === 0) {
    return '认词记录还是空的:旧对话的结果还没填。填好以前先别换,不然旧存档里个别立绘、语音可能和你上次看到的不一样';
  }
  const by = s.by_source;
  const parts = [
    by.migrated ? `迁移时按旧结果 ${by.migrated} 条` : '',
    by.model ? `模型认过 ${by.model} 条` : '',
    by.player ? `你改的 ${by.player} 条` : '',
    by.rename ? `改名留下的 ${by.rename} 条` : '',
  ].filter(Boolean);
  return `认词记录 ${s.total} 条(${parts.join('、')}),来自 ${s.lists} 份表情名单`;
}
