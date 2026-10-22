import { describe, expect, it } from 'vitest';
import { filesPending, filesZipName, folderPlaceholder, normalizeFolder, placedFolder, placedHint } from './voiceEditorModel';

describe('voice files on another computer (step 4)', () => {
  it('shows the block only for an imported voice whose files are not placed yet', () => {
    expect(filesPending({ files_at: 'pending' })).toBe(true);
    expect(filesPending({ files_at: 'local' })).toBe(false);
    expect(filesPending({ files_at: 'manual' })).toBe(false);
    // 后端是旧版:没有这个字段,当手填路径
    expect(filesPending({})).toBe(false);
  });

  it('tidies the folder people paste', () => {
    expect(normalizeFolder('  "D:\\AnimaVoice\\imports\\刻晴 2\\"  ')).toBe('D:/AnimaVoice/imports/刻晴 2');
    expect(normalizeFolder('D:/AnimaVoice/imports/刻晴_ja/')).toBe('D:/AnimaVoice/imports/刻晴_ja');
    expect(normalizeFolder("'/home/me/voices'")).toBe('/home/me/voices');
  });

  it('only lets 已放好 through with a folder', () => {
    expect(placedFolder('')).toBeNull();
    expect(placedFolder('  " "  ')).toBeNull();
    expect(placedFolder('D:\\x\\')).toBe('D:/x');
  });

  it('says where the paths will point', () => {
    expect(placedHint('D:\\v')).toBe('参考音频会改成 D:/v/refs/原文件名,模型改成 D:/v/models/原文件名');
    expect(placedHint('')).toBe('参考音频会改成 目录/refs/原文件名,模型改成 目录/models/原文件名');
  });

  it('suggests a folder and a zip name from the voice name, safe for Windows', () => {
    expect(folderPlaceholder('刻晴 2')).toBe('D:/AnimaVoice/imports/刻晴 2');
    expect(folderPlaceholder('a/b:c')).toBe('D:/AnimaVoice/imports/a_b_c');
    expect(filesZipName('刻晴(日语)')).toBe('刻晴(日语)-文件.zip');
    expect(filesZipName('  ')).toBe('声音-文件.zip');
  });
});
