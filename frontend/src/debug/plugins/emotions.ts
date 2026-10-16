/**
 * 没配立绘的卡用的内置基础表情:{{sprites}} 展开成它们,立绘标签也拿它们当候选。
 * 表只在 AnimaBackend/app/contracts.py 写一份(每组是名字和别名),前端这份是生成的(generated/contracts.ts);
 * 后端 tts/emotion_presets.py 的 IndexTTS 默认向量正好覆盖每一项(后端有测试对照)
 */
import { BUILTIN_EMOTIONS as TABLE } from '../generated/contracts';

export const BUILTIN_EMOTIONS: readonly { label: string; aliases: readonly string[] }[] = TABLE;
