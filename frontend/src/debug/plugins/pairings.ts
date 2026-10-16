/**
 * 配对表在前端的缓存(素材架构设计 1.6.4、1.6.5,第 1c 期):每份表情名单(立绘包)、语音和 CG 各一份,整个页面共用。
 * 「表情认法」选了认词记录时用:语音按它挑那一行语气(voiceRowFromPairs),CG 按它挑那一张差分(cgFrameFromPairs)。
 * 表在后端由回放工具填好,这里整份读来;读到以后不再自己重读。
 * 第 1d 期:检查器、配对页改了一格、补配回来、要重读以后马上更新(putCell / addCells / reload),用到它的 hook 订阅(subscribe)跟着重算;
 * 这句的立绘在表里没有格子时当场补一次(PairingFiller、missingCell)。
 * 只 import 类型(运行时 import api.ts 会读 location,node 里的测试跑不了);发请求的函数由调用方传进来。
 */
import type {
  PackSprite,
  PairingCellOut,
  PairingFillOut,
  PairingFollower,
  PairingTableOut,
  SceneAsset,
} from '../lib/api';
import { cgFrameFor, cgVariantsOf } from './scene';
import { RETRY_MS } from './wordRecords';

/** 一份名单的配对表:target(声音的 id / CG 构图的 id)→ 名单里的一项(立绘的 id)→ 配的那一行语气 / 那张差分(CG 是 null = 构图本身) */
export type PairTables = ReadonlyMap<string, ReadonlyMap<string, string | null>>;

/** 读一份名单的共用配对表(GET /api/pairings) */
export type PairingsLoader = (follower: PairingFollower, listRef: string) => Promise<PairingTableOut[]>;

const keyOf = (follower: PairingFollower, listRef: string) => `${follower}\u0000${listRef}`;

interface ListState {
  /** 还没读到是 null */
  tables: PairTables | null;
  loading: boolean;
  /** 上次没读到的时间:读不到时当一张表都没有,过一会儿再读 */
  failedAt: number | null;
  /** 正在读的时候改过、叫过重读:读回来的可能是改之前的,读完再读一次 */
  stale: boolean;
}

export class PairingStore {
  private readonly lists = new Map<string, ListState>();
  private readonly listeners = new Set<() => void>();
  private readonly loader: PairingsLoader;
  private readonly now: () => number;

  // 不用参数属性(tsconfig 开了 erasableSyntaxOnly)
  constructor(loader: PairingsLoader, now: () => number = Date.now) {
    this.loader = loader;
    this.now = now;
  }

  /** 这份名单的配对表;还没读到是 null。读到以后换成新的 Map(用到它的 useMemo 会跟着重算) */
  tables(follower: PairingFollower, listRef: string): PairTables | null {
    return this.lists.get(keyOf(follower, listRef))?.tables ?? null;
  }

  /** 没读过就读;上次没读到、过了 RETRY_MS 再读一次。读完(不管成没成)调 onChange、通知订阅的 */
  sync(follower: PairingFollower, listRef: string, onChange?: () => void): void {
    const st = this.stateOf(follower, listRef);
    if (st.loading) return;
    if (st.tables !== null && (st.failedAt === null || this.now() - st.failedAt <= RETRY_MS)) return;
    this.load(follower, listRef, st, onChange);
  }

  /** 哪份名单变了(读到、改了一格、补配回来、重读了)都通知;返回退订的函数。箭头函数:能直接传给 useSyncExternalStore */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** 后端已经改好了这一格(PUT 回来以后调):马上按它走。还没读到这份名单时不用记,读的时候会读到 */
  putCell(follower: PairingFollower, listRef: string, target: string, item: string, value: string | null): void {
    this.edit(follower, listRef, target, [[item, value]]);
  }

  /** 缺格补配回来的格子(POST /api/pairings/fill 的 added)加进这张表;表还没有就新加。一格都没补上不用动 */
  addCells(follower: PairingFollower, listRef: string, target: string, cells: readonly PairingCellOut[]): void {
    if (cells.length > 0) this.edit(follower, listRef, target, cells.map((c) => [c.item, c.value] as const));
  }

