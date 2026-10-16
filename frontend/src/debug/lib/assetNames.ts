/**
 * 上传素材时起名字:文件名当差分名 / 背景名 / 曲名,撞名了加个数字。
 * 插件页和卡编辑器共用(以前在 PluginsDrawer.tsx 里)。
 */

import { LABEL_MAX, stripLabelForbidden } from '../plugins/common';

/** 文件名 → 名字:去扩展名,去掉模板里会出问题的括号,截到名字的长度上限 */
export function labelFromFile(name: string): string {
  return stripLabelForbidden(name.replace(/\.[^.]+$/, ''))
    .trim()
    .slice(0, LABEL_MAX);
}

/** 从已占用的名字(小写)里挑一个不撞的:食堂、食堂2、食堂3…;挑中的也记进 taken */
export function uniqueLabel(base: string, fallback: string, taken: Set<string>): string {
  const root = base || fallback;
  let name = root;
  let i = 2;
  while (taken.has(name.toLowerCase())) name = `${root}${i++}`;
  taken.add(name.toLowerCase());
  return name;
}
