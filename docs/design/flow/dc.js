// 画布画板(.dc.html)的本机渲染器 —— refs/pick/preview.html 那个的可复用版:一个页面里能挂好几块画板。
// 只认 {{ 路径 }}、sc-for、sc-if、onClick/onMouseEnter/onMouseLeave;/_blob/ 换成本机文件。
const LOCAL = {
  c00cbd674d30148ced2b818e057d38a7: '../canvas/assets/logo.png',
  '8573f47959bc1e4cf7b9ca722027ea8c': '../canvas/assets/wordmark.png',
  '1f6c00d0bf78e1f4138c7f491ec04923': '../canvas/assets/map-left.svg',
  '6896679b28d9c0a5224ed0473ccdcf69': '../canvas/assets/map-right.svg',
  '7ed4ac04f14f59757a305ae2d8d9e963': '../canvas/assets/sky-pick.svg',
  '0c3360ef3955b49208c4b84c5d765579': '../canvas/assets/bg-bedroom.jpg',
  '66c919115da57d4529d7ae0265d27b71': '../canvas/assets/sprite-xinghui.webp',
};
const EVENTS = { onclick: 'click', onmouseenter: 'mouseenter', onmouseleave: 'mouseleave' };
const helmets = new Set();

export async function loadBlobs() {
  for (const dir of ['pick', 'saves']) {
    const map = await (await fetch(`../canvas/${dir}/blobs.json`)).json();
    Object.entries(map).forEach(([file, id]) => { LOCAL[id] = `../canvas/${dir}/${file}`; });
  }
}
export const localBlob = (s) => String(s).replace(/\/_blob\/([0-9a-f]{32})/g, (m, id) => LOCAL[id] || m);

function lookup(scope, expr) {
  expr = expr.trim();
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (/^-?\d/.test(expr)) return Number(expr);
  return expr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
}
function interp(text, scope) {
  return localBlob(text.replace(/\{\{([^}]*)\}\}/g, (m, e) => { const v = lookup(scope, e); return v == null ? '' : String(v); }));
}
function build(node, scope, out) {
  if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.textContent, scope))); return; }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  if (tag === 'sc-for') {
    const list = lookup(scope, node.getAttribute('list').replace(/[{}]/g, '')) || [];
    const as = node.getAttribute('as');
    list.forEach((item) => node.childNodes.forEach((ch) => build(ch, Object.assign({}, scope, { [as]: item }), out)));
    return;
  }
  if (tag === 'sc-if') {
    if (lookup(scope, node.getAttribute('value').replace(/[{}]/g, ''))) node.childNodes.forEach((ch) => build(ch, scope, out));
    return;
  }
  const ns = node.namespaceURI;
  const el = ns && ns !== 'http://www.w3.org/1999/xhtml' ? document.createElementNS(ns, tag) : document.createElement(tag);
  for (const a of node.attributes) {
    const name = a.name.toLowerCase();
    if (EVENTS[name]) {
      const fn = lookup(scope, a.value.replace(/[{}]/g, ''));
      if (typeof fn === 'function') el.addEventListener(EVENTS[name], fn);
      continue;
    }
    if (name.startsWith('hint-')) continue;
    el.setAttribute(a.name, interp(a.value, scope));
  }
  node.childNodes.forEach((ch) => build(ch, scope, el));
  out.appendChild(el);
}

// 一块画板:load() 读文件,render() 按当前 state 重画;setState 和画布里一样会合并再重画
export class Board {
  constructor(host, url) { this.host = host; this.url = url; this.onRender = null; }
  async load() {
    const src = await (await fetch(this.url)).text();
    const doc = new DOMParser().parseFromString(src, 'text/html');
    const xdc = doc.querySelector('x-dc');
    const helmet = xdc.querySelector('helmet');
    if (helmet) {
      if (!helmets.has(this.url)) { document.head.insertAdjacentHTML('beforeend', helmet.innerHTML); helmets.add(this.url); }
      helmet.remove();
    }
    this.tpl = xdc;
    const board = this;
    class DCLogic {
      constructor() { this.props = {}; this.state = {}; }
      setState(p) { Object.assign(this.state, p); board.render(); }
    }
    const code = doc.querySelector('script[data-dc-script]').textContent;
    const Component = new Function('DCLogic', code + '\nreturn Component;')(DCLogic);
    this.comp = new Component();
    return this;
  }
  render() {
    const frag = document.createDocumentFragment();
    const vals = this.comp.renderVals();
    this.tpl.childNodes.forEach((ch) => build(ch, vals, frag));
    // 重画会换掉整块 DOM:滚动位置记下来再放回去
    const scrolls = [...this.host.querySelectorAll('.ls')].map((el) => el.scrollTop);
    this.host.replaceChildren(frag);
    this.host.querySelectorAll('.ls').forEach((el, i) => { if (scrolls[i]) el.scrollTop = scrolls[i]; });
    if (this.onRender) this.onRender();
  }
  get state() { return this.comp.state; }
  set(p) { Object.assign(this.comp.state, p); }
}
