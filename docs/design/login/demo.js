/**
 * 登录页原型的演示脚本:封面数据、状态切换。
 * 改成 React 时:
 *   - 封面 → props(背景和它的 focus),每次打开随机一张由后端或父组件给
 *   - 强调色 → frontend/src/debug/vn/titleArt.ts 的 accentOf(背景)。这里写死的值就是用同一个算法离线算的,
 *     因为双击打开(file://)时浏览器不让 canvas 读本地图片的像素
 *   - mode / busy / error → useState;校验规则和 feat/public-play 分支的 LoginPage.tsx 一样
 *
 * 地址栏参数(preview.html 用):
 *   state = login | register | error | error-register | busy | busy-register
 *   pick = 0..7(不写就随机)     ui = 0(藏起演示开关)
 */

const BLOBS = '../../../userdata/blobs/';

/**
 * 封面池:各个场景包里好看的几张,冷暖各半。place 只给演示开关当按钮名;focus 是竖屏时横向对准哪儿(场景的 focus_x)。
 * 樱花河堤取出来是金色、和樱花对不上,没放进来
 */
const COVERS = [
  {
    place: '花田',
    bg: '94/946df93d20c7bfece9cb7ab486b79e987ced442e33c7490becb5866a7c5ca0c6.jpg',
    focus: 50,
    accent: { acc: '#8ebde1', deep: 'hsl(206 58% 36%)' },
  },
  {
    place: '建实神社',
    bg: '4c/4cb474d2a33be5cb8422b927ce6365ca7ff590218e1d78ada040e395a20484c0.jpg',
    focus: 55,
    accent: { acc: '#85c2eb', deep: 'hsl(204 62% 36%)' },
  },
  {
    place: '竹林小道',
    bg: '92/92fed27619dd59a3986431e32294c583a092d6bb10637ce40262319e5198eac1.jpg',
    focus: 50,
    accent: { acc: '#e2d08e', deep: 'hsl(47 59% 36%)' },
  },
  {
    place: '图书馆',
    bg: '31/31868d97a0c755b060f5f44b5e1b18286576fd9b8781e6db2399074a7dffa092.jpg',
    focus: 50,
    accent: { acc: '#d6a69a', deep: 'hsl(12 35% 36%)' },
  },
  {
    place: '河堤夜樱',
    bg: 'e5/e56d34b60119ee32b8fd64b3a44c0f0d52549d753a21e213958c204a44065a31.jpg',
    focus: 40,
    accent: { acc: '#95a7da', deep: 'hsl(225 48% 36%)' },
  },
  {
    place: '夏莱黄昏',
    bg: 'ff/ffdcaeaea121c65494589c0c764b531cba8e5ee5a2f4fbc8d0e2fd0bd3a5cc9d.jpg',
    focus: 45,
    accent: { acc: '#d6a79a', deep: 'hsl(13 39% 36%)' },
  },
  {
    place: '二十四桥',
    bg: '7d/7d46f6af3d2f26cb9c3d85049daecc23718abcdf23a15d819b668f0a884decbb.jpg',
    focus: 45,
    accent: { acc: '#d6b79a', deep: 'hsl(29 38% 36%)' },
  },
  {
    place: '西湖断桥',
    bg: '97/974d1e37a76a16dbab5d371876c18476d40788787f50c27545a564caf4cd41c4.jpg',
    focus: 50,
    accent: { acc: '#9abdd6', deep: 'hsl(205 35% 36%)' },
  },
];

// ---- 页面 ----

const $ = (s) => document.querySelector(s);
const root = $('#au');
const form = $('.au-form');
const msg = $('.au-msg');
const more = $('.au-more');
const inputs = {
  username: $('#au-username'),
  password: $('#au-password'),
  again: $('#au-again'),
};
const params = new URLSearchParams(location.search);

let cover = COVERS[0];

function applyCover(i) {
  cover = COVERS[i];
  root.style.setProperty('--au-acc', cover.accent.acc);
  root.style.setProperty('--au-acc-deep', cover.accent.deep);
  root.style.setProperty('--au-focus', `${cover.focus}%`);
  $('.au-bg').src = BLOBS + cover.bg;
  syncDemo();
}

// ---- 状态 ----

const COPY = {
  login: { text: '登录', en: 'LOG IN', busy: '登录中', pw: 'current-password' },
  register: { text: '注册并开始', en: 'SIGN UP', busy: '注册中', pw: 'new-password' },
};

function setMode(mode) {
  root.dataset.mode = mode;
  for (const t of document.querySelectorAll('.au-tab')) t.setAttribute('aria-selected', String(t.dataset.tab === mode));
  more.inert = mode !== 'register';
  inputs.password.autocomplete = COPY[mode].pw;
  // 注册时把规则写在占位里,登录时空着
  inputs.username.placeholder = mode === 'register' ? '2–20 个字：字母、数字、下划线或汉字' : '';
  inputs.password.placeholder = mode === 'register' ? '至少 8 位' : '';
  setError(null);
  setBusy(false);
  syncDemo();
}

