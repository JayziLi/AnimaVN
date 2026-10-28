/**
 * 游戏里导完了:「导入完成 Imported」纸卡(设计稿 kit/transfer.js 的 done + doneList,导入导出页 A / 整合版):
 * 左边她的卡面(选角色同款),右边导进来的几样 —— 宋体名目 + 斜体英文 | 值 | 小头像 / 小横图,和选角色右边那几条同一个样子;
 * 没认出来的文件一行一个「立绘 / 背景 / BGM / CG / 不要」(选了马上认领);底下只有「确定」(10-23 用户:「直接确定就好」)。
 * 调试台里导完还是打开卡编辑器的素材页、顶上一行提示(DebugApp 的 finishImport)。
 *
 * 写什么:这张卡现在绑着的(和选角色右边同一份数据,vn/pick/pickBind),只列这次导入新建了的那几类
 * (后端回的 created;老后端没有 created 就全列)。
 */

import { useEffect, useState } from 'react';
import { spriteThumbUrl, type ClassifyKind, type ImportCreated } from '../lib/api';
import type { ImportNotice } from '../studio/types';
import { loadPickDetail, type PickDetail } from '../vn/pickDetail';
import { PickTile } from '../vn/pick/PickTile';
import { loadPickBind, loadPickGlobals } from '../vn/pick/pickBind';
import type { PickBind } from '../vn/pick/pickLogic';
import { titleSpriteStyle } from '../vn/titleArt';
import { Help } from '../vn/ui/Help';
import { TransferDialog } from '../components/export/TransferDialog';
import { CLASSIFY_CHOICES, doneRows, fileName } from './importModel';

const FACE_POSE = { faceSize: 0.62, faceTop: 0.18, cx: 0.5 };

export function ImportDoneCard({
  cardId,
  cardName,
  avatar = null,
  notice,
  created,
  onClassify,
  onClose,
}: {
  cardId: string;
  cardName: string;
  /** 卡图(选角色格子上的那张);没有就画 AnimaVN 的标 */
  avatar?: string | null;
  notice: ImportNotice;
  created?: ImportCreated;
  /** 没认出来的文件选成什么;认领完换上新的提示(没认出的少了一个) */
  onClassify: (path: string, kind: ClassifyKind) => Promise<void>;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<PickDetail | null>(null);
  const [bind, setBind] = useState<PickBind | undefined>(undefined);
  const [picking, setPicking] = useState<Record<string, ClassifyKind>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [d, g] = await Promise.all([loadPickDetail(cardId), loadPickGlobals()]);
      if (!alive) return;
      setDetail(d);
      const b = await loadPickBind(cardId, d.card?.last_chat_id ?? null, g);
      if (alive) setBind(b);
    })();
    return () => {
      alive = false;
    };
  }, [cardId]);

  const name = detail?.card?.name ?? cardName;
  const isNew = !created || created.cards.includes(cardId);
  const rows = doneRows(bind, detail?.spriteCount ?? 0, created);

  const classify = async (path: string, kind: ClassifyKind) => {
    setPicking((p) => ({ ...p, [path]: kind }));
    await onClassify(path, kind);
    // 认领成功这一行就没了;失败(已提示)放开按钮能再选
    setPicking((p) => {
      const next = { ...p };
      delete next[path];
      return next;
    });
  };

  return (
    <TransferDialog
      title="导入完成"
      en="Imported"
      width={700}
      className="done"
      onCancel={onClose}
      foot={
        <>
          <span className="tf-flex" />
          <button type="button" className="av-btn primary" autoFocus onClick={onClose}>
            确定
          </button>
        </>
      }
    >
      <div className="tf-db two">
        <span className="tf-cf tf-who" aria-hidden="true">
          <PickTile
            card={{ id: cardId, name, avatar, hasLastChat: false }}
            detail={detail ?? undefined}
            selected={false}
            current={false}
            onPick={() => {}}
            onOpen={() => {}}
          />
        </span>
        <ul className="tf-list">
          {isNew && (
            <li>
              <span className="k">
                <b>角色卡</b>
                <i>Card</i>
              </span>
              <span className="v">
                <span>{name}</span>
              </span>
              <span className="pv" />
            </li>
          )}
          {rows.map((r) => (
            <li key={r.kind}>
              <span className="k">
                <b>{r.k}</b>
                <i>{r.en}</i>
              </span>
              <span className="v">
                <span>{r.v}</span>
                {r.sub && <small>{r.sub}</small>}
              </span>
              <span className="pv">
                {r.kind === 'sprite' && detail && detail.heads.length > 0 && (
                  <span className="tf-faces">
                    {detail.heads.map((h) => {
                      const src = spriteThumbUrl(h.sprite, 80);
                      return (
                        <span key={h.sprite.id} className="tf-head">
                          {src && (
                            <img
                              src={src}
                              style={titleSpriteStyle(h.face, h.sprite.face_scan?.height ?? null, FACE_POSE, 24)}
                              alt=""
                              draggable={false}
                            />
                          )}
                        </span>
                      );
                    })}
                  </span>
                )}
                {r.kind === 'scene' && detail?.bg && <img className="tf-bgt" src={detail.bg} alt="" draggable={false} />}
              </span>
            </li>
          ))}
          {notice.unknown.map((path) => (
            <li key={path} className="unk">
              <span className="k">
                <b>没认出</b>
                <i>Unknown</i>
              </span>
              <span className="v">
                <span>
                  {fileName(path)}
                  <Help tip="选它是什么,归进这次建的同类包;不选就先放着。" />
                </span>
              </span>
              <span className="pv">
                <span className="av-seg tf-dseg" role="group" aria-label={`${fileName(path)} 是什么`}>
                  {CLASSIFY_CHOICES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className={picking[path] === c.value ? 'on' : ''}
                      aria-pressed={picking[path] === c.value}
                      disabled={picking[path] !== undefined}
                      onClick={() => void classify(path, c.value)}
                    >
                      {c.label}
                    </button>
                  ))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </TransferDialog>
  );
}
