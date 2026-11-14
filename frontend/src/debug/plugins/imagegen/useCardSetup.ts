/**
 * 一张卡的生图设置(后端 imagegen.setup)接到 state 上:换卡重读,改了停手半秒再写库(和长相那份的 changePrefs 一样)。
 * 页面用的 config 怎么合成、改了怎么拆回去在 setup.ts(纯函数,有测试)。
 * 游戏里当前那张卡(useImageGen)和插件抽屉里看的另一张卡(ConsoleSettings)各用一份;画风库是全局的,从外面传进来
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { debugApi } from '../../lib/api';
import type { IllustrationsInput } from '../cartridges';
import { createDebounce, loadPluginConfig, SAVE_DELAY_MS } from '../pluginConfig';
import { imagegenApi } from './api';
import { IMAGEGEN_SETTING_KEY, withStyleLibrary, type ImageGenConfig } from './config';
import {
  applyConfig,
  blankSetup,
  DEFAULT_LIBRARY,
  mergeSetup,
  normalizeLibrary,
  normalizeSetup,
  withConn,
  type ImageSetup,
  type StyleLibrary,
} from './setup';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 连接编号 → 种类 */
type Kinds = Readonly<Record<string, string>>;

type Report = (e: unknown) => void;

/**
 * 停手半秒再写,记着「哪张卡的哪一份」,所以换卡时写不到别的卡上。纯逻辑,有测试(imagegen.test.ts)。
 * 所有写排成一队按先后发;flush 把压着的马上写掉,等队里的都写完才算完。读之前先 flush,换卡再换回来就读不到写之前的旧值
 */
export function createSetupWriter(put: (cardId: string, setup: ImageSetup) => Promise<unknown>, delay: number = SAVE_DELAY_MS) {
  let pending: { cardId: string; setup: ImageSetup; report: Report } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    const p = pending;
    pending = null;
    if (p) {
      queue = queue
        .then(() => put(p.cardId, p.setup))
        .then(
          () => undefined,
          (e: unknown) => p.report(e),
        );
    }
    return queue;
  };

  const schedule = (cardId: string, setup: ImageSetup, report: Report) => {
    // 手上压着别的卡的(两处设置页各看一张卡):先写掉,不然被这次顶掉
    if (pending && pending.cardId !== cardId) void flush();
    pending = { cardId, setup, report };
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), delay);
  };

  return { schedule, flush };
}

// 两处设置页共用一份:抽屉里看的卡变成当前卡时,这边读要排在那边写的后面
const writer = createSetupWriter((cardId, setup) => imagegenApi.putSetup(cardId, setup));

export interface CardSetup {
  /** 这张卡存的那份;没选卡、还没读到是 null */
  setup: ImageSetup | null;
  /** 页面用的;没读到时是默认值(画风库照用) */
  config: ImageGenConfig;
  changeConfig: (next: ImageGenConfig) => void;
  /** 这张卡在某条连接下的那份(测试出图、加完连接「画一张试试」) */
  configFor: (connId: string, kinds: Kinds) => ImageGenConfig;
  setConn: (connId: string | null, kinds: Kinds) => void;
  /** 后端替这张卡换过连接(删了一条)以后重读 */
  reload: () => void;
  /** 停手那半秒里还没写的那次,马上写掉,等写完(删连接前) */
  flush: () => Promise<void>;
}

