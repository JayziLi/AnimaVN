import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssemblyResult } from '../../lib/assembler';
import type { TavernCard } from '../../lib/cardParser';
import type { PresetOrderEntry, TavernPreset } from '../../lib/presetParser';
import { Icon } from '../icons';
import { CardFieldsView } from './CardFieldsView';
import { fieldStates, isUnsent, tocOrder } from './fieldStatus';
import { PersonaView, type PersonaPageProps } from './PersonaView';
import { ProfileSide, type ProfileBinding } from './ProfileSide';
import { ProfileToc } from './ProfileToc';
import { otherToc, personaState, presetToc, promptToc, type ProfileKey } from './tocRows';
import './profile.css';

/**
 * 卡编辑器的「资料」页(CardStudio 的 renderProfile 整块):左栏目录 + 中间 + 右栏。
 *
 *   角色卡     目录点卡的字段 / 世界书 / 开场白……:主区滚到那一节并加亮边框;滚主区时目录跟着亮
 *   玩家人设   目录点「玩家人设」:人设列表 + 编辑,右栏绑定(PersonaView)
 *   预设       目录点预设那一行:renderPreset 给(P3 做),还没有时占个位
 *
 * 编辑的永远是当前这张卡;数据、写口全是 DebugApp 的(changeCard 自动保存、绑定、预算……)。
 */

export type ProfileView = 'card' | 'persona' | 'preset';

export interface ProfileTabProps {
  card: TavernCard;
  avatarUrl: string | null;
  /** 当前载入的预设(DebugApp 的 preset,选卡时已经换成这张卡绑的那套) */
  preset: TavernPreset | null;
  /** 当前编排组(带左栏开关的临时改动) */
  order: PresetOrderEntry[];
  /** 下一次请求真正会发出去的东西 —— 序号、token、预览、分布全从这里读,不重算 */
  result: AssemblyResult;
  presetName: string | null;
  /** 当前启用的人设(组装用的那份):目录「玩家人设 · 名字」那一行 */
  persona: { name: string; description: string };
  budget: number | null;
  onChangeBudget: (v: number | null) => void;
  busy: boolean;
  onChange: (patch: Partial<TavernCard>) => void;
  onPickAvatar: () => void;
  onExport: () => void;
  onDuplicate: () => void;
  /** 删这张卡(已经点过两下,不用再问) */
  onDelete: () => void;
  binding: ProfileBinding;
  personaPage: PersonaPageProps;
  /** 预设那一页(P3);不给就先占个位 */
  renderPreset?: () => ReactNode;
}

/** 目录跳转后多久没再滚动就算停稳了:停稳之前滚动联动不抢目录的高亮 */
const SETTLE_MS = 160;
/** 读线:主区(窄屏是贴顶的目录条)下沿往下这么多,顶过这条线的最后一节就是「正在看的」 */
const READ_LINE = 24;
const NARROW = '(max-width: 899px)';

function PresetPending() {
  return (
    <main className="st-main pf-main" aria-label="预设">
      <div className="st-pending">
        <Icon name="preset" size={28} />
        <span>预设这一页下一步做;现在还在调试台左栏的预设面板里改</span>
      </div>
    </main>
  );
}

