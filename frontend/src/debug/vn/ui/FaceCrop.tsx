import { DEFAULT_FACE, faceCropStyle, type FaceBox } from './logic';
import './ui.css';

/**
 * 按脸框裁的头像(差分格、列表行、导航里的小脸)。
 * src 不给 = 一个虚线空圈(这张卡没有这个差分,别拿别的顶替,免得看错)。
 * face 是 0–1 的比例框,不给就用默认位置;aspect = 原图宽 / 高。
 */
export function FaceCrop({
  src,
  face = DEFAULT_FACE,
  aspect,
  size = 40,
  shape = 'round',
  title,
}: {
  src?: string | null;
  face?: FaceBox;
  aspect: number;
  size?: number;
  shape?: 'round' | 'square';
  title?: string;
}) {
  const cls = `av-face${shape === 'square' ? ' is-square' : ''}${src ? '' : ' is-none'}`;
  const box = { width: size, height: size };
  if (!src) return <span className={cls} style={box} title={title} />;
  return (
    <span className={cls} style={box} title={title}>
      <img src={src} alt="" draggable={false} style={faceCropStyle(face, aspect, size)} />
    </span>
  );
}
