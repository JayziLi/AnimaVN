"""角色打包带走(素材架构第 3 步;设计稿 6.1、6.8,技术计划 plans/2026-10-17-asset-arch-step3-impl.md 的「格式」)。

- collect.py  从一张卡(连同整组状态)收齐要带的行和文件;单个包同理
- write.py    写成 zip(.animavn / .animapack)
- read.py     读清单、校验(导入时用)
- restore.py  照清单建新行,全部换新编号

不带声音(第 4 步)、实验卡带的素材、人设、对话、全局设置(只取这张卡绑的那套预设)、任何 secret.*。
这里是内核:不 import 卡带;按卡设置(card_prefs)当普通 JSON 处理。
"""
