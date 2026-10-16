/**
 * 素材管理页「导入记录」页签:最近 50 次导入(时间、标题、摘要、状态),每条「撤销这次导入」——
 * 先拿 undo-preview 把要做的事一句一句列进确认框,点了再撤销。撤销删掉那次新建的卡和包、
 * 拿掉加到原有卡上的绑定、把改过的卡资料改回去;记录留着,标「已撤销」。
 */

import { useEffect, useRef, useState } from 'react';
import { debugApi, type ImportJobSummary, type ImportUndoPreview } from '../lib/api';
import { parseUtc } from '../lib/time';
import { Icon } from '../studio/icons';
import { Btn, Chip, ConfirmDialog } from '../studio/ui';
import { formatWhen } from '../vn/dataTab';
import { jobSummary } from './libraryModel';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface ImportJobsProps {
  /** null = 还在读 */
  jobs: readonly ImportJobSummary[] | null;
  /** 读失败的原因 */
  error: string | null;
  /** 从包的「来自导入」点过来的那条:标出来、滚进来 */
  highlight: string | null;
  /** 撤销完了:外面重读记录、素材列表、卡列表 */
  onUndone: (result: ImportUndoPreview) => void;
  onReload: () => void;
  notify: (kind: 'ok' | 'error', message: string) => void;
}

export function ImportJobs({ jobs, error, highlight, onUndone, onReload, notify }: ImportJobsProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ImportUndoPreview | null>(null);
  const [undoing, setUndoing] = useState(false);
  const list = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!highlight) return;
    list.current?.querySelector('.lib-job.highlight')?.scrollIntoView({ block: 'nearest' });
  }, [highlight, jobs]);

  const ask = async (job: ImportJobSummary) => {
    setLoadingId(job.id);
    try {
      setConfirm(await debugApi.importUndoPreview(job.id));
    } catch (e) {
      notify('error', `读不到这次导入: ${errText(e)}`);
      onReload();
    } finally {
      setLoadingId(null);
    }
  };

  const undo = async (jobId: string) => {
    setUndoing(true);
    try {
      const done = await debugApi.importUndo(jobId);
      setConfirm(null);
      notify('ok', `已撤销「${done.title}」`);
      onUndone(done);
    } catch (e) {
      setConfirm(null);
      notify('error', `撤销失败: ${errText(e)}`);
      onReload();
    } finally {
      setUndoing(false);
    }
  };

  const now = new Date();
  return (
    <main className="st-main lib-jobs">
      <div className="st-grid-head">
        <span className="st-grid-title">导入记录</span>
        <span className="st-grid-note">最近 50 次 · 撤销会删掉那次新建的卡和包、拿掉加到原有卡上的绑定</span>
      </div>
      <div ref={list} className="lib-job-list" role="list">
        {jobs?.map((job) => {
          const t = parseUtc(job.created_at);
          const undone = job.status === 'undone';
          return (
            <div
              key={job.id}
              role="listitem"
              className={`lib-job${undone ? ' undone' : ''}${job.id === highlight ? ' highlight' : ''}`}
            >
              <span className="lib-job-time">{Number.isNaN(t) ? '' : formatWhen(new Date(t), now)}</span>
              <span className="lib-job-text">
                <span className="lib-job-title">
                  {job.title || '(没有标题)'}
                  {undone && <Chip>已撤销</Chip>}
                </span>
                <span className="lib-job-sub">{jobSummary(job.counts)}</span>
              </span>
              {!undone && (
                <Btn small disabled={loadingId !== null} onClick={() => void ask(job)}>
                  {loadingId === job.id ? '读取中…' : '撤销这次导入'}
                </Btn>
              )}
            </div>
          );
        })}
        {jobs !== null && jobs.length === 0 && (
          <div className="st-empty lib-jobs-empty">
            <span className="st-empty-icon">
              <Icon name="upload" size={24} />
            </span>
            <span className="st-empty-title">还没有导入过</span>
            <span className="st-empty-note">把角色卡、立绘、背景、曲子拖进来,导入完就记在这里,能整次撤销</span>
          </div>
        )}
        {jobs === null && <div className="lib-list-empty">{error ? `读不到导入记录:${error}` : '读取中…'}</div>}
      </div>

      {confirm && (
        <ConfirmDialog
          title={`撤销「${confirm.title || '这次导入'}」?`}
          danger
          confirmLabel={undoing ? '撤销中…' : '撤销'}
          body={
            <>
              {confirm.lines.length > 0 ? (
                <ul className="lib-undo-lines">
                  {confirm.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="st-dialog-p">这次导入建的东西都已经不在了,撤销只是把记录标成「已撤销」。</p>
              )}
              <p className="st-dialog-p">删掉的卡和包找不回来;导入记录留着,标成「已撤销」。</p>
            </>
          }
          onConfirm={() => {
            if (!undoing) void undo(confirm.job_id);
          }}
          onCancel={() => {
            if (!undoing) setConfirm(null);
          }}
        />
      )}
    </main>
  );
}