  /** 整份重读(配对页采纳了一批建议以后等);正在读时读完再读一次 */
  reload(follower: PairingFollower, listRef: string): void {
    const st = this.stateOf(follower, listRef);
    if (st.loading) st.stale = true;
    else this.load(follower, listRef, st);
  }

  private stateOf(follower: PairingFollower, listRef: string): ListState {
    const key = keyOf(follower, listRef);
    let st = this.lists.get(key);
    if (!st) {
      st = { tables: null, loading: false, failedAt: null, stale: false };
      this.lists.set(key, st);
    }
    return st;
  }

  /** 改几格:换成新的 Map(用到它的 useMemo 会跟着重算),别的表还是原来那个 */
  private edit(
    follower: PairingFollower,
    listRef: string,
    target: string,
    cells: readonly (readonly [item: string, value: string | null])[],
  ): void {
    const st = this.lists.get(keyOf(follower, listRef));
    if (st?.loading) st.stale = true;
    if (st?.tables) {
      const next = new Map(st.tables);
      next.set(target, new Map([...(st.tables.get(target) ?? []), ...cells]));
      st.tables = next;
    }
    this.listeners.forEach((fn) => fn());
  }

  private load(follower: PairingFollower, listRef: string, st: ListState, onChange?: () => void): void {
    st.loading = true;
    st.stale = false;
    this.loader(follower, listRef)
      .then((rows) => {
        if (st.stale) return;
        st.tables = new Map(rows.map((t) => [t.target, new Map(t.cells.map((c) => [c.item, c.value]))]));
        st.failedAt = null;
      })
      .catch(() => {
        if (st.stale) return;
        // 读不到(后端还是旧版):当一张表都没有,语音照旧交给后端按名字挑;过一会儿再读
        st.tables = st.tables ?? new Map();
        st.failedAt = this.now();
      })
      .finally(() => {
        // 读的时候改过:这次读回来的可能是改之前的,不用,再读一次
        if (st.stale) {
          this.load(follower, listRef, st, onChange);
          return;
        }
        st.loading = false;
        onChange?.();
        this.listeners.forEach((fn) => fn());
      });
  }
}

/** 补一张表缺的格子(POST /api/pairings/fill,成了顺手更新缓存) */
export type PairingFill = (follower: PairingFollower, listRef: string, target: string) => Promise<PairingFillOut>;

interface FillState {
  /** 正在补 */
  busy: boolean;
  /** 上次没补上的时间(请求失败,或者要的那一格后端没补上,比如本地模型还没好):过 RETRY_MS 再试 */
  failedAt: number | null;
  /** 补过的项:不再为它发(后端已经有、或者补上了) */
  done: Set<string>;
}

/**
 * 缺格补配(素材架构设计 1.6.5 第 3 步,第 1d 期):这句的立绘在配对表里还没有格子(以后新加的立绘)时当场补一次 ——
 * 后端按名字比,对不上语音用本地模型挑、CG 用构图本身,标「待重配」;等它回来之前语音照旧按名字挑、CG 照旧按名字找。
 * 同一张表一次只发一个请求;补过的项不再为它发;没补上的过 RETRY_MS 再试。整个页面一份(vn/usePairings.ts)
 */
export class PairingFiller {
  private readonly tables = new Map<string, FillState>();
  private readonly fill: PairingFill;
  private readonly now: () => number;

  // 不用参数属性(tsconfig 开了 erasableSyntaxOnly)
  constructor(fill: PairingFill, now: () => number = Date.now) {
    this.fill = fill;
    this.now = now;
  }

