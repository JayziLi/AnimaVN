// 主界面原型的演示逻辑:数据在 data.js(CAST、BLOBS),这里只管摆立绘、切角色、轮播。改 React 时整个换掉。
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const STAR = '<svg class="star"><use href="#star"/></svg>';

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
const src = (blob) => BLOBS + blob;
let cur = 0;

/**
 * 按脸摆立绘(和游戏里 titleArt.ts 的做法一样):脸的高度占舞台高的 faceH,
 * 脸顶在 faceTop,脸的中线在 cx(都是 0–1)。
 */
function placeSprite(img, sp, stage, pose) {
  const H = stage.clientHeight, W = stage.clientWidth;
  const h = (pose.faceH * H) / sp.face.h, w = (h * sp.w) / sp.h;
  img.style.height = `${h}px`;
  img.style.left = `${pose.cx * W - (sp.face.x + sp.face.w / 2) * w}px`;
  img.style.top = `${pose.faceTop * H - sp.face.y * h}px`;
}

/** 按脸裁的小头像:box 的宽高比 = ratio(高 / 宽),脸宽占 box 宽的 fill */
function faceImg(sp, ratio, fill, top) {
  const img = new Image();
  img.src = src(sp.src);
  const k = fill / sp.face.w; // 图宽 = k × box 宽
  img.style.width = `${k * 100}%`;
  img.style.left = `${(0.5 - (sp.face.x + sp.face.w / 2) * k) * 100}%`;
  img.style.top = `${(top - (sp.face.y * k * (sp.h / sp.w)) / ratio) * 100}%`;
  return img;
}

const portrait = () => innerWidth < innerHeight;

function renderSprite(host, pose) {
  const c = cast[cur];
  // 主页用开心的那张,角色页用默认表情 —— 两屏不重样
  const sp = host.id === 'heroSprite' ? (c.sprites.find((s) => s.face && /开心|笑/.test(s.label)) ?? c.sprites[0]) : c.sprites[0];
  const img = new Image();
  img.src = src(sp.src);
  img.alt = '';
  placeSprite(img, sp, host, pose);
  host.replaceChildren(img);
}

function renderHero() {
  const c = cast[cur];
  const bg = $('#heroBg');
  const next = new Image();
  next.src = src(c.scenes[0].src);
  next.style.objectPosition = `${c.scenes[0].focus}% 50%`;
  bg.append(next);
  requestAnimationFrame(() => {
    [...bg.children].forEach((im) => im.classList.toggle('cur', im === next));
    setTimeout(() => [...bg.children].forEach((im) => im !== next && im.remove()), 1300);
  });
  renderSprite($('#heroSprite'), portrait() ? { faceH: 0.13, faceTop: 0.3, cx: 0.5 } : { faceH: 0.2, faceTop: 0.2, cx: 0.6 });
  $('#ctaThumb').style.backgroundImage = `url("${src(c.scenes[0].src)}")`;
  $('#ctaSub').textContent = `${c.name} · ${c.scenes[0].label} · ${c.ago}`;

  // 最近的两段:当前角色以外的
  const recent = $('#recent');
  recent.replaceChildren();
  cast.filter((_, i) => i !== cur).slice(0, 2).forEach((o) => {
    const card = el('button', 'recent-card');
    const pic = el('div', 'recent-pic');
    pic.style.backgroundImage = `url("${src(o.scenes[0].src)}")`;
    const face = el('div', 'recent-face face');
    face.append(faceImg(o.sprites[0], 1, 0.62, 0.2));
    card.append(pic, face, el('div', 'recent-body', `<b>${o.name}<small style="font-weight:400;opacity:.6;margin-left:.8em">${o.ago}</small></b><span>「${o.line}」</span>`));
    card.onclick = () => pick(cast.indexOf(o));
    recent.append(card);
  });
}

function renderCast() {
  const c = cast[cur];
  renderSprite($('#castSprite'), portrait() ? { faceH: 0.13, faceTop: 0.14, cx: 0.5 } : { faceH: 0.24, faceTop: 0.17, cx: 0.24 });
  $('#castWork').textContent = c.work;
  $('#castName').textContent = c.name;
  $('#castTags').replaceChildren(...c.tags.filter((t) => !/测试/.test(t)).map((t) => el('li', '', t)));
  $('#castLast').textContent = `上次 · ${c.ago} · 「${c.line}」`;
  const arches = $('#arches');
  arches.replaceChildren(...cast.map((o, i) => {
    const b = el('button', `arch face${i === cur ? ' cur' : ''}`, STAR);
    b.title = o.name;
    b.prepend(faceImg(o.sprites[0], 1.5, 0.66, 0.2));
    b.onclick = () => pick(i);
    return b;
  }));
  $('#dots').replaceChildren(...cast.map((_, i) => (i === cur ? el('span', '', STAR).firstChild : el('i'))));
}

