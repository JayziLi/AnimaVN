/**
 * 背景 / BGM 包编辑器共用的那一套:读包里的素材、改一张(名字、描述、别名、焦点、默认 BGM、启用)、
 * 设为默认(挪到第一个)、删、上传(添加几张 / 替换一张)。
 *
 * 编辑器手上拿的是这个包的完整列表(背景、曲子、CG 都在),每次改完把整份交给 PackSync.scene ——
 * 这张卡正绑着这个包的话,游戏里马上换上(useScenePlugin 的 sceneLists → mergeBoundScene)。
 * 显示和操作只看 kind 那一类。和立绘编辑器一样:按包换 key,换一个包就是新的编辑器。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { debugApi, type SceneAsset, type SceneAssetPatch } from '../../lib/api';
import { labelFromFile, uniqueLabel } from '../../lib/assetNames';
import type { Notify, PackSync } from '../types';
import { clearBgmRefs, withKindOrder, type SceneSide } from './sceneEdit';
import { defaultSpriteId, selectAfterDelete } from './spriteEdit';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 包里这一类的(CG 差分不算;背景、曲子本来也没有 parent) */
const ofKind = (all: readonly SceneAsset[], kind: SceneSide) => all.filter((a) => a.kind === kind && !a.parent_id);

/** 背景能用的图、曲子能用的音频(和后端 sniff_image_mime / sniff_audio_mime 认的一样) */
export const SCENE_ACCEPT: Record<SceneSide, string> = {
  bg: 'image/png,image/jpeg,image/webp,image/gif',
  bgm: 'audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac',
};
const ACCEPTS: Record<SceneSide, (f: File) => boolean> = {
  bg: (f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name),
  bgm: (f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|wav|flac)$/i.test(f.name),
};
const NOUN: Record<SceneSide, { one: string; unit: string; fallback: string; only: string }> = {
  bg: { one: '背景', unit: '张', fallback: '场景', only: '只支持 PNG / JPEG / WebP / GIF 图片' },
  bgm: { one: '曲子', unit: '首', fallback: '音乐', only: '只支持 MP3 / M4A / AAC / OGG / WAV / FLAC 音频' },
};

/** 正在上传的一个:wait 排队、up 正在传、fail 没传上(过几秒消失);url 是本地预览(只有图有) */
export interface SceneUploadTile {
  key: string;
  name: string;
  url: string | null;
  state: 'wait' | 'up' | 'fail';
}

export const UPLOAD_STATE: Record<SceneUploadTile['state'], string> = { wait: '等待上传', up: '上传中', fail: '没传上' };

export interface SceneAssetsOptions {
  packId: string;
  kind: SceneSide;
  sync: PackSync;
  notify: Notify;
  /** 一进来就上传这些(「上传 … 新建一套」建好包以后交过来);nonce 变了才算新的一批 */
  incoming?: { nonce: number; files: File[] } | null;
  /** 收下了 incoming 那一批:外面把它清掉,再切回这个包时不会重传 */
  onIncomingTaken?: () => void;
  /** 列表变了(张数、第一张):包页签跟着换 */
  onAssets?: (packId: string, list: SceneAsset[]) => void;
  /** 删了一首曲子:别的包里把它当默认 BGM 的背景,后端也清掉了;外面照着改手上的列表 */
  onRemoved?: (assetId: string) => void;
}

