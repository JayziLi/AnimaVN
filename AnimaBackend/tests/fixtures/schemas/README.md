# 三代库的表结构夹具

迁移器要能认出、升级三代库(设计稿 8.2)。这里只有表结构,没有数据。

| 文件 | 哪一代 | 怎么来的 |
|---|---|---|
| `g1_master.sql` | 公开版 / master(立绘还挂在卡上) | `git show 070f051:userdata/schema.sql`(09-27 的数据快照) |
| `g2_play.sql` | 公网试玩站(分支 feat/public-play) | 在 AnimaVN-play/AnimaBackend 目录下:`python <这里>/dump_schema.py --models app.models,app.play.models <输出>` |
| `g3_local.sql` | 本机(分支 feat/jev-sprite-fx-vn-redesign,10-10 的库) | `python dump_schema.py --db <本机库> <输出>`(只读) |

以后哪一代的结构变了,照这个表重新生成。
