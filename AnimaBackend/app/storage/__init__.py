"""文件仓库(素材架构设计第 4 节,第 3 期):图、曲子(还有卡带登记的素材)按内容的 sha256 存成文件。

blobs.py 写读文件;refs.py 哪些表的哪一列存着素材、对应哪个 sha 列;copy.py 把库里的原件复制进来;
maintenance.py 手动备份、清理没人用的文件、体检、设置页的概况;/api/blobs 在 app/api/blobs.py;命令行见 __main__.py。
第 3 期前半只复制,库里的原件一张不动(storage_files 关掉就回到读库);置空库里的原件是后半的事(slim.py)。
瘦身以后新写进来的原件(refs.save)在 storage_files 开着时也只进仓库,库里那一列留空;关着时照旧库里也存一份。
"""
