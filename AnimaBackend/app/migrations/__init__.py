"""数据库迁移器:启动时自动、安全地升级库结构。设计见
docs/superpowers/specs/2026-10-09-asset-architecture-design.md 第 8.2 节。

一步一个 Step,按顺序登记在 registry.STEPS。启动时按 settings.migrations_mode 决定:
- apply(第 3 期起默认):有待做的步骤时先整库备份,再一步一个事务地升级
- report(第 0–2 期默认):只看、只报告,一个字节都不写
- off:什么都不做(测试里用)
命令行见 __main__.py。
"""
