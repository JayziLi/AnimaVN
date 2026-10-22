/**
 * 后端发来的文件存到本地:fetch 拿到的回应 → blob → 点一下隐藏的 <a download>。
 * 文件名照 Content-Disposition(后端给的卡名、包名,带中文),取不到用调用方给的兜底名。
 * 导出角色包(.animavn)、单包(.animapack)、对话都走这里;存完告诉调用方存成了什么、多大(「已存成 …」)。
 */

/** 存下来的文件 */
export interface SavedFile {
  name: string;
  bytes: number;
}

/**
 * Content-Disposition 里的文件名。后端两个都给:filename*=UTF-8''… 是完整的(带中文),
 * filename="…" 是把非 ASCII 字符剥掉的兜底 —— 先认前者,不然中文名的对话全导出成 chat.jsonl
 */
export function filenameFromDisposition(disposition: string): string | null {
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star) {
    try {
      const decoded = decodeURIComponent(star[1].trim());
      if (decoded) return decoded;
    } catch {
      // 编码坏了就退回普通的 filename
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition);
  return plain?.[1].trim() || null;
}

/** 存成什么名字:回应头里有就用它,没有用兜底名 */
export function savedName(res: Pick<Response, 'headers'>, fallback: string): string {
  return filenameFromDisposition(res.headers.get('Content-Disposition') ?? '') ?? fallback;
}

/** 一个 blob 存成文件 */
export function saveBlob(blob: Blob, name: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 等这一下点击交给浏览器以后再收回(同一拍里收回,有的浏览器存下来是空文件)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

/** 成功的回应存成文件(调用方先看过 res.ok) */
export async function saveResponse(res: Response, fallback: string): Promise<SavedFile> {
  const blob = await res.blob();
  const name = savedName(res, fallback);
  saveBlob(blob, name);
  return { name, bytes: blob.size };
}
