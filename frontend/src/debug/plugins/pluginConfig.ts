/**
 * 插件设置读写的纯逻辑:读一次、写一次、停手再写。不碰 React,也不直接用 debugApi
 * (接口从外面传进来),测试用假接口和假计时器跑(pluginConfig.test.ts)。
 * 接到 state 上的是 usePluginConfig.ts。
 */

/** 停手多久再写库(毫秒) */
export const SAVE_DELAY_MS = 500;

/** 读写设置的两个接口:平时就是 debugApi,测试时换成假的 */
export interface SettingsIO {
  getSetting: (key: string) => Promise<unknown>;
  putSetting: (key: string, value: unknown) => Promise<unknown>;
}

/**
 * 出错提示的开头,后面接「: 原因」。各插件的说法不完全一样(比如外语插件读的时候说
 * 「外语插件配置读取失败」、存的时候说「插件配置保存失败」),不一样的照各自原文传进来
 */
export interface ConfigMessages {
  load: string;
  save: string;
}

export const DEFAULT_CONFIG_MESSAGES: ConfigMessages = {
  load: '插件配置读取失败',
  save: '插件配置保存失败',
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 读一次。库里没有(null)返回 null,调用方留着默认值;有就过一遍 normalize
 * (旧格式、旧默认值的迁移都在各自的 normalize 里)。读失败或 normalize 出错时提示,也返回 null
 */
export async function loadPluginConfig<T>(
  io: SettingsIO,
  key: string,
  normalize: (raw: unknown) => T,
  report: (message: string) => void,
  label: string = DEFAULT_CONFIG_MESSAGES.load,
): Promise<T | null> {
  try {
    const raw = await io.getSetting(key);
    return raw === null ? null : normalize(raw);
  } catch (e) {
    report(`${label}: ${errText(e)}`);
    return null;
  }
}

/** 写一次,失败时提示(不重试) */
export function savePluginConfig(
  io: SettingsIO,
  key: string,
  value: unknown,
  report: (message: string) => void,
  label: string = DEFAULT_CONFIG_MESSAGES.save,
): Promise<void> {
  return io.putSetting(key, value).then(
    () => undefined,
    (e: unknown) => report(`${label}: ${errText(e)}`),
  );
}

/** 停手再做:每次 run 都把上一次还没做的作废,只做最后一次;cancel = 还没做的不做了(卸载时) */
export function createDebounce(delay: number = SAVE_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    run(fn: () => void) {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
