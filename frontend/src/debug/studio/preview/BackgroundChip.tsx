/**
 * 实机预览右上角的「背景:刻晴的房间 ⌄」:换一张背景看看立绘(只是预览,不改任何设置)。
 * 样子是 .st-stage-chip 小牌子,点开是系统自带的下拉(手机上好用、键盘能操作)。
 */

import { sceneThumbUrl, type SceneAsset } from '../../lib/api';
import { Icon } from '../icons';

export function BackgroundChip({
  backgrounds,
  value,
  onChange,
}: {
  backgrounds: readonly SceneAsset[];
  /** 现在显示的那张 */
  value: SceneAsset;
  onChange: (id: string) => void;
}) {
  const thumb = sceneThumbUrl(value, 160);
  const many = backgrounds.length > 1;
  return (
    <label className={`st-stage-chip st-stage-pick${many ? '' : ' single'}`} title={many ? '换一张背景看看(只是预览)' : undefined}>
      {thumb && <img src={thumb} alt="" draggable={false} />}
      <span>背景:{value.label}</span>
      {many && <Icon name="chev" size={14} />}
      {many && (
        <select aria-label="预览用的背景" value={value.id} onChange={(e) => onChange(e.target.value)}>
          {backgrounds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}
