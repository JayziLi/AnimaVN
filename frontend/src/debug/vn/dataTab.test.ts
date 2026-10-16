import { describe, expect, it } from 'vitest';
import type { MigrationStatus, StorageStatus } from '../lib/api';
import {
  describeBackup,
  describeCheck,
  describeClean,
  describeDb,
  describeRecords,
  describeStorage,
  describeUpload,
  formatBytes,
  formatWhen,
} from './dataTab';

const status = (over: Partial<MigrationStatus> = {}): MigrationStatus => ({
  app_version: '0.1.0',
  mode: 'report',
  status: 'ok',
  message: '',
  applied: 0,
  detected: 17,
  pending: [],
  unknown: [],
  last_backup: null,
  ...over,
});

describe('describeDb', () => {
  it('says up to date when nothing is pending', () => {
    expect(describeDb(status())).toBe('已是最新(17 步升级都做过了)');
  });

  it('lists pending steps and says the report mode only checks', () => {
    const s = status({ status: 'pending', pending: [{ id: 'core.x', title: '宠物加上年龄' }] });
    expect(describeDb(s)).toBe('有 1 步待升级:宠物加上年龄。现在只检查、不自动升级');
  });

  it('shows the reason when the database is blocked or the upgrade failed', () => {
    expect(describeDb(status({ status: 'failed', message: '升级没成功' }))).toBe('升级没成功');
  });

  it('says the next start upgrades in apply mode', () => {
    const s = status({ mode: 'apply', status: 'pending', pending: [{ id: 'core.x', title: '宠物加上年龄' }] });
    expect(describeDb(s)).toBe('有 1 步待升级:宠物加上年龄。下次启动后端时会先备份再升级');
  });
});

describe('describeStorage / describeClean / describeCheck', () => {
  const base: StorageStatus = {
    enabled: true,
    files: 1200,
    bytes: 2_050_000_000,
    pending: 0,
    trash_bytes: 0,
    db_bytes: 2_100_000_000,
    copy: { state: 'done', done: 1300, total: 1300, message: '' },
  };

  it('shows size and copy progress', () => {
    expect(formatBytes(512)).toBe('1 KB');
    expect(formatBytes(3_400_000)).toBe('3.4 MB');
    expect(describeStorage(null)).toBe('读取中…');
    expect(describeStorage(base)).toBe('1200 个文件 · 2.05 GB · 都复制好了');
    const running = { ...base, copy: { state: 'running' as const, done: 40, total: 1300, message: '' } };
    expect(describeStorage(running)).toBe('1200 个文件 · 2.05 GB · 正在从数据库复制 40/1300');
    expect(describeStorage({ ...base, pending: 3 })).toContain('还有 3 个在数据库里没复制');
    expect(describeStorage({ ...base, enabled: false })).toContain('关着');
  });

  it('reports what clean and check did', () => {
    expect(describeClean({ kept: 9, moved: 0, moved_bytes: 0, young: 0, purged: 0 })).toBe('没有要清的文件');
    expect(describeClean({ kept: 9, moved: 2, moved_bytes: 2_000_000, young: 1, purged: 4 })).toBe(
      '2 个没人用的文件挪进了回收区(2.0 MB),另有 1 个刚放进来不到一天,先留着;回收区里过了 30 天的 4 个已删掉',
    );
    expect(describeCheck({ ok: true, checked: 12, missing: [], restorable: 0, damaged: [] })).toBe(
      '查了 12 个,都在、内容都对',
    );
    expect(
      describeCheck({ ok: false, checked: 12, missing: ['立绘 a', '立绘 b'], restorable: 2, damaged: ['场景素材 c'] }),
    ).toBe(
      '查了 12 个:缺 2 个文件(其中 2 个数据库里还有,下次启动后端会补回),1 个文件内容不对。比如 立绘 a、立绘 b、场景素材 c',
    );
  });
});

describe('formatWhen / describeBackup', () => {
  const now = new Date(2026, 9, 10, 15, 0);

  it('formats today, this year and older dates', () => {
    expect(formatWhen(new Date(2026, 9, 10, 1, 34), now)).toBe('今天 01:34');
    expect(formatWhen(new Date(2026, 9, 8, 23, 5), now)).toBe('10-08 23:05');
    expect(formatWhen(new Date(2025, 11, 31, 8, 0), now)).toBe('2025-12-31');
  });

  it('describes the newest backup', () => {
    expect(describeBackup(null, now)).toBe('还没有整库备份');
    const at = new Date(2026, 9, 10, 1, 34).toISOString();
    expect(describeBackup({ name: 'animabackend.db.bak-x', at, size: 2_130_000_000 }, now)).toBe(
      '今天 01:34 · 2.13 GB · animabackend.db.bak-x',
    );
  });
});

describe('describeUpload', () => {
  it('says there was nothing to send', () => {
    expect(describeUpload({ read: 0, saved: 0, orphaned: 0, chats: 0 }, 'localhost:5173')).toBe(
      '这个地址(localhost:5173)的浏览器里没有存过形态记号,不用传',
    );
  });

  it('reports what was read, saved and left out', () => {
    expect(describeUpload({ read: 5, saved: 4, orphaned: 1, chats: 2 }, '192.168.1.4:5173')).toBe(
      '这个地址(192.168.1.4:5173)读到 5 个记号(2 个对话),4 个已存进存档,1 个所在的消息或对话已经删了、用不上。别的地址(局域网 IP、Tailscale、手机)打开时也各点一次',
    );
  });
});

describe('describeRecords', () => {
  it('写清认词记录有几条、从哪来', () => {
    expect(describeRecords(null)).toBe('读取中…');
    expect(describeRecords('error')).toBe('读不到认词记录:后端还是旧版,重启后端以后再看');
    expect(describeRecords({ total: 0, lists: 0, by_source: {} })).toContain('认词记录还是空的');
    expect(describeRecords({ total: 103, lists: 19, by_source: { migrated: 99, model: 3, player: 1 } })).toBe(
      '认词记录 103 条(迁移时按旧结果 99 条、模型认过 3 条、你改的 1 条),来自 19 份表情名单',
    );
  });
});