function setError(text, field) {
  msg.textContent = text ?? '';
  for (const el of document.querySelectorAll('.au-field')) el.classList.toggle('is-invalid', el.dataset.field === field);
  for (const [k, el] of Object.entries(inputs)) el.setAttribute('aria-invalid', String(k === field));
  if (text) {
    msg.classList.remove('is-shake');
    void msg.offsetWidth;
    msg.classList.add('is-shake');
  }
}

function setBusy(busy) {
  root.classList.toggle('is-busy', busy);
  const c = COPY[root.dataset.mode];
  $('.au-submit-text').textContent = busy ? c.busy : c.text;
  $('.au-submit-en').textContent = c.en;
  $('.au-submit').disabled = busy;
  $('.au-submit').setAttribute('aria-busy', String(busy));
  for (const el of Object.values(inputs)) el.readOnly = busy;
}

// 和后端 app/play/auth.py 的 USERNAME 一致
const NAME = /^[A-Za-z0-9_一-鿿]{2,20}$/;
const MIN_PASSWORD = 8;

let timer = 0;
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (root.classList.contains('is-busy')) return;
  const mode = root.dataset.mode;
  const name = inputs.username.value.trim();
  if (!NAME.test(name)) return setError('用户名 2–20 个字，只能用字母、数字、下划线和汉字', 'username');
  if (inputs.password.value.length < MIN_PASSWORD) return setError(`密码至少 ${MIN_PASSWORD} 位`, 'password');
  if (mode === 'register' && inputs.password.value !== inputs.again.value)
    return setError('两次输入的密码不一样', 'again');
  setError(null);
  setBusy(true);
  // 演示:没有后端,1.5 秒后回一个假的服务器错误
  clearTimeout(timer);
  timer = setTimeout(() => {
    setBusy(false);
    setError(mode === 'login' ? '用户名或密码不对' : '这个用户名已经有人用了');
  }, 1500);
});

for (const t of document.querySelectorAll('.au-tab'))
  t.addEventListener('click', () => {
    currentState = t.dataset.tab;
    setMode(t.dataset.tab);
  });
for (const el of Object.values(inputs))
  el.addEventListener('input', () => {
    if (el.getAttribute('aria-invalid') === 'true') setError(null);
  });

const eye = $('.au-eye');
eye.addEventListener('click', () => {
  const show = eye.getAttribute('aria-pressed') !== 'true';
  eye.setAttribute('aria-pressed', String(show));
  eye.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
  inputs.password.type = show ? 'text' : 'password';
  inputs.again.type = show ? 'text' : 'password';
});

// ---- 预设状态(preview.html 和演示开关用) ----

function applyState(state) {
  clearTimeout(timer);
  const mode = state.endsWith('register') ? 'register' : 'login';
  setMode(mode);
  const filled = state !== 'login' && state !== 'register';
  inputs.username.value = filled ? 'xinghui_fan' : '';
  inputs.password.value = filled ? 'starshine26' : '';
  inputs.again.value = filled ? (state === 'error-register' ? 'starshine62' : 'starshine26') : '';
  if (state === 'error') setError('用户名或密码不对');
  if (state === 'error-register') setError('两次输入的密码不一样', 'again');
  if (state.startsWith('busy')) setBusy(true);
  currentState = state;
  syncDemo();
}

// ---- 每次打开随机一张,尽量不和上次一样 ----

function pick() {
  const p = params.get('pick');
  if (p !== null) return Math.abs(parseInt(p, 10) || 0) % COVERS.length;
  let last = -1;
  try {
    last = parseInt(localStorage.getItem('anima-login-cover') ?? '-1', 10);
  } catch {}
  let i = Math.floor(Math.random() * COVERS.length);
  if (i === last) i = (i + 1 + Math.floor(Math.random() * (COVERS.length - 1))) % COVERS.length;
  try {
    localStorage.setItem('anima-login-cover', String(i));
  } catch {}
  return i;
}

// ---- 演示开关 ----

let currentState = 'login';
const demo = $('#demo');
const pickRow = demo.querySelector('[data-group="pick"]');
COVERS.forEach((c, i) => {
  const b = document.createElement('button');
  b.dataset.v = String(i);
  b.textContent = c.place;
  pickRow.appendChild(b);
});

function syncDemo() {
  const on = { state: currentState, pick: String(COVERS.indexOf(cover)) };
  for (const row of demo.querySelectorAll('[data-group]'))
    for (const b of row.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === on[row.dataset.group]);
}

demo.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const g = b.closest('[data-group]').dataset.group;
  if (g === 'state') applyState(b.dataset.v);
  if (g === 'pick') applyCover(parseInt(b.dataset.v, 10));
});
if (params.get('ui') === '0') demo.remove();

// ---- 启动 ----

applyCover(pick());
applyState(params.get('state') ?? 'login');