export function useSceneAssets({ packId, kind, sync, notify, incoming, onIncomingTaken, onAssets, onRemoved }: SceneAssetsOptions) {
  const [list, setList] = useState<SceneAsset[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<SceneUploadTile[]>([]);
  const [busy, setBusy] = useState(false);

  // 回调里要最新的列表和外面给的函数(上传是一个个接着传的,中间列表一直在变)
  const latest = useRef<SceneAsset[]>([]);
  const outer = useRef({ sync, notify, onAssets, onRemoved });
  useEffect(() => {
    outer.current = { sync, notify, onAssets, onRemoved };
  });

  /** 收下新的完整列表:自己显示、交给 DebugApp(这张卡绑着就同步进游戏)、告诉外面 */
  const commit = useCallback(
    (next: SceneAsset[]) => {
      latest.current = next;
      setList(next);
      outer.current.sync.scene(packId, next);
      outer.current.onAssets?.(packId, next);
    },
    [packId],
  );

  const reload = useCallback(async () => {
    try {
      commit(await debugApi.listSceneAssets(packId));
    } catch {
      // 读不到就留着现在的;出错的那一下已经报过了
    }
  }, [commit, packId]);

  /** 跑一个改后端的操作;失败了报错、重新读一遍(本地可能已经先改了) */
  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      try {
        await fn();
        return true;
      } catch (e) {
        outer.current.notify('error', errText(e));
        await reload();
        return false;
      }
    },
    [reload],
  );

  // ---- 读进来 ----
  useEffect(() => {
    let alive = true;
    debugApi
      .listSceneAssets(packId)
      .then((all) => {
        if (!alive) return;
        latest.current = all;
        setList(all);
        const mine = ofKind(all, kind);
        setSelectedId(defaultSpriteId(mine) ?? mine[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setList([]);
        outer.current.notify('error', `${NOUN[kind].one}读取失败: ${errText(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [packId, kind]);

  // ---- 改 ----
  const replaceRow = (row: SceneAsset) => commit(latest.current.map((a) => (a.id === row.id ? row : a)));

  const patch = (id: string, body: SceneAssetPatch) =>
    run(async () => replaceRow(await debugApi.updateSceneAsset(packId, id, body)));

  /** 设为默认 = 挪到这一类的第一个(和插件页、游戏里一样:排第一的、没停用的就是默认) */
  const makeDefault = (id: string) => {
    const ids = [id, ...ofKind(latest.current, kind).map((a) => a.id).filter((x) => x !== id)];
    setBusy(true);
    void run(async () => {
      const rows = await debugApi.reorderSceneAssets(packId, kind, ids);
      commit(withKindOrder(latest.current, kind, rows));
    }).finally(() => setBusy(false));
  };

  const remove = (id: string) =>
    void run(async () => {
      await debugApi.deleteSceneAsset(packId, id);
      const ids = ofKind(latest.current, kind).map((a) => a.id);
      const rest = latest.current.filter((a) => a.id !== id);
      // 删的是曲子:后端把指向它的默认 BGM(哪个包的背景都算)清掉了,这个包里的照着改,别的包交给外面
      commit(kind === 'bgm' ? clearBgmRefs(rest, id) : rest);
      setSelectedId(selectAfterDelete(ids, id));
      if (kind === 'bgm') outer.current.onRemoved?.(id);
      // 张数、封面曲(删的是封面曲就回到默认)记在包上
      outer.current.sync.packs('scene');
    });

  // ---- 上传:添加几个、替换一个 ----
  const addFiles = useCallback(
    async (files: File[]) => {
      const noun = NOUN[kind];
      const ok = files.filter(ACCEPTS[kind]);
      if (ok.length === 0) {
        outer.current.notify('error', noun.only);
        return;
      }
      const stamp = Date.now();
      const batch = ok.map((file, i) => ({
        file,
        tile: {
          key: `${stamp}-${i}`,
          name: labelFromFile(file.name) || noun.fallback,
          url: kind === 'bg' ? URL.createObjectURL(file) : null,
          state: 'wait' as const,
        },
      }));
      const revoke = (t: SceneUploadTile) => t.url && URL.revokeObjectURL(t.url);
      setUploads((u) => [...u, ...batch.map((b) => b.tile)]);
      const mark = (key: string, state: SceneUploadTile['state']) =>
        setUploads((u) => u.map((t) => (t.key === key ? { ...t, state } : t)));
      const drop = (keys: string[]) => setUploads((u) => u.filter((t) => !keys.includes(t.key)));

      // 已经占用的名字(含别名),新的避开:食堂、食堂2…
      const taken = new Set(
        ofKind(latest.current, kind)
          .flatMap((a) => [a.label, ...a.aliases])
          .map((n) => n.toLowerCase()),
      );
      const failed: { tile: SceneUploadTile; name: string }[] = [];
      let lastError = '';
      let firstNew: string | null = null;
      for (const { file, tile } of batch) {
        mark(tile.key, 'up');
        let created: SceneAsset | null = null;
        try {
          created = await debugApi.createSceneAsset(packId, {
            kind,
            label: uniqueLabel(labelFromFile(file.name), noun.fallback, taken),
          });
          const row = await debugApi.uploadSceneFile(packId, created.id, file);
          // 先接在最后(各类自己的先后不乱);传完整批再按后端的顺序读一遍
          commit([...latest.current, row]);
          firstNew ??= row.id;
          drop([tile.key]);
          revoke(tile);
        } catch (e) {
          lastError = errText(e);
          failed.push({ tile, name: file.name });
          mark(tile.key, 'fail');
          // 建好了行、文件没传上:别留一个空的
          if (created) await debugApi.deleteSceneAsset(packId, created.id).catch(() => undefined);
        }
      }
      await reload();
      outer.current.sync.packs('scene');
      // 刚才没东西可选(新包)就选上传上的第一个
      if (firstNew) setSelectedId((cur) => cur ?? firstNew);
      const done = batch.length - failed.length;
      if (failed.length === 0) {
        outer.current.notify(
          'ok',
          kind === 'bg'
            ? `已添加 ${done} 张背景 · 名字用的是文件名,改成 AI 好懂的地点更准`
            : `已添加 ${done} 首曲子 · 名字用的是文件名,按气氛改名(日常、温馨…)AI 更好挑`,
        );
      } else {
        const names = failed.map((f) => f.name);
        outer.current.notify(
          'error',
          `${done ? `传上了 ${done} ${noun.unit};` : ''}${names.slice(0, 3).join('、')}${names.length > 3 ? ` 等 ${names.length} 个` : ''}没传上:${lastError}`,
        );
        window.setTimeout(() => {
          drop(failed.map((f) => f.tile.key));
          failed.forEach((f) => revoke(f.tile));
        }, 5000);
      }
    },
    [commit, packId, kind, reload],
  );

  const replaceFile = (id: string, file: File) => {
    if (!ACCEPTS[kind](file)) {
      outer.current.notify('error', NOUN[kind].only);
      return;
    }
    void run(async () => replaceRow(await debugApi.uploadSceneFile(packId, id, file)));
  };

  // 外面交过来的一批(新建一套时选的文件):读完列表再传,一批只传一次(开发模式下 effect 会跑两遍)
  const handled = useRef<number | null>(null);
  const takenRef = useRef(onIncomingTaken);
  useEffect(() => {
    takenRef.current = onIncomingTaken;
  });
  const loaded = list !== null;
  useEffect(() => {
    if (!incoming || !loaded || handled.current === incoming.nonce) return;
    handled.current = incoming.nonce;
    takenRef.current?.();
    void addFiles(incoming.files);
  }, [incoming, loaded, addFiles]);

  const items = list ? ofKind(list, kind) : [];
  const selected = items.find((a) => a.id === selectedId) ?? items[0] ?? null;

  return {
    /** 包的完整列表(还没读到是 null) */
    list,
    /** 这一类(背景 / 曲子)的,按顺序 */
    items,
    selected,
    setSelectedId,
    /** 排第一的、没停用的:默认背景 / 排第一的曲子 */
    defaultId: defaultSpriteId(items),
    uploads,
    busy,
    patch,
    makeDefault,
    remove,
    addFiles,
    replaceFile,
  };
}
