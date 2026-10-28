import os
import re
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

# 生成界面改版 U1 的宋体和斜体英文:public/vn/fonts/ 下 4 个 woff2(@font-face 手写在 src/debug/vn/vnFonts.css)。
#   nss-core.woff2         Noto Serif SC 可变字体(粗细 200-900)子集:GB2312 一级 + 标点、假名、拉丁 + 界面上用到的其他字
#   nss-extra.woff2        GB2312 二级 + JIS 第一水准里 GB2312 没有的日文汉字(気 話 髪…)+ 少量补字
#   cormorant.woff2        Cormorant Garamond 正体可变字体(300-700),只要拉丁
#   cormorant-italic.woff2 Cormorant Garamond 斜体可变字体(300-700),只要拉丁
# 用法:从 github.com/google/fonts(SIL OFL 1.1)下载 ofl/notoserifsc/NotoSerifSC[wght].ttf、
#   ofl/cormorantgaramond/CormorantGaramond[wght].ttf 和 CormorantGaramond-Italic[wght].ttf,放到 SERIF_SRC
#   (默认是脚本旁边),pip install fonttools brotli,再跑这个脚本。
#   加 --scan [文件夹]:只列出界面代码(默认 ../src)里新出现、宋体里有、但还不在 core 的字,要的话抄进 UI_EXTRA
#   (正则里写的区间端点 㐀 鿿 豈 这类不用管)。
# 输出转给管道 / 文件时 Windows 默认按 GBK 写,--scan 列出的字(㐀 这类)会报错;统一按 UTF-8 写
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get('SERIF_SRC') or HERE
OUT = os.environ.get('SERIF_OUT') or os.path.join(HERE, '..', 'public', 'vn', 'fonts')
SERIF = os.path.join(SRC, 'NotoSerifSC[wght].ttf')
LATIN = os.path.join(SRC, 'CormorantGaramond[wght].ttf')
LATIN_I = os.path.join(SRC, 'CormorantGaramond-Italic[wght].ttf')

# 界面上用到、但不在 GB2312 一级里的字(游戏代码 frontend/src + 设计稿 docs/design/unify,2026-10-25 扫的)
UI_EXTRA = 'τ−≈≡≤≥⋯⌘✓兀処別勢協叩叱咚咦咧唔唧啵啾嗒嗯嘀嘟嘬場塊変夢娅嬉実対尬尴尻師帰広強後復応恵愣抜掛掰撫攥昵時晩様機欸歩毎気決浏涙淇渲焼煲珀琥産療発盹確約紙経結給絶緒缶翩聞茉莺菓葉補見覚観訳試詰話誌認誕談識诶販責買費軽輩辺込週遅過違遠選酔鏡長開間関隣雲響預頬頭顔願風飲馨駅駆骰魅魚鮮'
# 真实聊天里出现 10 次以上、GB2312 两级和 JIS 第一水准都没有的字
SUPPLEMENT = '窸窣綺頷咥囁苺呟滲攣痙餡唸嚙撐瞼曖囃贅軋箋'
# 宋体去掉会多带字形、又用不到的特性(aalt dlig hist fwid hwid pwid ruby);竖排、标点挤压、kern 留着
SERIF_FEATURES = ['ccmp', 'liga', 'locl', 'vert', 'vrt2', 'kern', 'mark', 'palt', 'halt', 'chws', 'vchw', 'vhal', 'vkrn', 'vpal']
LATIN_FEATURES = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'lnum', 'onum', 'tnum', 'pnum', 'case']


def rng(a, b):
    return set(range(a, b + 1))


def kanji(codec, rows):
    """GB2312 / JIS X 0208 某几区的汉字(区号 + 0xA0 = 编码的第一个字节)"""
    out = set()
    for r in rows:
        for c in range(1, 95):
            try:
                ch = bytes([r + 0xA0, c + 0xA0]).decode(codec)
            except UnicodeDecodeError:
                continue
            if len(ch) == 1:
                out.add(ord(ch))
    return out


