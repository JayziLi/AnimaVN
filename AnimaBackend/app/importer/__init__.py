"""拖进来就认的导入(素材架构第 1 步第 3 段;设计稿 6.3、6.4)。

一次导入分三步,每步一个模块:
1. staging.py 先把拖进来的文件(和 zip 解开的内容)放进暂存目录 data/import-staging/<plan_id>/files/,
   路径、文件名、大小都在这里把关;sniff.py 按文件头认每个文件是什么(卡、图、音频、清单……);
   cards.py 读酒馆卡,结果和前端导入卡时 POST 的那份一字不差。
2. classify.py(B4)照着暂存目录里的文件出一份导入计划:建哪些卡和包、绑到哪张卡、哪些没认出来;
   英文表情名配的中文别名、认「这批图是不是表情」用的词表在 aliases.py(小字典,设计稿 1.7)。
3. apply.py(B5)在一个事务里照计划建卡、建包、绑定,记一条能撤销的导入记录(import_jobs);
   曲子按 audio.py 存(OGG / FLAC / WAV 转成 m4a)。jobs.py 管导入记录:列出来、导完认领没认出来的文件、撤销。
接口在 app/api/importer.py(/api/import/...)。
"""