export function useCardSetup(
  cardId: string | null,
  library: StyleLibrary,
  onLibrary: (next: StyleLibrary) => void,
  notify: IllustrationsInput['notify'],
): CardSetup {
  const [loaded, setLoaded] = useState<{ cardId: string; setup: ImageSetup } | null>(null);
  const [round, setRound] = useState(0);
  const setup = loaded && loaded.cardId === cardId ? loaded.setup : null;
  const config = useMemo(() => mergeSetup(library, setup), [library, setup]);

  // 异步回来、连着改几项时按最新的算
  const latest = useRef({ cardId, setup, config });
  useEffect(() => {
    latest.current = { cardId, setup, config };
  });

  // 改了几次:读的途中又改过,读回来的就是旧的
  const edits = useRef(0);

  useEffect(() => {
    if (!cardId) return;
    let live = true;
    const editsAtStart = edits.current;
    writer
      .flush()
      .then(() => imagegenApi.setup(cardId))
      .then(
        (raw) => {
          if (!live) return;
          // 读的途中又改过:这份是旧的,等刚才的改动写完再读一遍
          if (edits.current !== editsAtStart) setRound((n) => n + 1);
          else setLoaded({ cardId, setup: normalizeSetup(raw) });
        },
        (e: unknown) => {
          if (live) notify('error', `这张卡的生图设置读取失败: ${errText(e)}`);
        },
      );
    return () => {
      live = false;
      // 换卡、卸载、重读前先把没写的写掉(不然停手那半秒里换了卡,上一张卡改的就丢了)
      void writer.flush();
    };
  }, [cardId, round, notify]);

  const remember = useCallback(
    (id: string, next: ImageSetup) => {
      edits.current += 1;
      setLoaded({ cardId: id, setup: next });
      latest.current = { ...latest.current, setup: next };
      writer.schedule(id, next, (e) => notify('error', `这张卡的生图设置保存失败: ${errText(e)}`));
    },
    [notify],
  );

  const changeConfig = useCallback(
    (next: ImageGenConfig) => {
      const { cardId: id, setup: s, config: before } = latest.current;
      const r = applyConfig(s ?? blankSetup(), before, next);
      if (r.library) onLibrary(r.library);
      // 还没读到这张卡存的那份就别写:不然拿默认值盖掉。只改了画风库时这张卡没变,不用写
      if (id && s && JSON.stringify(r.setup) !== JSON.stringify(s)) remember(id, r.setup);
    },
    [onLibrary, remember],
  );

  const setConn = useCallback(
    (connId: string | null, kinds: Kinds) => {
      const { cardId: id, setup: s } = latest.current;
      if (id && s) remember(id, withConn(s, connId, kinds));
    },
    [remember],
  );

  const configFor = useCallback(
    (connId: string, kinds: Kinds) => mergeSetup(library, withConn(latest.current.setup ?? blankSetup(), connId, kinds)),
    [library],
  );

  const reload = useCallback(() => setRound((n) => n + 1), []);

  return useMemo(
    () => ({ setup, config, changeConfig, configFor, setConn, reload, flush: writer.flush }),
    [setup, config, changeConfig, configFor, setConn, reload],
  );
}

/**
 * 全局画风库(plugin.imagegen 的 styles、stylesVersion):开机读一次,改了停手半秒写库。
 * 写之前现读一遍库里那份,只换画风库:里面 11-07 以前的老字段原样留着(万一回滚),卡的设置也不会写回全局。
 * 读不到就不写,免得把老字段盖掉
 */
export function useStyleLibrary(notify: IllustrationsInput['notify']): {
  library: StyleLibrary;
  changeLibrary: (next: StyleLibrary) => void;
} {
  const [library, setLibrary] = useState<StyleLibrary>(DEFAULT_LIBRARY);
  const [debounce] = useState(() => createDebounce());

  useEffect(() => {
    let live = true;
    void loadPluginConfig(debugApi, IMAGEGEN_SETTING_KEY, normalizeLibrary, (m) => notify('error', m), '画风读取失败').then((v) => {
      if (live && v !== null) setLibrary(v);
    });
    return () => {
      live = false;
    };
  }, [notify]);

  const changeLibrary = useCallback(
    (next: StyleLibrary) => {
      setLibrary(next);
      debounce.run(() => {
        void debugApi
          .getSetting<unknown>(IMAGEGEN_SETTING_KEY)
          .then((stored) => debugApi.putSetting(IMAGEGEN_SETTING_KEY, withStyleLibrary(stored, next)))
          .catch((e: unknown) => notify('error', `画风保存失败: ${errText(e)}`));
      });
    },
    [notify, debounce],
  );

  return { library, changeLibrary };
}