GB1 = kanji('gb2312', range(16, 56))  # 一级 3755 字
GB2 = kanji('gb2312', range(56, 88))  # 二级 3008 字
JIS1 = kanji('euc_jp', range(16, 48))  # 第一水准 2965 字
# 基础区和圆体一样(ASCII、Latin-1、标点、箭头、带圈数字、几何 + 杂项符号、CJK 标点 + 假名、全角),多一段制表符(─)
BASE = (rng(0x20, 0x7E) | rng(0xA0, 0xFF) | rng(0x2000, 0x206F) | rng(0x2190, 0x21FF) | rng(0x2460, 0x24FF)
        | rng(0x2500, 0x257F) | rng(0x25A0, 0x26FF) | rng(0x3000, 0x30FF) | rng(0x31F0, 0x31FF) | rng(0xFF00, 0xFFEF))
LATIN_CPS = (rng(0x20, 0x7E) | rng(0xA0, 0xFF) | {0x131, 0x152, 0x153, 0x2C6, 0x2DA, 0x2DC} | rng(0x2010, 0x2027)
             | rng(0x2030, 0x203A) | {0x2044, 0x20AC, 0x2116, 0x2122, 0x2212, 0x2215} | rng(0x2190, 0x2193))

have = set(TTFont(SERIF, lazy=True).getBestCmap())
core = (BASE | GB1 | {ord(c) for c in UI_EXTRA}) & have
extra = ((GB2 | JIS1 | {ord(c) for c in SUPPLEMENT}) & have) - core

if '--scan' in sys.argv:
    root = next((a for a in sys.argv[1:] if a != '--scan'), os.path.join(HERE, '..', 'src'))
    found = set()
    for dp, _, fns in os.walk(root):
        for fn in fns:
            if re.search(r'\.(tsx?|css)$', fn) and not re.search(r'\.(test|spec)\.', fn):
                text = open(os.path.join(dp, fn), encoding='utf-8').read()
                text = re.sub(r'/\*.*?\*/|(?<![:\'"])//[^\n]*', '', text, flags=re.S)
                found |= {ord(c) for c in text}
    new = sorted(c for c in found if c > 0x7E and c in have and c not in core)
    print(''.join(map(chr, new)) or '没有新字')
    sys.exit()


def ranges(cps):
    cps = sorted(cps)
    segs, start, prev = [], cps[0], cps[0]
    for c in cps[1:]:
        if c != prev + 1:
            segs.append((start, prev))
            start = c
        prev = c
    segs.append((start, prev))
    return ', '.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in segs)


def build(src, name, cps, features):
    opts = subset.Options()
    opts.layout_features = features
    opts.name_IDs = ['*']  # 留着版权和许可证那几条
    opts.notdef_outline = True
    f = TTFont(src)
    s = subset.Subsetter(opts)
    s.populate(unicodes=cps)
    s.subset(f)
    f.flavor = 'woff2'
    f.save(os.path.join(OUT, name))
    print(name, len(cps), 'chars', os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')


os.makedirs(OUT, exist_ok=True)
build(SERIF, 'nss-core.woff2', core, SERIF_FEATURES)
build(SERIF, 'nss-extra.woff2', extra, SERIF_FEATURES)
latin = LATIN_CPS & set(TTFont(LATIN, lazy=True).getBestCmap())
latin_i = LATIN_CPS & set(TTFont(LATIN_I, lazy=True).getBestCmap())
build(LATIN, 'cormorant.woff2', latin, LATIN_FEATURES)
build(LATIN_I, 'cormorant-italic.woff2', latin_i, LATIN_FEATURES)
# 每个文件的精确码位表,写在下载文件夹旁边备查(不进仓库;CSS 里 extra 只写 U+4E00-9FFF 就够)
with open(os.path.join(SRC, 'serif-ranges.txt'), 'w', encoding='utf-8') as fh:
    fh.write(f'CORE\n{ranges(core)}\nEXTRA\n{ranges(extra)}\nLATIN\n{ranges(latin)}\n')
print('ranges written')
