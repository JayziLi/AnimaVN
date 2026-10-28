/**
 * 插件抽屉里卡带的那一页(第 2 步 D5):AI 生图(角色组)、实验组的卡带。页头是同一个骨架(名字、BETA、问号、
 * 「{卡}在用」),下面是卡带自己画的内容(它自己的分页照旧);开关在左栏这一行的行尾。
 * 内核不按卡带的名字认它们:问号、去卡编辑器的哪一栏都由卡带自己在 CartridgePanel 上说。
 */

import type { VoiceProfile } from '../../../lib/api';
import type { CartridgePanel } from '../../../plugins/cartridges';
import type { DrawerCardFacts } from '../cardView';
import { PageFooter, PageHead, PageShell } from '../frame';
import { useDrawerSkin } from '../skinContext';
import { inUseOf, type PageLinks } from './pageModel';

export function CartridgePage(p: {
  panel: CartridgePanel;
  facts: DrawerCardFacts | null;
  card: { id: string; name: string } | null;
  profiles: readonly VoiceProfile[];
  links: PageLinks;
}) {
  const { panel, facts, card } = p;
  const name = card?.name || '这张卡';
  const { game } = useDrawerSkin();
  const studio = panel.studio;
  // 游戏皮:中间 = 页头 + 卡带自己画的那块;右栏只有底部跳转(设计稿声线分档那页右栏也是空的)
  return (
    <PageShell
      title={panel.title}
      head={
        <PageHead
          title={panel.title}
          beta={panel.beta}
          tip={panel.tip}
          inUse={panel.inUse && facts ? inUseOf(name, panel.inUse(facts)) : null}
          tags={[]}
        />
      }
      preview={<div className="dw-cart">{panel.render({ profiles: p.profiles, card, mainVoice: facts?.mainVoice ?? null, game })}</div>}
      common={null}
      footer={
        studio ? <PageFooter links={[{ text: `卡编辑器 · ${name}的${studio.label}`, onClick: () => p.links.studio(studio.slot) }]} /> : null
      }
    />
  );
}
