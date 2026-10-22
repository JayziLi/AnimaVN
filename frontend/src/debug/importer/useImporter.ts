/**
 * 导入的流程(DebugApp 用,素材管理页以后也用):
 *
 *   拖进来(DropLayer)/ 点「导入」选文件(pick)
 *     → 上传、出计划(进度条;上传中能取消)
 *     → 什么都没认出来:提示一句,完(暂存的文件马上删掉,discard)
 *     → 要问(拖到了卡上、有和库里一样的、只剩认不出的文件):弹确认框(ImportConfirm)
 *     → 执行(失败 500 时确认框不关、写原因,能再点一次;计划没了 404 / 执行过了 409 就提示一句关掉)
 *       确认框点取消 / Esc / 关掉 = 不导了:后端马上删掉这次的暂存(一个角色文件夹几百 MB,不然要放 7 天)
 *     → onApplied:DebugApp 刷新卡列表和包列表、打开那张卡的素材页带上一行提示
 *       (没有卡就打开素材管理页、选中新建的包,提示条在那边)
 *
 * 提示条里认领没认出来的文件走 classify。一次只导一批:上一批没完时再拖进来只提示。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  debugApi,
  type ClassifyKind,
  type ImportApplyBody,
  type ImportPlan,
  type ImportResult,
  type ImportUpload,
} from '../lib/api';
import type { Notify } from '../studio/types';
import { NO_TARGET, type ImportTarget } from './dropTarget';
import {
  fileName,
  importErrorText,
  isAbort,
  nothingToImport,
  shouldConfirm,
  spritesToCheck,
  type TargetSprites,
} from './importModel';
import type { ImportPhase } from './ImportProgress';

export interface ImportDone {
  result: ImportResult;
  plan: ImportPlan;
  target: ImportTarget;
  body: ImportApplyBody;
}

/** 确认框开着时的样子 */
export interface ImportConfirmState {
  plan: ImportPlan;
  target: ImportTarget;
  sprites: TargetSprites | null;
  busy: boolean;
  error: string | null;
  /** 拖进来的文件名(只有一个文件时;角色包的确认框写它) */
  source: string | null;
}

interface Deps {
  notify: Notify;
  /** 立绘包叫什么(确认框说「现在用的「玉衡星」不变」) */
  spritePackName: (id: string) => string | null;
  /** 执行完了:刷新、打开卡编辑器(没有卡就打开素材管理页) */
  onApplied: (done: ImportDone) => void | Promise<void>;
}

/** 选文件时能选的:卡(PNG / JSON)、角色包(.animavn)、单包(.animapack)、图、音频、zip。文件夹选不了(普通的文件框不行),拖进来可以 */
const ACCEPT = [
  '.png,.json,.zip,.animavn,.animapack,.webp,.jpg,.jpeg,.gif,.avif,.bmp',
  '.mp3,.ogg,.oga,.opus,.m4a,.aac,.wav,.flac',
  'image/*,audio/*,application/json,application/zip',
].join(',');

export const IMPORT_BUSY = '上一批还在导入,等它完了再拖';

const IDLE: ImportPhase = { step: 'idle' };

