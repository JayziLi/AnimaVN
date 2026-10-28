/**
 * 导入的进度:上传(百分比,能取消)→「正在整理…」(后端认文件、找重复)→「正在导入…」(建卡、建包、找脸)。
 * 390 个文件 / 250 MB 的文件夹大约传几秒、整理 11 秒、导入 5 秒,盖一层挡住别的操作。
 * 游戏开着时是纸卡(设计稿 kit/transfer.js 的 progress:「导入」+ 一个进度条 + 取消,不写说明);调试台里照旧深色。
 */

import { inGame } from '../components/export/inGame';
import { TransferDialog } from '../components/export/TransferDialog';
import { Icon } from '../studio/icons';
import { Btn } from '../studio/ui';
import './importer.css';

export type ImportPhase =
  | { step: 'idle' }
  /** files:这批几个文件 */
  | { step: 'upload'; sent: number; total: number; files: number }
  | { step: 'plan' }
  | { step: 'apply' }
  /** 导不进来(只在游戏里用;调试台里是一行提示):file = 文件名或「3 个文件」,message = 报错原文,retry = 再选一次文件 */
  | { step: 'failed'; file: string; message: string; retry: () => void };

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ImportProgress({ phase, onCancel }: { phase: ImportPhase; onCancel: () => void }) {
  if (phase.step === 'idle') return null;
  if (phase.step === 'failed') return inGame() ? <ImportFailedPaper phase={phase} onClose={onCancel} /> : null;
  if (inGame()) return <ImportProgressPaper phase={phase} onCancel={onCancel} />;
  const pct = phase.step === 'upload' && phase.total > 0 ? Math.min(100, Math.round((phase.sent / phase.total) * 100)) : null;
  const title = phase.step === 'upload' ? '正在上传' : phase.step === 'plan' ? '正在整理…' : '正在导入…';
  const note =
    phase.step === 'upload'
      ? `${phase.files} 个文件 · ${mb(phase.sent)} / ${mb(phase.total)}`
      : phase.step === 'plan'
        ? '认文件、找和库里一样的;大文件夹要十几秒'
        : '建卡、建包、给立绘找脸';
  return (
    <div className="imp-veil" role="status" aria-live="polite">
      <div className="imp-progress">
        <div className="imp-progress-head">
          <Icon name="upload" size={16} />
          {title}
          {pct !== null && <span className="imp-progress-pct">{pct}%</span>}
        </div>
        <div className={`imp-bar${pct === null ? ' busy' : ''}`}>
          <span style={pct === null ? undefined : { width: `${pct}%` }} />
        </div>
        <div className="imp-progress-foot">
          <span className="st-flex">{note}</span>
          {phase.step === 'upload' && (
            <Btn small onClick={onCancel}>
              取消
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

/** 游戏里:纸卡上一个进度条。上传有百分比和「取消」;整理、导入两步不知道走到哪,条子来回走,右边写这一步在做什么 */
function ImportProgressPaper({ phase, onCancel }: { phase: Exclude<ImportPhase, { step: 'idle' | 'failed' }>; onCancel: () => void }) {
  const upload = phase.step === 'upload';
  const pct = upload && phase.total > 0 ? Math.min(100, Math.round((phase.sent / phase.total) * 100)) : null;
  const title = upload && phase.files > 1 ? `导入 ${phase.files} 个文件` : '导入';
  return (
    <TransferDialog
      title={title}
      en="Importing"
      width={460}
      className="prog"
      sticky
      onCancel={() => upload && onCancel()}
      foot={
        <>
          <span className="tf-flex" />
          <button type="button" className="av-btn" disabled={!upload} onClick={onCancel}>
            取消
          </button>
        </>
      }
    >
      <div className="tf-db" role="status" aria-live="polite">
        <div className="tf-prog">
          <span className={`tf-bar${pct === null ? ' busy' : ''}`}>
            <i style={pct === null ? undefined : { width: `${pct}%` }} />
          </span>
          {pct !== null ? <b>{pct}%</b> : <b className="word">{phase.step === 'plan' ? '整理中' : '导入中'}</b>}
        </div>
      </div>
    </TransferDialog>
  );
}

/** 游戏里导不进来:文件名 + 报错原文(不写解决办法);「好的」关上,「重新导入」再选一次文件 */
function ImportFailedPaper({ phase, onClose }: { phase: Extract<ImportPhase, { step: 'failed' }>; onClose: () => void }) {
  return (
    <TransferDialog
      title="导入失败"
      en="Failed"
      width={560}
      className="err"
      onCancel={onClose}
      foot={
        <>
          <span className="tf-flex" />
          <button type="button" className="av-btn" onClick={onClose}>
            好的
          </button>
          <button
            type="button"
            className="av-btn primary"
            onClick={() => {
              onClose();
              phase.retry();
            }}
          >
            重新导入
          </button>
        </>
      }
    >
      <div className="tf-db" role="alert">
        <ul className="tf-errs">
          <li>
            <span className="av-dot bad" />
            <span>
              <b>{phase.file}</b>
              <code>{phase.message}</code>
            </span>
          </li>
        </ul>
      </div>
    </TransferDialog>
  );
}