let worldAt = 0;
function renderWorld(reset) {
  const c = cast[cur];
  if (reset) worldAt = 0;
  const cards = $('#cards');
  if (reset || cards.children.length !== c.scenes.length) {
    cards.replaceChildren(...c.scenes.map((s, i) => {
      const card = el('button', 'scene-card');
      const img = new Image();
      img.src = src(s.src);
      img.style.objectPosition = `${s.focus}% 50%`;
      card.append(img, el('div', 'paper'), el('b', '', s.label));
      const mk = new Image();
      mk.src = 'assets/logo.svg';
      mk.className = 'mk';
      card.append(mk);
      card.onclick = () => { worldAt = i; renderWorld(false); };
      return card;
    }));
  }
  const n = c.scenes.length;
  [...cards.children].forEach((card, i) => {
    // 以当前这张为中心往两边排,绕一圈
    let d = i - worldAt;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    const a = Math.abs(d);
    card.style.transform = `translateX(${d * 33}vh) scale(${a === 0 ? 1.16 : a === 1 ? 0.92 : 0.8})`;
    card.style.opacity = a > 2 ? 0 : a === 0 ? 1 : 0.55;
    card.style.zIndex = 10 - a;
    card.style.filter = a === 0 ? 'none' : 'saturate(0.7)';
  });
  $('#worldNote').textContent = `${c.name} 的场景包 · ${n} 个地点`;
}

function renderSaves() {
  $('#saveGrid').replaceChildren(...cast.slice(0, 6).map((o, i) => {
    const s = o.scenes[(i + 1) % o.scenes.length];
    const b = el('button', 'save');
    const pic = el('div', 'save-pic');
    pic.style.backgroundImage = `url("${src(s.src)}")`;
    b.append(pic, el('div', 'save-body', `<em>${o.work}</em><b>${o.name} · ${s.label}</b><p>「${o.line}」</p><span>${o.ago}</span>`));
    b.onclick = () => pick(cast.indexOf(o));
    return b;
  }));
}

function pick(i) {
  cur = (i + cast.length) % cast.length;
  renderHero();
  renderCast();
  renderWorld(true);
}
$('#castPrev').onclick = () => pick(cur - 1);
$('#castNext').onclick = () => pick(cur + 1);
$('#worldPrev').onclick = () => { worldAt = (worldAt - 1 + cast[cur].scenes.length) % cast[cur].scenes.length; renderWorld(false); };
$('#worldNext').onclick = () => { worldAt = (worldAt + 1) % cast[cur].scenes.length; renderWorld(false); };
addEventListener('resize', () => { renderHero(); renderCast(); });

// 顶栏:滚到哪一屏,哪个标签亮
const io = new IntersectionObserver((es) => {
  for (const e of es) {
    if (e.isIntersecting) document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
  }
}, { root: $('#pages'), threshold: 0.6 });
document.querySelectorAll('.page').forEach((p) => io.observe(p));

// 启动:进度是演示用的假数,真做时接素材等待页(assetGate.ts)的 fraction
let timers = [];
function boot() {
  timers.forEach(clearTimeout);
  const b = $('#boot');
  b.classList.remove('off', 'play');
  $('#bar').style.setProperty('--p', 0);
  void b.offsetWidth; // 重放入场动画
  b.classList.add('play');
  timers = [0.18, 0.42, 0.55, 0.8, 1].map((p, i) => setTimeout(() => $('#bar').style.setProperty('--p', p), 1500 + i * 520));
  timers.push(setTimeout(() => b.classList.add('off'), 4500));
}
$('#demo').addEventListener('click', (e) => {
  if (e.target.dataset.go === 'boot') boot();
  if (e.target.dataset.go === 'home') { timers.forEach(clearTimeout); $('#boot').classList.add('off'); }
});

pick(0);
renderSaves();
// ?skip 直接看主界面
if (location.search.includes('skip')) $('#boot').classList.add('off');
else boot();