export function ProfileTab(props: ProfileTabProps) {
  const { card, preset, order, result } = props;
  const [view, setView] = useState<ProfileView>('card');
  const [active, setActive] = useState<ProfileKey>('description');

  const fields = useMemo(() => tocOrder(fieldStates(card, preset, order, result)), [card, preset, order, result]);
  const persona = useMemo(
    () => personaState(props.persona.description, preset, order, result),
    [props.persona.description, preset, order, result],
  );
  const bookRows = result.worldInfo?.rows ?? [];
  const prompt = promptToc(fields, { ...persona, name: props.persona.name }, {
    placed: bookRows.filter((r) => r.placed).length,
    total: card.character_book?.entries.length ?? 0,
  });
  const other = otherToc(1 + card.alternate_greetings.length);
  const presetRow = presetToc(props.presetName, order);

  // ---- 每一节挂上来;ref 回调按 key 缓存,免得每次渲染都先摘后挂 ----
  const sections = useRef(new Map<ProfileKey, HTMLElement>());
  const binders = useRef(new Map<ProfileKey, (el: HTMLElement | null) => void>());
  const bindSection = useCallback((key: ProfileKey) => {
    let fn = binders.current.get(key);
    if (!fn) {
      fn = (el) => {
        if (el) sections.current.set(key, el);
        else sections.current.delete(key);
      };
      binders.current.set(key, fn);
    }
    return fn;
  }, []);
  const mainRef = useRef<HTMLElement | null>(null);

  // ---- 滚动联动:主区(窄屏是整页)滚到哪,目录亮哪 ----
  const settling = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (view !== 'card') return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (settling.current !== undefined) return;
      const main = mainRef.current;
      if (!main) return;
      const narrow = window.matchMedia(NARROW).matches;
      // 窄屏整页滚、目录条贴在顶栏下面;宽屏只有主区滚
      const nav = narrow ? main.parentElement?.querySelector<HTMLElement>('.pf-nav') : null;
      const line = (nav ? nav.getBoundingClientRect().bottom : main.getBoundingClientRect().top) + READ_LINE;
      const scroller = narrow ? main.closest<HTMLElement>('.st-root') : main;
      const els = [...sections.current.entries()].sort(([, a], [, b]) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      );
      if (els.length === 0) return;
      let current = els[0][0];
      // 滚到底了:最后一节顶不到读线,也算看到它了
      if (scroller && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        current = els[els.length - 1][0];
      } else {
        for (const [key, el] of els) if (el.getBoundingClientRect().top <= line) current = key;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      // 目录刚跳过去、还在平滑滚:每滚一下把「停稳」往后推,停稳之前不抢高亮
      if (settling.current !== undefined) {
        window.clearTimeout(settling.current);
        settling.current = window.setTimeout(() => (settling.current = undefined), SETTLE_MS);
        return;
      }
      if (!raf) raf = requestAnimationFrame(update);
    };
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [view]);

  /** 滚到那一节(主区或整页),停稳之前滚动联动不改高亮 */
  const scrollTo = (key: ProfileKey) => {
    const el = sections.current.get(key);
    if (!el) return;
    window.clearTimeout(settling.current);
    settling.current = window.setTimeout(() => (settling.current = undefined), SETTLE_MS * 3);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // 从人设 / 预设那一页点回卡的某一节:先换回角色卡,画出来以后再滚过去
  const pendingJump = useRef<ProfileKey | null>(null);
  useEffect(() => {
    if (view !== 'card' || !pendingJump.current) return;
    const key = pendingJump.current;
    pendingJump.current = null;
    const el = sections.current.get(key);
    if (!el) return;
    window.clearTimeout(settling.current);
    settling.current = window.setTimeout(() => (settling.current = undefined), SETTLE_MS * 3);
    el.scrollIntoView({ block: 'start' });
  }, [view]);

  const jump = (key: ProfileKey) => {
    if (key === 'persona' || key === 'preset') {
      setView(key);
      return;
    }
    setActive(key);
    if (view === 'card') scrollTo(key);
    else {
      pendingJump.current = key;
      setView('card');
    }
  };

  const tocActive: ProfileKey = view === 'card' ? active : view;
  const totalTokens = fields.reduce((n, f) => n + f.tokens, 0);
  const warnCount = fields.filter((f) => isUnsent(f.status)).length;

  return (
    <>
      <ProfileToc
        card={card}
        avatarUrl={props.avatarUrl}
        prompt={prompt}
        other={other}
        preset={presetRow}
        active={tocActive}
        totalTokens={totalTokens}
        warnCount={warnCount}
        onJump={jump}
        onChangeName={(name) => props.onChange({ name })}
        onPickAvatar={props.onPickAvatar}
      />
      {view === 'card' && (
        <>
          <CardFieldsView
            card={card}
            preset={preset}
            order={order}
            result={result}
            fields={fields}
            active={active}
            bindSection={bindSection}
            mainRef={mainRef}
            busy={props.busy}
            onChange={props.onChange}
            onExport={props.onExport}
            onDuplicate={props.onDuplicate}
          />
          <ProfileSide
            binding={props.binding}
            report={result.budget}
            budget={props.budget}
            canBudget={preset !== null}
            onChangeBudget={props.onChangeBudget}
            busy={props.busy}
            onDelete={props.onDelete}
          />
        </>
      )}
      {view === 'persona' && <PersonaView {...props.personaPage} />}
      {view === 'preset' && (props.renderPreset ? props.renderPreset() : <PresetPending />)}
    </>
  );
}
