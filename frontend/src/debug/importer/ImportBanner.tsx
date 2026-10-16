/**
 * 卡编辑器素材页(没有卡可开时是素材管理页)顶上那一行导入提示(10-15 定:导入报告不弹窗,就是这一行):
 *
 *   ✓ 刻晴.png 导入完成 · 已自动绑定配套的立绘、背景、BGM   新建 角色卡 1 张…   | ⚠ 1 个文件未识别:IMG_0231.png 查看   ×
 *
 * 「查看」展开一个小面板,每个没认出来的文件一行「立绘 / 背景 / BGM / CG / 不要」,点了马上认领(classify),
 * 提示跟着更新;全认完小面板自己收起。悬停标题能看整份报告。
 */

import { useCallback, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ClassifyKind } from '../lib/api';
import { Icon } from '../studio/icons';
import { useAnchored, useDismiss } from '../studio/floating';
import { IconBtn } from '../studio/ui';
import type { ImportNotice } from '../studio/types';
import { fileName } from './importModel';
import { KindButtons } from './KindButtons';
import './importer.css';

interface Props {
  notice: ImportNotice;
  onClose: () => void;
  /** 认领一个没认出来的文件(成功以后由调用方换上新的 notice);不给就不显示「查看」 */
  onClassify?: (path: string, kind: ClassifyKind) => Promise<void>;
}

export function ImportBanner({ notice, onClose, onClassify }: Props) {
  const [open, setOpen] = useState(false);
  const link = useRef<HTMLButtonElement | null>(null);
  const report = notice.report?.length ? notice.report.join('\n') : undefined;
  const unknown = notice.unknown;
  const canView = Boolean(onClassify && notice.jobId);
  return (
    <div className="st-notice" role="status">
      <Icon name="check_circle" size={16} />
      <span className="st-notice-title" title={report}>
        {notice.title}
      </span>
      {notice.detail && (
        <span className="st-notice-detail" title={report}>
          {notice.detail}
        </span>
      )}
      {unknown.length > 0 && (
        <>
          <span className="st-notice-sep" />
          <span className="st-notice-warn">
            <Icon name="alert" size={15} />
            <span>
              {unknown.length} 个文件未识别:
              <span className="st-notice-file">{fileName(unknown[0])}</span>
              {unknown.length > 1 && ' 等'}
            </span>
            {canView && (
              <button
                ref={link}
                type="button"
                className="st-link"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                查看
              </button>
            )}
          </span>
        </>
      )}
      <span className="st-flex" />
      <IconBtn icon="x" label="关闭提示" size={28} onClick={onClose} />
      {open && canView && unknown.length > 0 && onClassify && (
        <UnknownPanel anchor={link} files={unknown} onClassify={onClassify} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function UnknownPanel({
  anchor,
  files,
  onClassify,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  files: string[];
  onClassify: (path: string, kind: ClassifyKind) => Promise<void>;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const style = useAnchored(true, anchor, panel, 'end', 8);
  const close = useCallback(() => onClose(), [onClose]);
  useDismiss(true, [anchor, panel], close);
  // 正在认领的那个文件(一次一个,别的按钮先灰着)
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (path: string, kind: ClassifyKind) => {
    setBusy(path);
    try {
      await onClassify(path, kind);
    } finally {
      setBusy(null);
    }
  };
  return createPortal(
    <div ref={panel} role="dialog" aria-label="没认出来的文件" className="imp-pop st-layer" style={style}>
      <div className="imp-pop-head">
        <Icon name="alert" size={15} />
        <span className="imp-pop-title">{files.length} 个文件没认出来 · 选它们是什么</span>
        <IconBtn icon="x" label="收起" size={28} onClick={onClose} />
      </div>
      <div className="imp-pop-list">
        {files.map((path) => {
          const name = fileName(path);
          const folder = path.slice(0, Math.max(0, path.length - name.length - 1));
          return (
            <div key={path} className="imp-pop-row imp-urow">
              <span className="imp-uname" title={path}>
                <b>{name}</b>
                {folder && <span>{folder}</span>}
              </span>
              <KindButtons
                label={`${name} 是什么`}
                value={null}
                disabled={busy !== null}
                onPick={(k) => void pick(path, k)}
              />
            </div>
          );
        })}
      </div>
      <div className="imp-pop-note">选了就归进这次导入建的同类包;没有同类的包就新建一个「补充」包,这次导入有卡就挂到那张卡上</div>
    </div>,
    document.body,
  );
}