  /** 这张表缺 item 这一格:该发就发一次,返回这次发没发 */
  want(follower: PairingFollower, listRef: string, target: string, item: string): boolean {
    const key = `${keyOf(follower, listRef)}\u0000${target}`;
    let st = this.tables.get(key);
    if (!st) {
      st = { busy: false, failedAt: null, done: new Set() };
      this.tables.set(key, st);
    }
    if (st.busy || st.done.has(item)) return false;
    if (st.failedAt !== null && this.now() - st.failedAt <= RETRY_MS) return false;
    const s = st;
    s.busy = true;
    this.fill(follower, listRef, target)
      .then((r) => {
        for (const c of r.added) s.done.add(c.item);
        // 要的这一格后端没补上(本地模型还没好):过一会儿再试;不在 skipped 里的就是补上了或者本来就有
        if (r.skipped.some((x) => x.item === item)) {
          s.failedAt = this.now();
        } else {
          s.done.add(item);
          s.failedAt = null;
        }
      })
      .catch(() => {
        s.failedAt = this.now();
      })
      .finally(() => {
        s.busy = false;
      });
    return true;
  }
}

/**
 * 这句的表情(label)是包里一张立绘、配对表(table,立绘 id → 配的那一格)里还没有它的格子(表都没有也算):
 * 返回那张立绘的 id(同名的认排前面那张,和舞台一样),拿去补;有格子(空的也算)、不是包里的表情、没有表情是 null
 */
export function missingCell(
  table: ReadonlyMap<string, string | null> | undefined,
  sprites: readonly Pick<PackSprite, 'id' | 'label'>[],
  label: string | null,
): string | null {
  if (label === null) return null;
  const id = sprites.find((s) => s.label === label)?.id;
  return id !== undefined && !table?.has(id) ? id : null;
}

/** 表情名 → 包里那张立绘的 id(同名的认排前面那张,和舞台一样) */
function spriteIdsByLabel(sprites: readonly Pick<PackSprite, 'id' | 'label'>[]): Map<string, string> {
  const byLabel = new Map<string, string>();
  for (const s of sprites) if (!byLabel.has(s.label)) byLabel.set(s.label, s.id);
  return byLabel;
}

/**
 * 语音按配对表念:这句显示的表情名 → 包里那张立绘(同名的认排前面那张,和舞台一样)→ 配对表里那一格配的那一行语气的 id。
 * table 是这份名单配给主声音的那张表。表里没有这张立绘、格子是空的、不是包里的表情、没有表情都是 undefined(交给后端按名字挑)
 */
export function voiceRowFromPairs(
  table: ReadonlyMap<string, string | null>,
  sprites: readonly Pick<PackSprite, 'id' | 'label'>[],
): (label: string | null) => string | undefined {
  const byLabel = spriteIdsByLabel(sprites);
  return (label) => {
    const id = label === null ? undefined : byLabel.get(label);
    return (id === undefined ? undefined : table.get(id)) ?? undefined;
  };
}

/**
 * CG 差分按配对表挑(给 TimelineCtx.cgFrame):这张构图有表、这句的表情名是包里一张立绘、表里有这一格时 ——
 * 格子配的差分还在(是这张构图的、在 assets 里、有图)就是它;格子是空的、那张差分不在了用构图本身
 * (构图没图用第一张有图的差分,和按名字找时一样)。别的情况(没有表、没有这一格、不是包里的表情、没有表情)
 * 是 undefined,照旧按名字找。tables 是这份名单 CG 的配对表(构图 id → 立绘 id → 差分 id),assets 是场景包里启用的素材
 */
export function cgFrameFromPairs(
  tables: PairTables,
  sprites: readonly Pick<PackSprite, 'id' | 'label'>[],
  assets: readonly SceneAsset[],
): (cg: SceneAsset, label: string | null) => SceneAsset | undefined {
  const byLabel = spriteIdsByLabel(sprites);
  return (cg, label) => {
    const table = tables.get(cg.id);
    const id = label === null ? undefined : byLabel.get(label);
    if (!table || id === undefined || !table.has(id)) return undefined;
    const value = table.get(id);
    const frame = value ? cgVariantsOf(assets, cg.id).find((a) => a.id === value && a.has_file) : undefined;
    return frame ?? cgFrameFor(cg, assets, null);
  };
}
