"""出图后端:每种画图连接一个(设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 4 节)。
这里不 import 子模块:nai.py 要 import base.py,在这里 import novelai.py 会绕成循环"""
