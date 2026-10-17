# Windows 整合包

给不想装 Python / Node 的玩家：解压，双击 `AnimaVN.bat` 就能玩。这个文件夹是打包用的，玩家用不到。

## 打包

在装好后端依赖、跑过测试的 venv 里（Python 3.11，Windows），前端先 `npm install` 过：

```powershell
AnimaBackend\.venv\Scripts\python packaging\windows\build.py --version 2026.10.17
```

出来的东西在 `packaging/windows/out/`：

| 文件 | 是什么 |
|---|---|
| `AnimaVN-<版本>-windows.zip` | 整合包，约 155 MB |
| `AnimaVN-<版本>-update.zip` | 更新包，约 21 MB：只有代码和页面，「更新.bat」下载的就是它 |
| `latest.json` | 更新器读的：最新版本、运行环境指纹、两个包的大小和 SHA-256 |
| `stage/AnimaVN/` | 解压后的样子，可以直接双击里面的 `AnimaVN.bat` 试 |

发布时把这三个文件传到 `sources.json` 里的每个下载源。先传两个 zip，最后传 `latest.json`，不然更新器会读到指向还不存在的文件的版本信息。

## 包里有什么

```
AnimaVN/
├─ AnimaVN.bat        双击开始玩（launcher/start.py）
├─ 更新.bat           双击更新（launcher/update.py）
├─ 使用说明.txt
├─ launcher/          启动器、更新器、version.json（版本、运行环境指纹、下载源）
├─ python/            官方便携版 Python 3.11.9 + 两个 VC++ 运行库 dll
└─ runtime.zip        依赖、后端、打包好的页面、情绪模型：第一次启动时解开，解完删掉
```

- **为什么里面再套一层 zip**：解压完有五千多个小文件，Windows 自带的解压一万个文件要一两个小时。外层只剩几十个文件，几秒就能解开；里面这层第一次启动时由 Python 自己解。
- **页面和接口在同一个端口**（默认 8000，被占了就往后找），前端用 `VITE_API_BASE_URL=""` 打包，不需要 Node。
- **同一个文件夹只开一个后端**：`AnimaBackend/data/launcher.lock` 锁着。第二次双击会直接打开已经开着的那个；游戏开着时更新器也不会动。

## 依赖版本和更新

- `requirements.lock` 记着包里每个依赖的版本，打包按它装。要换版本时加 `--refresh-lock`，会按当前 venv 里装的版本重新生成。
- 运行环境指纹由 Python 版本、lock 和情绪模型算出来。指纹不变时，玩家双击「更新.bat」只下更新包，换掉 `AnimaBackend/app`、`web`、`launcher` 和两个 bat；存档 `AnimaBackend/data` 不动。指纹变了时，正在跑的 Python 换不掉自己，更新器会打开下载页，让玩家重下整合包、把 `data` 拷过去。所以 lock 别顺手改。

## 测试

```powershell
AnimaBackend\.venv\Scripts\python -m pytest packaging\windows\tests -q -p no:cacheprovider
```
