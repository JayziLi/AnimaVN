// 自动生成,别手改;改 AnimaBackend/app/contracts.py 以后,在 AnimaBackend 下跑 python -m app.contracts

/** 名字(表情名、素材名、别名 —— AI 要在标签里点名的)最长几个字 */
export const LABEL_MAX = 40;

/**
 * 名字里不许用的字符:表情名会被塞进用户自定义的标签模板里(比如 <sprite:{表情}>、【{表情}】),
 * 名字里带这些括号,解析器就分不清标签在哪里结束了
 */
export const LABEL_FORBIDDEN = '\n\r<>[]{}【】「」';

/** 图片接口 ?w= 前端会要的宽度:立绘 电脑 1280 / 触屏 1024。后端启动后按这几个宽度先转一遍(app/images.py) */
export const SPRITE_WIDTHS = { desktop: 1280, touch: 1024 } as const;

/** 背景、CG:游戏里铺满屏幕,电脑 1920 / 触屏 1280 */
export const SCENE_WIDTHS = { desktop: 1920, touch: 1280 } as const;

/** Jev 说话人门槛(判成「不是主角说的」要有这么大把握):默认、可调范围 */
export const SPEAKER_THRESHOLD = { default: 0.8, min: 0.5, max: 0.95 } as const;

/** Jev 换背景 / 音乐 / CG 的门槛:默认、可调范围 */
export const SWITCH_THRESHOLD = { default: 0.6, min: 0.3, max: 0.95 } as const;

/** IndexTTS 情绪向量的 8 维,顺序是 IndexTTS 官方定的 */
export const EMO_DIMS = ['高兴', '愤怒', '悲伤', '害怕', '厌恶', '忧郁', '惊讶', '平静'] as const;

/**
 * 情绪向量每维 0–1.2,合计不超过 1.5 —— 再高会明显影响音色相似度
 * (见 docs/superpowers/specs/2026-09-24-indextts-engine-design.md)
 */
export const EMO_DIM_MAX = 1.2;

/** 情绪向量各维加起来的上限(见 EMO_DIM_MAX) */
export const EMO_SUM_MAX = 1.5;

/**
 * 没配立绘的卡用的内置基础表情:{{sprites}} 展开成它们,立绘标签也拿它们当候选。
 * 每组是(名字, 别名);app/tts/emotion_presets.py 的 IndexTTS 默认向量正好覆盖每一项
 */
export const BUILTIN_EMOTIONS = [
  { label: '平静', aliases: ['normal', 'calm', 'neutral', '说话', 'talk', '默认'] },
  { label: '微笑', aliases: ['smile'] },
  { label: '开心', aliases: ['高兴', 'happy'] },
  { label: '温柔', aliases: ['gentle'] },
  { label: '认真', aliases: ['serious'] },
  { label: '担心', aliases: ['worried'] },
  { label: '难过', aliases: ['伤心', 'sad'] },
  { label: '哭', aliases: ['cry'] },
  { label: '惊讶', aliases: ['surprised'] },
  { label: '慌张', aliases: ['flustered'] },
  { label: '害羞', aliases: ['脸红', 'shy'] },
  { label: '疑惑', aliases: ['confused'] },
  { label: '生气', aliases: ['angry'] },
  { label: '害怕', aliases: ['afraid', 'scared'] },
  { label: '厌恶', aliases: ['嫌弃', 'disgusted'] },
  { label: '忧郁', aliases: ['失落', 'melancholic'] },
] as const;

/** 语音服务那台机器上参考音频的命名:【情绪】原文.wav,取出情绪名和原文(Python 和 JS 的正则都认这一句) */
export const REF_NAME_PATTERN = '^【([^】]+)】(.+)\\.[A-Za-z0-9]+$';
