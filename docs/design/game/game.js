// 加载 / 进入 / 选角色 原型的演示逻辑。数据在 ../home/data.js(CAST、BLOBS)。改 React 时整个换掉。
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const STAR = '<svg class="star"><use href="#star"/></svg>';
const src = (blob) => BLOBS + blob;

// 没扫到脸的立绘没法按脸摆,原型里先不放
const cast = CAST.filter((c) => c.sprites[0] && c.sprites[0].face && c.scenes.length);
// 演示用的「上次」:真做时来自对话的 updated_at 和最后一句
const DEMO = [
  { ago: '3 小时前', line: '……那、明天也要来哦?说好了。' },
  { ago: '昨天', line: '茶要凉了,先喝一口再说吧。' },
  { ago: '2 天前', line: '欸嘿嘿,被你发现了。' },
  { ago: '上周', line: '这份报告我已经看完了,老师。' },
  { ago: '上周', line: '博士,今天也请多指教。' },
  { ago: '9 月 12 日', line: '雨停了,要不要出去走走?' },
];
cast.forEach((c, i) => Object.assign(c, DEMO[i % DEMO.length]));
const TIPS = [
  '右键可以隐藏界面,只看立绘和背景',
  '滚轮往上翻是历史,点「回到这里」可以从那一句重玩',
  '翻回以前的句子再开口,会分出一条新的故事线',
  '按住 Ctrl 快进,读过的句子一路跳过去',
];
let cur = 0;

/** 按脸摆立绘(和游戏里 titleArt.ts 同一个做法):脸高占舞台高的 faceH,脸顶在 faceTop,脸的中线在 cx(0–1) */
function placeSprite(img, sp, stage, pose) {
  const H = stage.clientHeight, W = stage.clientWidth;
  const h = (pose.faceH * H) / sp.face.h, w = (h * sp.w) / sp.h;
  img.style.height = `${h}px`;
  img.style.left = `${pose.cx * W - (sp.face.x + sp.face.w / 2) * w}px`;
  img.style.top = `${pose.faceTop * H - sp.face.y * h}px`;
}
/** 按脸裁的小头像:ratio = 框的高 / 宽,脸宽占框宽的 fill,脸顶在框高的 top 处 */
function faceImg(sp, ratio, fill, top) {
  const img = new Image();
  img.src = src(sp.src);
  const k = fill / sp.face.w;
  img.style.width = `${k * 100}%`;
  img.style.left = `${(0.5 - (sp.face.x + sp.face.w / 2) * k) * 100}%`;
  img.style.top = `${(top - (sp.face.y * k * (sp.h / sp.w)) / ratio) * 100}%`;
  return img;
}
function setBg(host, scene) {
  const next = new Image();
  next.src = src(scene.src);
  next.style.objectPosition = `${scene.focus}% 50%`;
  host.append(next);
  requestAnimationFrame(() => {
    [...host.children].forEach((im) => im.classList.toggle('cur', im === next));
    setTimeout(() => [...host.children].forEach((im) => im !== next && im.remove()), 1100);
  });
}
function setSprite(host, sp, pose) {
  const img = new Image();
  img.src = src(sp.src);
  placeSprite(img, sp, host, pose);
  host.replaceChildren(img);
}
const happy = (c) => c.sprites.find((s) => s.face && /开心|笑/.test(s.label)) ?? c.sprites[0];

// ---------- 几屏之间 ----------
let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
function show(id) {
  timers.forEach(clearTimeout);
  timers = [];
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  document.querySelectorAll('#demo button').forEach((b) => b.classList.toggle('on', b.dataset.go === id));
}
/** 假的进度:真做时接素材等待页(assetGate.ts)的 fraction */
function runBar(screen, steps, then) {
  const bar = $(`#${screen} [data-bar]`);
  bar.style.transition = 'none';
  bar.style.setProperty('--p', 0);
  void bar.offsetWidth;
  bar.style.transition = '';
  steps.forEach(([p, at, note]) => later(() => {
    bar.style.setProperty('--p', p);
    if (note) note();
  }, at));
  later(then, steps[steps.length - 1][1] + 700);
}

function boot() {
  show('boot');
  runBar('boot', [[0.12, 1300], [0.4, 1800], [0.62, 2300], [0.86, 2800], [1, 3300]], title);
}

function title() {
  show('title');
  const c = cast[cur];
  setBg($('#titleBg'), c.scenes[0]);
  setSprite($('#titleSprite'), happy(c), { faceH: 0.2, faceTop: 0.2, cx: 0.66 });
  $('#whoFace').replaceChildren(faceImg(c.sprites[0], 1, 0.62, 0.2));
  $('#whoName').textContent = c.name;
  $('#whoLast').textContent = `上次 · ${c.ago} · ${c.scenes[0].label}`;
}

