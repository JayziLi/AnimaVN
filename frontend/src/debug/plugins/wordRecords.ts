/**
 * 认词记录在前端的缓存(素材架构设计 1.4,第 1b 期):每份表情名单(立绘包 / 内置)一份,整个页面共用。
 * 先把这份名单的记录整份读来;名字、别名、记录都对不上的词,批量交给后端 /api/emotion/resolve ——
 * 本地模型按固定算法(每个词单独算)挑一项,后端顺手记进认词记录,下次整份读的时候就在里面了。
 * 第 1d 期:检查器、插件页改了 / 删了一条以后马上更新(put / remove),用到它的 hook 订阅(subscribe)跟着重算。
 * 只 import 类型(运行时 import api.ts 会读 location,node 里的测试跑不了);发请求的函数由调用方传进来。
 */
import type { ResolveResult, WordRecordOut } from '../lib/api';
import type { ModelEntry, RecordEntry, RecordSource } from './emotionMatch';

export interface RecordsApi {
  records: (listRef: string) => Promise<WordRecordOut[]>;
  resolve: (listRef: string, words: string[]) => Promise<ResolveResult[]>;
}

/** 失败过的过这么久再试(后端重启了、刚装好模型) */
export const RETRY_MS = 60_000;
/** 后端一次最多收 50 个词 */
const BATCH = 50;

const SOURCES: readonly string[] = ['migrated', 'model', 'rename', 'player'];
const sourceOf = (s: string | null): RecordSource => (s && SOURCES.includes(s) ? (s as RecordSource) : 'model');

/** 后端的一条认词记录 → 缓存里的一条 */
export const recordEntryOf = (r: WordRecordOut): RecordEntry => ({ key: r.item, source: sourceOf(r.source) });

const keyOf = (listRef: string, word: string) => `${listRef}\u0000${word}`;

interface ListState {
  /** 还没读到是 null */
  records: Map<string, RecordEntry> | null;
  loading: boolean;
  /** 上次没读到的时间:读不到时当一条都没有,过一会儿再读 */
  failedAt: number | null;
  /** 正在读的时候改过:读回来的可能是改之前的,读完再读一次 */
  stale: boolean;
}

export class WordRecordStore {
  private readonly lists = new Map<string, ListState>();
  private readonly answers = new Map<string, ModelEntry>();
  private readonly inflight = new Set<string>();
  /** 每份名单变过几次(读到、问到、改了、删了) */
  private readonly versions = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly api: RecordsApi;
  private readonly now: () => number;

  // 不用参数属性(tsconfig 开了 erasableSyntaxOnly)
  constructor(api: RecordsApi, now: () => number = Date.now) {
    this.api = api;
    this.now = now;
  }

  /** 这份名单的认词记录;还没读到是 null */
  records(listRef: string): ReadonlyMap<string, RecordEntry> | null {
    return this.lists.get(listRef)?.records ?? null;
  }

  /** 记录里没有、问过后端的词:模型这次认的(或者出错的原因) */
  answer(listRef: string, word: string): ModelEntry | undefined {
    return this.answers.get(keyOf(listRef, word));
  }

  /** 这份名单变过几次:hook 拿它当 useSyncExternalStore 的快照,变了就换一个新的查询函数 */
  version(listRef: string): number {
    return this.versions.get(listRef) ?? 0;
  }

  /** 哪份名单变了(读到、问到、改了、删了)都通知;返回退订的函数。箭头函数:能直接传给 useSyncExternalStore */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /**
   * 后端已经改好了这一条(PUT /api/emotion/records 回来以后调):马上按它认,清掉这个词的模型答案。
   * 还没读到这份名单时不用记,读的时候会读到;正在读时读完再读一次
   */
  put(listRef: string, word: string, entry: RecordEntry): void {
    const st = this.lists.get(listRef);
    st?.records?.set(word, entry);
    this.edited(listRef, word, st);
  }

  /** 后端已经删了这一条(DELETE 回来以后调):这个词下次出现时重新问 */
  remove(listRef: string, word: string): void {
    const st = this.lists.get(listRef);
    st?.records?.delete(word);
    this.edited(listRef, word, st);
  }

  private edited(listRef: string, word: string, st: ListState | undefined): void {
    if (st?.loading) st.stale = true;
    this.answers.delete(keyOf(listRef, word));
    this.changed(listRef);
  }

  private changed(listRef: string): void {
    this.versions.set(listRef, this.version(listRef) + 1);
    this.listeners.forEach((fn) => fn());
  }

  /**
   * 读这份名单的记录;读到以后,把 words 里记录也对不上的词交给后端认。有新结果时调 onChange、通知订阅的
   * (调用方再调一次 sync,一批一批问完)。words:名字和别名对不上、不超过 40 字的词(调用方先筛好);keys:名单里现在有的各项
   */
  sync(listRef: string, words: readonly string[], keys: ReadonlySet<string>, onChange?: () => void): void {
    let st = this.lists.get(listRef);
    if (!st) {
      st = { records: null, loading: false, failedAt: null, stale: false };
      this.lists.set(listRef, st);
    }
    if (st.loading) return;
    const t = this.now();
    if (st.records === null || (st.failedAt !== null && t - st.failedAt > RETRY_MS)) {
      this.load(listRef, st, onChange);
      return;
    }
    const state = st;
    const records = st.records;
    const todo = words
      .filter((w) => {
        const rec = records.get(w);
        if (rec && keys.has(rec.key)) return false;
        const k = keyOf(listRef, w);
        if (this.inflight.has(k)) return false;
        const hit = this.answers.get(k);
        return !hit || ('error' in hit && t - hit.at > RETRY_MS);
      })
      .slice(0, BATCH);
    if (todo.length === 0) return;
    const ks = todo.map((w) => keyOf(listRef, w));
    ks.forEach((k) => this.inflight.add(k));
    this.api
      .resolve(listRef, todo)
      .then((results) => {
        const got = new Set<string>();
        for (const r of results) {
          got.add(r.word);
          // 问的时候又读了一次(改过):记进新读到的那份
          if (r.how === 'record') state.records?.set(r.word, { key: r.key, source: sourceOf(r.source) });
          else if (r.how === 'model') this.answers.set(keyOf(listRef, r.word), { key: r.key, score: r.score ?? 0 });
          // name:前端已经按名字认过,不会问到;万一问到(名单刚改过)不用记
        }
        // 后端没回的词当出错,过一会儿再问,免得一直重问
        const at = this.now();
        for (const w of todo) if (!got.has(w)) this.answers.set(keyOf(listRef, w), { error: '后端没认这个词', at });
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        const at = this.now();
        ks.forEach((k) => this.answers.set(k, { error, at }));
      })
      .finally(() => {
        ks.forEach((k) => this.inflight.delete(k));
        onChange?.();
        this.changed(listRef);
      });
  }

  private load(listRef: string, st: ListState, onChange?: () => void): void {
    st.loading = true;
    st.stale = false;
    this.api
      .records(listRef)
      .then((rows) => {
        if (st.stale) return;
        st.records = new Map(rows.map((r) => [r.word, recordEntryOf(r)]));
        st.failedAt = null;
      })
      .catch(() => {
        if (st.stale) return;
        // 读不到(后端还是旧版):当一条都没有,词照样问;过一会儿再读
        st.records = st.records ?? new Map();
        st.failedAt = this.now();
      })
      .finally(() => {
        // 读的时候改过:这次读回来的可能是改之前的,不用,再读一次
        if (st.stale) {
          this.load(listRef, st, onChange);
          return;
        }
        st.loading = false;
        onChange?.();
        this.changed(listRef);
      });
  }
}
