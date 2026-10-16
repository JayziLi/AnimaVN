/**
 * 拖进窗口的东西 → 一串 {文件, 相对路径}(导入器上传时 paths 照这个发,后端按文件夹名认立绘 / 背景 / BGM / CG)。
 *
 * - 文件夹用 webkitGetAsEntry 递归读;一个文件夹的 readEntries 一次只给一批(Chrome 一次最多 100 个),
 *   要一直读到给空数组为止。路径带上最上面那层文件夹的名字(「刻晴/立绘（玉衡星）/01_微笑.png」)。
 * - entry 要在 drop 事件里同步拿:事件处理完 items 就作废了,所以先把 entry 全拿到手再慢慢读。
 * - 没有 entry 接口(老浏览器、拖进来的不是本地文件)就用 getAsFile,连 items 都没有就用 dataTransfer.files。
 * - 系统自己留下的 .DS_Store、Thumbs.db、desktop.ini、__MACOSX 不上传;别的(说明文档、语音参考……)照样传,由后端认。
 * - 读不出来的文件跳过,别的照常导入。
 *
 * 参数只要 DataTransfer 上的 items / files 两个字段,测试里用假的 entry 对象。
 */

export interface DroppedFile {
  file: File;
  /** 相对路径,用「/」分隔,带最上面那层文件夹名;单个文件就是文件名 */
  path: string;
}

/** FileSystemEntry 里用到的那几样(真的 FileSystemFileEntry / DirectoryEntry 也满足) */
export interface DropEntry {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  file?(ok: (file: File) => void, err?: (e: unknown) => void): void;
  createReader?(): DropReader;
}

export interface DropReader {
  readEntries(ok: (entries: DropEntry[]) => void, err?: (e: unknown) => void): void;
}

/** DataTransferItem 里用到的那几样 */
export interface DropItem {
  readonly kind: string;
  getAsFile(): File | null;
  webkitGetAsEntry?(): DropEntry | null;
}

export interface DropSource {
  items?: ArrayLike<DropItem> | null;
  files?: ArrayLike<File> | null;
}

const JUNK_FILE = /^(\.ds_store|thumbs\.db|desktop\.ini)$/i;
const JUNK_DIR = /^__macosx$/i;

type Root = { entry: DropEntry } | { file: File };

/** 同步拿到最上面一层:能拿 entry 的拿 entry,拿不到的拿文件 */
function grab(src: DropSource): Root[] {
  const roots: Root[] = [];
  for (const item of Array.from(src.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) {
      roots.push({ entry });
      continue;
    }
    const file = item.getAsFile();
    if (file) roots.push({ file });
  }
  if (roots.length === 0) for (const file of Array.from(src.files ?? [])) roots.push({ file });
  return roots;
}

/** 一个文件夹的全部子项:readEntries 一批一批给,读到空为止;中途出错就用已经读到的 */
async function children(entry: DropEntry): Promise<DropEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const all: DropEntry[] = [];
  for (;;) {
    const batch = await new Promise<DropEntry[] | null>((ok) => reader.readEntries(ok, () => ok(null)));
    if (!batch || batch.length === 0) return all;
    all.push(...batch);
  }
}

function readFile(entry: DropEntry): Promise<File | null> {
  return new Promise((ok) => {
    if (typeof entry.file !== 'function') ok(null);
    else entry.file(ok, () => ok(null));
  });
}

/** 一个 entry 底下的全部文件,按文件夹里的先后 */
async function walk(entry: DropEntry, prefix: string): Promise<DroppedFile[]> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isDirectory) {
    if (JUNK_DIR.test(entry.name)) return [];
    const kids = await children(entry);
    return (await Promise.all(kids.map((k) => walk(k, path)))).flat();
  }
  if (!entry.isFile || JUNK_FILE.test(entry.name)) return [];
  const file = await readFile(entry);
  return file ? [{ file, path }] : [];
}

export function collectDrop(src: DropSource): Promise<DroppedFile[]> {
  const roots = grab(src);
  return (async () => {
    const parts = await Promise.all(
      roots.map((r) =>
        'entry' in r ? walk(r.entry, '') : Promise.resolve(JUNK_FILE.test(r.file.name) ? [] : [{ file: r.file, path: r.file.name }]),
      ),
    );
    return parts.flat();
  })();
}