function gate() {
  show('gate');
  const c = cast[cur];
  setBg($('#gateBg'), c.scenes[0]);
  $('#gateFace').replaceChildren(faceImg(c.sprites[0], 31 / 21, 0.62, 0.22));
  $('#gateWork').textContent = c.work;
  $('#gateName').textContent = c.name;
  $('#gateLine').textContent = `「${c.line}」`;
  $('#gateTip').textContent = `小提示 · ${TIPS[Math.floor(Math.random() * TIPS.length)]}`;
  const n = (a, b) => () => { $('#gateDetail').textContent = `正在准备 · 立绘 ${a}/14 · 背景 ${b}/6`; };
  n(0, 0)();
  runBar('gate', [[0.2, 500, n(3, 1)], [0.45, 1100, n(6, 3)], [0.7, 1700, n(10, 4)], [0.9, 2300, n(13, 6)], [1, 2800, n(14, 6)]], ingame);
}

function ingame() {
  show('ingame');
  const c = cast[cur];
  setBg($('#gameBg'), c.scenes[0]);
  setSprite($('#gameSprite'), c.sprites[0], { faceH: 0.2, faceTop: 0.16, cx: 0.5 });
  $('#gameName').textContent = c.name;
  $('#gameLine').textContent = `「${c.line}」`;
}

// ---------- 选角色 ----------
let work = null; // null = 全部
const shown = () => cast.filter((c) => !work || c.work === work);

function renderWorks() {
  const works = [...new Set(cast.map((c) => c.work))];
  const item = (label, value, n) => {
    const b = el('button', work === value ? 'on' : '', `${STAR}<span>${label}</span><small>${n}</small>`);
    b.onclick = () => {
      work = value;
      if (!shown().includes(cast[cur])) cur = cast.indexOf(shown()[0]);
      select();
    };
    return b;
  };
  $('#works').replaceChildren(item('全部', null, cast.length), ...works.map((w) => item(w, w, cast.filter((c) => c.work === w).length)));
}

function renderStrips() {
  const host = $('#strips');
  const H = host.clientHeight;
  host.replaceChildren(...shown().map((c) => {
    const i = cast.indexOf(c);
    const strip = el('div', `strip${i === cur ? ' on' : ''}`);
    const inner = el('div', 'strip-in');
    const bg = new Image();
    bg.className = 'strip-bg';
    bg.src = src(c.scenes[0].src);
    bg.style.objectPosition = `${c.scenes[0].focus}% 50%`;
    // 立绘:收着时脸在长条正中,展开后挪到左边三分之一(--cx 在 CSS 里没法过渡,直接改 left)
    const sp = c.sprites[0];
    const spr = new Image();
    spr.className = 'strip-spr';
    spr.src = src(sp.src);
    const h = (0.2 * H) / sp.face.h, w = (h * sp.w) / sp.h;
    const off = (sp.face.x + sp.face.w / 2) * w;
    spr.style.height = `${h}px`;
    spr.style.top = `${0.17 * H - sp.face.y * h}px`;
    spr.style.left = `calc(${i === cur ? 30 : 50}% - ${off}px)`;
    const info = el('div', 'strip-info', `
      <small>${c.work}</small>
      <h2>${c.name}</h2>
      <ul>${c.tags.filter((t) => !/测试/.test(t)).map((t) => `<li>${t}</li>`).join('')}</ul>
      <blockquote>「${c.line}」<span>上次 · ${c.ago} · ${c.scenes[0].label}</span></blockquote>
      <div class="strip-acts">
        <button class="btn solid" data-act="go">${STAR}<span>接着上次</span>${STAR}</button>
        <button class="btn" data-act="new"><span>新的故事</span></button>
      </div>`);
    inner.append(bg, el('div', 'strip-shade'), spr, el('div', 'strip-tab', `${STAR}<b>${c.name}</b>`), info);
    strip.append(inner);
    strip.onclick = (e) => {
      if (e.target.closest('[data-act]')) return gate();
      if (i === cur) return;
      cur = i;
      // 不重建:只换 on,长条自己过渡
      [...host.children].forEach((s) => {
        const on = s === strip;
        s.classList.toggle('on', on);
        const im = s.querySelector('.strip-spr');
        im.style.left = im.style.left.replace(/calc\(\d+%/, `calc(${on ? 30 : 50}%`);
      });
    };
    return strip;
  }));
  $('#selCount').textContent = `${shown().length} 位角色`;
}

function select() {
  show('select');
  renderWorks();
  renderStrips();
}

// ---------- 交互 ----------
$('#title').addEventListener('click', gate);
$('#who').addEventListener('click', (e) => { e.stopPropagation(); select(); });
document.querySelector('.title-tools').addEventListener('click', (e) => e.stopPropagation());
$('#selBack').onclick = title;
$('#ingame').addEventListener('click', title);
$('#demo').addEventListener('click', (e) => {
  const go = { boot, title, select, gate }[e.target.dataset.go];
  if (go) go();
});
addEventListener('keydown', (e) => {
  if (!$('#select').classList.contains('on')) return;
  const list = shown(), at = list.indexOf(cast[cur]);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const next = list[(at + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
    $('#strips').children[list.indexOf(next)].click();
  } else if (e.key === 'Enter') gate();
  else if (e.key === 'Escape') title();
});
addEventListener('resize', () => {
  const on = document.querySelector('.screen.on');
  if (on && on.id !== 'boot' && on.id !== 'gate') ({ title, select, ingame })[on.id]();
});
// 地址后面加 #title / #select / #gate 直接看那一屏
const start = { '#title': title, '#select': select, '#gate': gate }[location.hash];
(start ?? boot)();
