/**
 * 按字比两段话(第 2 步 P5,外语页「这次发出去的」):full 是块的原文,sent 是这次发出去的(精简版)。
 * 返回一段一段的:kept = 这次发了;kept 为 false = 只有 full 里有(这次不发,画删除线)。
 *
 * 先按行对齐(一模一样的行先配上),对不上的那几行再按字比:sent 的一行是 full 里某一行删掉几个字得来的
 * (精简版就是这样),就和那一行逐字比;整行删掉的,换行符跟着它走。这样删掉的总是整句、整行,
 * 不会把这一行的「。」配到下一行去。
 * 保证:kept 的拼起来正好是 sent;sent 里没有多出来的字时,全部拼起来正好是 full
 * (sent 里多出来的字算 kept —— 它也发了)。
 */

export interface DiffPart {
  text: string;
  kept: boolean;
}

/** a[i:] 和 b[j:] 的最长公共子序列长度表,(a.length + 1) × (b.length + 1) */
function lcsTable<T>(a: readonly T[], b: readonly T[]): Int32Array[] {
  const t = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  return t;
}

type Op<T> = { kind: 'same'; a: T; b: T; i: number; j: number } | { kind: 'del'; a: T; i: number } | { kind: 'add'; b: T; j: number };

/** 从前往后走:能配就配,配不上先删 full 里的(删掉的连成一段) */
function walk<T>(a: readonly T[], b: readonly T[]): Op<T>[] {
  const t = lcsTable(a, b);
  const out: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j] && t[i][j] === t[i + 1][j + 1] + 1) {
      out.push({ kind: 'same', a: a[i], b: b[j], i: i++, j: j++ });
    } else if (i < a.length && (j >= b.length || t[i + 1][j] >= t[i][j + 1])) {
      out.push({ kind: 'del', a: a[i], i: i++ });
    } else {
      out.push({ kind: 'add', b: b[j], j: j++ });
    }
  }
  return out;
}

/** s 是不是 f 删掉几个字得来的 */
function isSubsequence(s: string, f: string): boolean {
  let k = 0;
  for (const ch of f) if (k < s.length && ch === s[k]) k++;
  return k === s.length;
}

/** 一行里按字比:去掉相同的开头结尾,中间再逐字配 */
function lineDiff(f: string, s: string, push: (text: string, kept: boolean) => void) {
  let p = 0;
  while (p < f.length && p < s.length && f[p] === s[p]) p++;
  let q = 0;
  while (q < f.length - p && q < s.length - p && f[f.length - 1 - q] === s[s.length - 1 - q]) q++;
  push(f.slice(0, p), true);
  for (const op of walk([...f.slice(p, f.length - q)], [...s.slice(p, s.length - q)])) {
    if (op.kind === 'same') push(op.a, true);
    else if (op.kind === 'del') push(op.a, false);
    else push(op.b, true);
  }
  push(f.slice(f.length - q), true);
}

export function textDiff(full: string, sent: string): DiffPart[] {
  const parts: DiffPart[] = [];
  const push = (text: string, kept: boolean) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.kept === kept) last.text += text;
    else parts.push({ text, kept });
  };
  if (full === sent) {
    push(full, true);
    return parts;
  }
  const fl = full.split('\n');
  const sl = sent.split('\n');
  const lastF = fl.length - 1;
  const lastS = sl.length - 1;
  // 一行后面的换行符:full 里这行后面有、sent 里配上的那行后面也有才算发了
  const sepAfter = (i: number | null, j: number | null) => {
    if (i !== null && i < lastF) push('\n', j !== null && j < lastS);
    else if (j !== null && j < lastS) push('\n', true);
  };
  const same = (i: number, j: number) => {
    push(fl[i], true);
    sepAfter(i, j);
  };
  const gone = (i: number) => {
    push(fl[i], false);
    sepAfter(i, null);
  };
  const added = (j: number) => {
    push(sl[j], true);
    sepAfter(null, j);
  };

  // 对不上的一段:sent 的每一行找 full 里第一行能删出它的,前面跳过的整行删掉;找不到就是多出来的
  let rem: number[] = [];
  let add: number[] = [];
  const flush = () => {
    let r = 0;
    for (const j of add) {
      const k = rem.findIndex((i, n) => n >= r && isSubsequence(sl[j], fl[i]));
      if (k === -1) {
        added(j);
        continue;
      }
      for (; r < k; r++) gone(rem[r]);
      lineDiff(fl[rem[k]], sl[j], push);
      sepAfter(rem[k], j);
      r = k + 1;
    }
    for (; r < rem.length; r++) gone(rem[r]);
    rem = [];
    add = [];
  };
  for (const op of walk(fl, sl)) {
    if (op.kind === 'same') {
      flush();
      same(op.i, op.j);
    } else if (op.kind === 'del') rem.push(op.i);
    else add.push(op.j);
  }
  flush();
  return parts;
}
