/**
 * 导入前的确认框(画布 Confirms 第一个):拖到卡上、或者有和库里一样的东西时先问一句。
 *
 *   给「刻晴」挂上这些素材?
 *   👤 立绘包「刻晴 · 新衣服」· 16 张
 *      挂成刻晴的立绘,算再挂一套;现在用的那套不变
 *      ☐ 挂上以后直接换成这套
 *   🖼 背景「刻晴 · 玉衡星」· 8 张
 *      ⚠ 「刻晴 · 玉衡星」库里已经有一模一样的
 *        ◉ 另存一份(推荐):两张卡各用各的…   ○ 共用已有的那份:现在被 1 张卡用…
 *   ⚠ 2 个文件没认出来   IMG_0231.png  [立绘|背景|BGM|CG|不要]
 *                                              取消   确定挂上
 *
 * 每行写什么由 importModel.ts 算;这里只管选择的状态。执行失败(500)时框不关,底下写原因,按钮变「再试一次」。
 */

import { useState } from 'react';
import type { ClassifyKind, ImportApplyBody, ImportDecision, ImportPlan } from '../lib/api';
import { Icon, type IconName } from '../studio/icons';
import { Btn, Modal } from '../studio/ui';
import type { ImportTarget } from './dropTarget';
import { applyBody, confirmModel, defaultDecisions, type RowIcon, type TargetSprites } from './importModel';
import { KindButtons } from './KindButtons';
import './importer.css';

const ROW_ICONS: Record<RowIcon, IconName> = {
  card: 'user',
  sprite: 'person',
  bg: 'scene',
  bgm: 'music',
  scene: 'scene',
  cg: 'cg',
};

interface Props {
  plan: ImportPlan;
  target: ImportTarget;
  /** 拖到的那张卡现在的立绘;没读、读不到是 null */
  sprites: TargetSprites | null;
  /** 正在执行 */
  busy: boolean;
  /** 上一次执行失败的原因 */
  error: string | null;
  onCancel: () => void;
  onConfirm: (body: ImportApplyBody) => void;
}

export function ImportConfirm({ plan, target, sprites, busy, error, onCancel, onConfirm }: Props) {
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>(() => defaultDecisions(plan));
  const [classify, setClassify] = useState<Record<string, ClassifyKind | null>>({});
  const [makeCurrent, setMakeCurrent] = useState(false);
  const model = confirmModel(plan, target, sprites, makeCurrent);
  const cancel = () => {
    if (!busy) onCancel();
  };

  return (
    <Modal
      className="imp-confirm"
      title={model.title}
      onCancel={cancel}
      footer={
        <>
          <Btn onClick={cancel} disabled={busy}>
            取消
          </Btn>
          <Btn
            kind="primary"
            autoFocus
            disabled={busy}
            onClick={() => onConfirm(applyBody(model, decisions, classify, makeCurrent))}
          >
            {busy ? '正在导入…' : error ? '再试一次' : model.confirmLabel}
          </Btn>
        </>
      }
    >
      <ul className="imp-rows">
        {model.rows.map((r) => (
          <li key={r.key} className="imp-row">
            <span className="imp-row-icon">
              <Icon name={ROW_ICONS[r.icon]} size={17} />
            </span>
            <div className="imp-row-text">
              <span className="imp-row-title">{r.title}</span>
              {r.effect && <span className="imp-row-effect">{r.effect}</span>}
              {r.choice && (
                <div className="imp-choice" role="radiogroup" aria-labelledby={`imp-lead-${r.key}`}>
                  <span id={`imp-lead-${r.key}`} className="imp-choice-lead">
                    <Icon name="alert" size={14} />
                    {r.choice.lead}
                  </span>
                  {r.choice.options.map((o) => (
                    <label key={o.value} className="imp-opt">
                      <input
                        type="radio"
                        name={`imp-${r.key}`}
                        disabled={busy}
                        checked={(decisions[r.key] ?? r.choice?.initial) === o.value}
                        onChange={() => setDecisions((d) => ({ ...d, [r.key]: o.value }))}
                      />
                      <span>
                        <b>{o.label}</b>:{o.note}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {model.makeCurrent?.key === r.key && (
                <label className="imp-check">
                  <input
                    type="checkbox"
                    checked={makeCurrent}
                    disabled={busy}
                    onChange={(e) => setMakeCurrent(e.target.checked)}
                  />
                  {model.makeCurrent.label}
                </label>
              )}
            </div>
          </li>
        ))}
      </ul>

      {model.unknown.length > 0 && (
        <div className="imp-unknown">
          <div className="imp-sub-head">
            <Icon name="alert" size={14} />
            {model.unknown.length} 个文件没认出来
          </div>
          <div className="imp-sub-note">可以现在选它们是什么;不选就先放着,导完在提示条里点「查看」还能选</div>
          {model.unknown.map((u) => (
            <div key={u.path} className="imp-urow">
              <span className="imp-uname" title={u.path}>
                <b>{u.name}</b>
                {u.folder && <span>{u.folder}</span>}
              </span>
              <KindButtons
                label={`${u.name} 是什么`}
                value={classify[u.path] ?? null}
                disabled={busy}
                // 再点一下选中的那个 = 不选了(先放着)
                onPick={(k) => setClassify((c) => ({ ...c, [u.path]: c[u.path] === k ? null : k }))}
              />
            </div>
          ))}
        </div>
      )}

      {model.skipped.length > 0 && (
        <ul className="imp-skipped">
          {model.skipped.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}

      {error && (
        <div className="imp-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
