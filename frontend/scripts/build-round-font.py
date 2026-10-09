import os
import py7zr
from fontTools.ttLib import TTFont
from fontTools import subset

# 生成 public/vn/fonts/rhr-core.woff2、rhr-extra.woff2(对话框文字的「圆体」)。
# 用法:把 Resource-Han-Rounded 的 RHR-CFF2-CN-1.910.7z 存成 rhr-cn.7z 放到 HERE(默认是脚本旁边,
# 或设环境变量 RHR_DIR),pip install fonttools brotli py7zr,再跑这个脚本
HERE = os.environ.get('RHR_DIR') or os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'vn', 'fonts')
os.makedirs(OUT, exist_ok=True)
os.chdir(HERE)

if not os.path.exists('ResourceHanRoundedCN-VF.otf'):
    with py7zr.SevenZipFile('rhr-cn.7z') as z:
        z.extractall('.')

font = TTFont('ResourceHanRoundedCN-VF.otf')
print('axes', [(a.axisTag, a.minValue, a.maxValue) for a in font['fvar'].axes])
# 转静态会在 GPOS 上报字形顺序不一致:直接用可变字体取子集,粗细在 CSS 里定
cmap = set(font.getBestCmap())


def gb2312(level):
    """GB2312 一级(16-55 区)/ 二级(56-87 区)汉字"""
    rows = range(16, 56) if level == 1 else range(56, 88)
    out = []
    for r in rows:
        for c in range(1, 95):
            try:
                out.append(ord(bytes([r + 0xA0, c + 0xA0]).decode('gb2312')))
            except UnicodeDecodeError:
                pass
    return out


base = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100)) | set(range(0x2000, 0x2070)) \
    | set(range(0x2190, 0x2200)) | set(range(0x2460, 0x2500)) | set(range(0x25A0, 0x2700)) \
    | set(range(0x3000, 0x3100)) | set(range(0xFF00, 0xFFF0)) | set(range(0x31F0, 0x3200))
core = (base | set(gb2312(1))) & cmap
# 二级字 + 常见的繁体 / 日文汉字(CJK 基本区里剩下的,太多就只取到一定量)
extra = (set(gb2312(2)) & cmap) - core
cjk_rest = sorted(c for c in cmap if 0x4E00 <= c <= 0x9FFF and c not in core and c not in extra)
# extra |= set(cjk_rest)  # 整个 CJK 区太大(12 MB),只放二级字


def ranges(cps):
    cps = sorted(cps)
    out = []
    start = prev = cps[0]
    for c in cps[1:]:
        if c == prev + 1:
            prev = c
            continue
        out.append((start, prev))
        start = prev = c
    out.append((start, prev))
    return ', '.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in out)


def build(name, cps):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    f = TTFont('ResourceHanRoundedCN-VF.otf')
    s = subset.Subsetter(opts)
    s.populate(unicodes=cps)
    s.subset(f)
    path = os.path.join(OUT, name)
    f.flavor = 'woff2'
    f.save(path)
    print(name, len(cps), os.path.getsize(path) // 1024, 'KB')


build('rhr-core.woff2', core)
build('rhr-extra.woff2', extra)
open(os.path.join(HERE, 'ranges.txt'), 'w').write('CORE\n' + ranges(core) + '\nEXTRA\n' + ranges(extra) + '\n')
print('ranges written')
