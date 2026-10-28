import { describe, expect, it } from 'vitest';
import { noticeToToast, routeNotice, saveReceipt, toastPlace } from './notice';

describe('saveReceipt', () => {
  it('reads like the design: place and line count', () => {
    expect(saveReceipt('夜路', 33)).toBe('已存档 · 夜路 · 33 条');
  });
  it('drops the place when the scene has no background name', () => {
    expect(saveReceipt(null, 4)).toBe('已存档 · 4 条');
    expect(saveReceipt('  ', 4)).toBe('已存档 · 4 条');
  });
});

describe('routeNotice', () => {
  it('游戏开着走游戏的纸卡,关着照旧走调试台的条', () => {
    expect(routeNotice(true)).toBe('game');
    expect(routeNotice(false)).toBe('console');
  });
});

describe('noticeToToast', () => {
  it('成功:整句当正文', () => {
    expect(noticeToToast('ok', '已存档:「星绘」')).toEqual({ kind: 'ok', text: '已存档:「星绘」' });
  });
  it('出错:冒号前是短标题,冒号后是英文原文', () => {
    expect(noticeToToast('error', '保存失败: ConnectionError: refused')).toEqual({
      kind: 'err',
      text: '保存失败',
      code: 'ConnectionError: refused',
    });
    expect(noticeToToast('error', '导出失败:boom')).toEqual({ kind: 'err', text: '导出失败', code: 'boom' });
  });
  it('拆不出来就整句当正文', () => {
    expect(noticeToToast('error', '预设名不能为空')).toEqual({ kind: 'err', text: '预设名不能为空' });
    expect(noticeToToast('error', 'Failed to fetch')).toEqual({ kind: 'err', text: 'Failed to fetch' });
    expect(noticeToToast('error', '保存失败: ')).toEqual({ kind: 'err', text: '保存失败: ' });
    expect(noticeToToast('error', '这是一句挺长的中文说明文字而且后面还有冒号: x').kind).toBe('err');
    expect(noticeToToast('error', '这是一句挺长的中文说明文字而且后面还有冒号: x').code).toBeUndefined();
  });
});

describe('toastPlace', () => {
  it('平时右上让开按钮,菜单 / 选角色时在底下正中', () => {
    expect(toastPlace(false)).toEqual({ pos: 'tr', offset: { top: 130 } });
    expect(toastPlace(true)).toEqual({ pos: 'bc', offset: { bottom: 22 } });
  });
});