export function useImporter(deps: Deps) {
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });
  const [phase, setPhase] = useState<ImportPhase>(IDLE);
  const [confirm, setConfirmState] = useState<ImportConfirmState | null>(null);
  const confirmRef = useRef<ImportConfirmState | null>(null);
  const setConfirm = (next: ImportConfirmState | null) => {
    confirmRef.current = next;
    setConfirmState(next);
  };
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setBusy = (on: boolean) => {
    busyRef.current = on;
    setBusyState(on);
  };
  const finish = () => {
    abortRef.current = null;
    setBusy(false);
    setPhase(IDLE);
    setConfirm(null);
  };

  /** 不导这一批了:暂存的文件让后端马上删掉;删不掉(已经不在、已经执行过)也无妨,过 7 天会清 */
  const discard = (plan: ImportPlan) => {
    void debugApi.importDiscard(plan.plan_id).catch(() => {});
  };

  /** 拖到的卡现在挂着几套立绘;读不到当不知道 */
  const readSprites = async (cardId: string): Promise<TargetSprites | null> => {
    try {
      const b = await debugApi.getCardSpritePacks(cardId);
      return { count: b.pack_ids.length, current: b.current ? latest.current.spritePackName(b.current) : null };
    } catch {
      return null;
    }
  };

  const apply = async (plan: ImportPlan, target: ImportTarget, body: ImportApplyBody, sprites: TargetSprites | null) => {
    const asked = confirmRef.current;
    if (asked) setConfirm({ ...asked, busy: true, error: null });
    else setPhase({ step: 'apply' });
    let result: ImportResult;
    try {
      result = await debugApi.importApply(plan.plan_id, body);
    } catch (e) {
      const status = (e as { status?: unknown }).status;
      if (status === 404 || status === 409) {
        latest.current.notify('error', importErrorText(e));
        finish();
        return;
      }
      // 库里什么都没改,拖进来的文件还在:框留着(没弹过就弹出来),写上原因,能再试一次
      setPhase(IDLE);
      setConfirm({ plan, target, sprites, busy: false, error: importErrorText(e), source: asked?.source ?? null });
      return;
    }
    finish();
    await latest.current.onApplied({ result, plan, target, body });
  };

  const start = async (files: ImportUpload[], target: ImportTarget = NO_TARGET) => {
    const { notify } = latest.current;
    if (busyRef.current) {
      notify('error', IMPORT_BUSY);
      return;
    }
    if (files.length === 0) {
      notify('error', '没有能导入的文件');
      return;
    }
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const size = files.reduce((n, f) => n + f.file.size, 0);
    setPhase({ step: 'upload', sent: 0, total: size, files: files.length });
    let plan: ImportPlan;
    try {
      plan = await debugApi.importPlan(
        files,
        { targetCardId: target.cardId, kind: target.kind, signal: ctrl.signal },
        // 传完那一下后端开始认文件、找重复(大文件夹十几秒)
        (sent, total) =>
          setPhase(sent >= total ? { step: 'plan' } : { step: 'upload', sent, total, files: files.length }),
      );
    } catch (e) {
      if (isAbort(e)) notify('ok', '已取消导入');
      else notify('error', importErrorText(e));
      finish();
      return;
    }
    if (nothingToImport(plan)) {
      notify('error', ['没认出能导入的东西', ...plan.skipped].join(';'));
      discard(plan);
      finish();
      return;
    }
    if (!shouldConfirm(plan)) {
      await apply(plan, target, { decisions: {}, classify: {}, make_current: false }, null);
      return;
    }
    const check = spritesToCheck(plan, target);
    const sprites = check ? await readSprites(check) : null;
    setPhase(IDLE);
    setConfirm({ plan, target, sprites, busy: false, error: null, source: files.length === 1 ? fileName(files[0].path) : null });
  };

  // 回调都经 ref 读最新的东西,交出去的函数不用每次渲染换
  const startRef = useRef(start);
  const applyRef = useRef(apply);
  const discardRef = useRef(discard);
  useEffect(() => {
    startRef.current = start;
    applyRef.current = apply;
    discardRef.current = discard;
  });

  const run = useCallback((files: ImportUpload[], target?: ImportTarget) => void startRef.current(files, target), []);

  /** 点「导入」:选文件(多选),选完照拖进来的走;target = 给哪张卡 */
  const pick = useCallback((target: ImportTarget = NO_TARGET) => {
    let input = inputRef.current;
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = ACCEPT;
      input.style.display = 'none';
      // 挂进页面:有的手机浏览器不认没挂上的文件框
      document.body.appendChild(input);
      inputRef.current = input;
    }
    const el = input;
    el.onchange = () => {
      const files = Array.from(el.files ?? []);
      // 清掉,同一个文件能再选一次
      el.value = '';
      if (files.length > 0) startRef.current(files.map((file) => ({ file, path: file.name })), target);
    };
    el.click();
  }, []);
  useEffect(() => () => inputRef.current?.remove(), []);

  const confirmApply = useCallback((body: ImportApplyBody) => {
    const c = confirmRef.current;
    if (c && !c.busy) void applyRef.current(c.plan, c.target, body, c.sprites);
  }, []);

  const cancelConfirm = useCallback(() => {
    const c = confirmRef.current;
    if (!c || c.busy) return;
    discardRef.current(c.plan);
    abortRef.current = null;
    busyRef.current = false;
    setBusyState(false);
    setPhase(IDLE);
    confirmRef.current = null;
    setConfirmState(null);
  }, []);

  const cancelUpload = useCallback(() => abortRef.current?.abort(), []);

  /** 提示条里认领一个文件;失败提示一句、返回 null */
  const classify = useCallback(async (jobId: string, path: string, kind: ClassifyKind) => {
    try {
      return await debugApi.importClassify(jobId, path, kind);
    } catch (e) {
      latest.current.notify('error', importErrorText(e, '归类失败'));
      return null;
    }
  }, []);

  return {
    phase,
    confirm,
    busy,
    /** 拖放层用:现在不能导入的原因 */
    blocked: busy ? IMPORT_BUSY : null,
    start: run,
    pick,
    cancelUpload,
    confirmApply,
    cancelConfirm,
    classify,
  };
}

export type Importer = ReturnType<typeof useImporter>;
