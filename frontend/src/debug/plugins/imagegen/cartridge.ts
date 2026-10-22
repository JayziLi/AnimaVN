/**
 * 生图卡带(BETA,设计 docs/superpowers/specs/2026-10-11-novelai-image-gen-design.md):
 * 视觉小说里点「画」或者自动出图时,指导模型读剧情写画面,NovelAI 画出来,在那一句像 CG 一样淡入。
 * 内核只通过 useIllustrations 这个扩展点(plugins/illustrations.ts)用它。
 * 生成公开版时删这个文件夹(和后端 app/plugins/imagegen/、tests/plugins/imagegen/;公网第一期不做)。
 */

import type { Cartridge } from '../cartridges';
import { useImageGen } from './useImageGen';

const cartridge: Cartridge = {
  id: 'imagegen',
  name: 'AI 生图',
  beta: true,
  useIllustrations: useImageGen,
};

export default cartridge;
