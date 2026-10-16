import { describe, expect, it } from 'vitest';
import { LABEL_FORBIDDEN } from '../generated/contracts';
import { LABEL_MAX, stripLabelForbidden } from './common';
import { BUILTIN_EMOTIONS } from './emotions';
import { EMO_DIMS, parseRefFileName } from './voice';

// 前后端共用的常量(AnimaBackend/app/contracts.py 生成的 generated/contracts.ts)在前端这边的用法

describe('名字的规矩', () => {
  it('不许用的字符全去掉,别的字原样留着', () => {
    expect(stripLabelForbidden('a<b>[c]{d}【e】「f」\n\rg 食堂')).toBe('abcdefg 食堂');
    for (const c of LABEL_FORBIDDEN) expect(stripLabelForbidden(`x${c}y`)).toBe('xy');
    // 全局正则每次新建,连着调用不会因为 lastIndex 漏字
    expect(stripLabelForbidden('<a>')).toBe('a');
    expect(stripLabelForbidden('<a>')).toBe('a');
  });

  it('内置表情的名字和别名都守规矩', () => {
    expect(LABEL_MAX).toBe(40);
    for (const e of BUILTIN_EMOTIONS) {
      for (const n of [e.label, ...e.aliases]) {
        expect(n.length).toBeLessThanOrEqual(LABEL_MAX);
        expect(stripLabelForbidden(n)).toBe(n);
      }
    }
  });
});

describe('语音', () => {
  it('参考音频文件名:【情绪】原文.wav', () => {
    expect(parseRefFileName('"D:\\refs\\【开心】今天天气真好.wav"')).toEqual({ label: '开心', text: '今天天气真好' });
    expect(parseRefFileName('/refs/开心.wav')).toBeNull();
  });

  it('情绪向量 8 维,每维都有小标签', () => {
    expect(EMO_DIMS.map((d) => d.short).join('')).toBe('喜怒哀惧厌郁惊平');
    expect(EMO_DIMS[0]).toEqual({ short: '喜', name: '高兴' });
  });
});
