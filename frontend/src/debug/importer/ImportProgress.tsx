/**
 * 导入的进度:上传(百分比,能取消)→「正在整理…」(后端认文件、找重复)→「正在导入…」(建卡、建包、找脸)。
 * 390 个文件 / 250 MB 的文件夹大约传几秒、整理 11 秒、导入 5 秒,盖一层挡住别的操作。
 */

import { Icon } from '../studio/icons';
import { Btn } from '../studio/ui';
import './importer.css';

export type ImportPhase =
  | { step: 'idle' }
  /** files:这批几个文件 */
  | { step: 'upload'; sent: number; total: number; files: number }
  | { step: 'plan' }
  | { step: 'apply' };

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ImportProgress({ phase, onCancel }: { phase: ImportPhase; onCancel: () => void }) {
  if (phase.step === 'idle') return null;
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
