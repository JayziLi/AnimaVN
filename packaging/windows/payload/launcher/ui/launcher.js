/* AnimaVN 启动器的界面(照设计稿 docs/design/unify/launcher.html 的 A 玻璃版)。
   数据都问 Python(gui.py 的 App,经 window.pywebview.api):每 700ms 要一次 snapshot。
   画面固定按 1280×720 排,整体按窗口宽度缩放。?mock=1 时 mock.js 给假数据(截图自查用)。 */
(function () {
  'use strict';

  // gui.App 里给界面调的方法(test_launcher_ui.py 拿它和 Python 对)
  const API_METHODS = ['snapshot', 'screen', 'logs', 'last_play', 'voice', 'qr', 'start_game', 'open_other', 'copy', 'open_url',
    'open_logs', 'open_data', 'set_setting', 'restart', 'minimize', 'close'];
  // 游戏窗口能选的画面大小(和 settings.py 的 CHOICES 对上)
  const SIZES = ['1280x720', '1600x900', '1920x1080', '2560x1440', '3840x2160'];

  const W = 1280;
  const H = 720;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    home: svg('<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/><path d="M10 19v-5h4v5"/>'),
    term: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m7.5 10 3 2.5-3 2.5"/><path d="M12.5 15.5h4"/>'),
    voice: svg('<path d="M4 10v4"/><path d="M8 7v10"/><path d="M12 4v16"/><path d="M16 8v8"/><path d="M20 11v2"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    min: svg('<path d="M5 12h14"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
    prev: svg('<path d="M15 5l-7 7 7 7"/>'),
    next: svg('<path d="M9 5l7 7-7 7"/>'),
    out: svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
    globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5z"/>'),
    win: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9h17"/>'),
    phone: svg('<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 18h2"/>'),
    folder: svg('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
    refresh: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>'),
  };
  const STAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0l1.2 6.8L16 8l-6.8 1.2L8 16l-1.2-6.8L0 8l6.8-1.2z"/></svg>';

  const ui = {
    snap: null, page: 'home', pop: null, qr: null, qrKind: 'lan', notice: null, bannerAt: 0, noticeTab: 'log', last: null, lastState: 'idle',
    voice: null, voiceBusy: false, logTab: null, logText: '', restartLater: false, autoStarted: false,
    keys: {}, prevPhase: null, prevGame: false, screen: null,
  };
  let stage;

  const api = () => window.pywebview.api;
  async function call(name, ...args) {
    try {
      return await api()[name](...args);
    } catch (e) {
      toast(`出错了：${(e && e.message) || e}`);
      throw e;
    }
  }

  /* ---------- 小工具 ---------- */

  /** 按宽、高里更紧的那个缩放,舞台长宽跟着窗口比例走(无边框窗口的客户区不一定正好 16:9,
      零件都贴着四边摆,差一点也对得上;主视觉 object-fit: cover 铺满) */
  function fit() {
    const k = Math.min(innerWidth / W, innerHeight / H);
    const root = document.documentElement.style;
    root.setProperty('--k', String(k));
    root.setProperty('--sw', `${innerWidth / k}px`);
    root.setProperty('--sh', `${innerHeight / k}px`);
  }
  function toast(text) {
    stage.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `${STAR}<span>${esc(text)}</span>`;
    stage.append(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 200);
    }, 1900);
  }
  /** 内容变了才重画,免得每次轮询都把 DOM 换一遍(悬停、焦点会丢) */
  function paint(el, html) {
    if (ui.keys[el.id] === html) return;
    ui.keys[el.id] = html;
    el.innerHTML = html;
  }
  const hostOf = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/\/debug\.html.*$/, '');
  const ready = () => ui.snap && ui.snap.phase === 'ready';

  /* ---------- 各块 ---------- */

  function sideHtml() {
    const v = ui.voice;
    const dot = !v || !v.length ? '' : `<i class="dot${v.some((x) => x.ok) ? '' : ' bad'}"></i>`;
    const tip = !v ? '语音服务器' : !v.length ? '语音服务器 · 还没接' : v.some((x) => x.ok) ? '语音服务器 · 通了' : '语音服务器 · 连不上';
    const nav = (id, icon, label, extra = '') =>
      `<button class="nav${ui.page === id ? ' on' : ''}" data-go="${id}" aria-label="${label}">${icon}${extra}<span class="tip">${label}</span></button>`;
    return `<img class="logo" src="logo.svg" alt="" draggable="false">
      ${nav('home', I.home, '首页')}
      ${nav('console', I.term, '控制台')}
      ${nav('voice', I.voice, tip, dot)}
      <div class="grow"></div>
      ${nav('settings', I.gear, '设置')}`;
  }

  // 四角星(和 logo 里那颗同一个形状)
  const star = (cls = '') => `<svg class="${cls}" viewBox="-50 -50 100 100" aria-hidden="true"><path d="M0-50C4-14 14-4 50 0C14 4 4 14 0 50C-4 14-14 4-50 0C-14-4-4-14 0-50Z"/></svg>`;

  /** 公告:横幅外两道错开的细线框、角上挂星,左上角「最新 ✦ 公告」(用户 10-22 给的参考:Astrae Oratio 官网的新闻框);
      横幅不止一张时下面有箭头和圆点(当前那颗是星);再下面是带小标签的列表。图下面不写标题日期(用户 10-23) */
  function noticeHtml(n) {
    if (!n) return '';
    const banners = n.banners || [n.banner];
    const at = Math.min(ui.bannerAt, banners.length - 1);
    const b = banners[at];
    const row = (x, tag) => `<a data-open="${esc(x.url)}"><span class="tag">${esc(x.tag || tag)}</span>
        <span class="t">${esc(x.title)}</span><span class="d">${esc(x.date || x.sub || '')}</span></a>`;
    const turn = (k, cls, label) => `<button class="${cls}" data-banner="${(k + banners.length) % banners.length}" title="${label}">${cls === 'prev' ? I.prev : I.next}</button>`;
    const pager = banners.length < 2 ? '' : `<div class="npager">${turn(at - 1, 'prev', '上一张')}
        ${banners.map((_, k) => `<button class="dot${k === at ? ' on' : ''}" data-banner="${k}" title="第 ${k + 1} 张">${k === at ? star() : '<i></i>'}</button>`).join('')}
        ${turn(at + 1, 'next', '下一张')}</div>`;
    // 一整张卡:图、标题、分隔、列表都在同一块玻璃里,两道错开的细线框围着整张卡(用户 10-23:上下分开了不像一个整体)
    return `<div class="ncard">
        <span class="nframe a"></span><span class="nframe b"></span>${star('nspark big')}${star('nspark small')}
        <div class="nbody glass">
        <a class="banner" data-open="${esc(b.url)}" title="${esc(b.caption)} · ${esc(b.version)}"><img src="${esc(b.image)}" alt="" draggable="false"></a>
        <span class="ntag"><em>最新</em>${star()}<b>公告</b><i class="dots"></i></span>
        ${pager ? `<div class="ncap">${pager}</div>` : ''}
        <div class="ntabs"><button class="${ui.noticeTab === 'log' ? 'on' : ''}" data-tab="log">更新日志</button>
          <button class="${ui.noticeTab === 'links' ? 'on' : ''}" data-tab="links">链接</button>
          <button class="out" data-open="${esc(n.all)}" title="在浏览器里看全部更新日志">${I.out}</button></div>
        <div class="nlist" data-list="log"${ui.noticeTab === 'log' ? '' : ' hidden'}>${n.log.map((x) => row(x, '更新')).join('')}</div>
        <div class="nlist" data-list="links"${ui.noticeTab === 'links' ? '' : ' hidden'}>${n.links.map((x) => row(x, '链接')).join('')}</div>
        </div>
      </div>`;
  }

  function statusHtml(s) {
    if (s.phase === 'failed') {
      return `<div class="status glass bad"><div class="row"><b>没启动起来</b><span class="acts">
          <button class="btn sm" data-go="console">看控制台</button><button class="btn sm primary" data-act="restart">重试</button></span></div>
        <div class="note">${esc(s.message)}</div></div>`;
    }
    if (s.phase !== 'ready') {
      const note = s.kind === 'repo'
        ? '源码文件夹：先打包游戏页面，再开后端，一般一两分钟以内。'
        : '第一次打开要久一点，以后十几秒就好。';
      return `<div class="status glass"><div class="row"><span>${esc(s.message || '正在启动……')}</span></div>
        <div class="bar"><i></i></div><div class="note">${note}</div></div>`;
    }
    if (s.restart_needed && !ui.restartLater) {
      return `<div class="status glass"><div class="row"><span>改了设置，要重启后台才生效</span><span class="acts">
          <button class="btn sm ghost" data-act="later">以后再说</button><button class="btn sm primary" data-act="restart">现在重启</button></span></div>
        <div class="note">${s.game_open ? '游戏开着：重启时游戏会断开一下，存档不受影响。' : '后台重新开一遍，和刚打开启动器时差不多久。'}</div></div>`;
    }
    return '';
  }

  function lastHtml() {
    if (!ready() || ui.lastState !== 'done') return '';
    const l = ui.last;
    if (!l) return '<div class="last">还没有存档 · 进去先挑一位角色</div>';
    return `<div class="last">${l.avatar ? `<img src="${l.avatar}" alt="">` : ''}上次玩的 · ${esc(l.card_name)}</div>`;
  }

  function dockHtml(s) {
    const ok = s.phase === 'ready';
    const label = s.phase === 'failed' ? '<span>没启动起来</span>'
      : !ok ? '<span>正在启动</span>'
      : s.game_open ? '回到游戏<small>游戏窗口开着</small>' : '开始游戏';
    const lan = ok && s.lan_url
      ? `<div class="lan glass"><div class="k"><small>局域网 · 手机和平板</small><b>${esc(hostOf(s.lan_url))}</b></div>
          <button class="iconbtn" data-copy="${esc(s.lan_url)}" title="复制地址">${I.copy}</button></div>`
      : '';
    return `${lan}<div class="startwrap">${lastHtml()}<div class="start">
        <button class="go${s.game_open ? ' two' : ''}" data-act="start" ${ok ? '' : 'disabled'}>${label}</button>
        <button class="gear${ui.pop === 'gear' ? ' open' : ''}" data-act="gear" title="更多打开方式" ${ok ? '' : 'disabled'}>${I.gear}</button>
      </div></div>`;
  }

  function popHtml(s) {
    if (ui.pop === 'gear') {
      const other = s.settings.open_in === 'window' ? `${I.globe}在浏览器打开` : `${I.win}在独立窗口打开`;
      return `<div class="catch" data-act="closepop"></div><div class="pop glass menu">
        <button data-act="other">${other}</button>
        <button data-act="qr" ${s.lan_url ? '' : 'disabled'}>${I.phone}手机扫码玩${s.lan_url ? '' : '<small>设置里没开</small>'}</button></div>`;
    }
    if (ui.pop === 'qr') {
      const q = ui.qr;
      const ts = ui.qrKind === 'tailscale';
      // 有 Tailscale 才给切换:公寓、宿舍、酒店的 Wi-Fi 常把设备互相隔开,同一个 Wi-Fi 也连不上(用户 10-23 碰到)
      const kinds = ui.snap && ui.snap.tailscale_url
        ? `<div class="seg qrkind"><button class="${ts ? '' : 'on'}" data-act="qr-lan">同一个 Wi-Fi</button><button class="${ts ? 'on' : ''}" data-act="qr-tailscale">Tailscale</button></div>`
        : '';
      const note = ts
        ? '手机装 Tailscale、登和这台电脑同一个账号，不在一个 Wi-Fi 也能连。'
        : `手机要和这台电脑连同一个 Wi-Fi。<br>扫了打不开：公寓、宿舍、酒店的 Wi-Fi 常把设备互相隔开，${ui.snap && ui.snap.tailscale_url ? '换上面的 Tailscale，' : ''}或者让电脑连手机热点再扫。`;
      return `<div class="catch" data-act="closepop"></div><div class="pop glass qr">
        <button class="iconbtn close" data-act="closepop" title="关闭">${I.close}</button>${kinds}
        <div class="code">${q ? q.svg : ''}</div>
        <div class="t">手机扫一扫就能玩</div>
        ${q && q.url ? `<div class="addr">${esc(hostOf(q.url))}/debug.html<button class="iconbtn" data-copy="${esc(q.url)}" title="复制地址">${I.copy}</button></div>` : ''}
        <div class="n">${note}</div></div>`;
    }
    return '';
  }

  const shell = (zh, en, right, body) => `<section class="page glass"><header class="ph"><span class="zh">${zh}</span><span class="en">${en}</span>
      <div class="right">${right}</div></header><div class="pbody">${body}</div></section>`;

  function consoleHtml(s) {
    const tabs = s.logs;
    if (!tabs.some((t) => t.name === ui.logTab)) ui.logTab = (tabs.find((t) => t.name === 'backend') || tabs[0] || {}).name || null;
    const hints = s.hints.map((h) => `<div class="diag"><b>疑难解答</b><span>${esc(h)}</span></div>`).join('');
    return shell('控制台', 'Console',
      `<button class="btn sm" data-act="copylogs">${I.copy}复制全部</button><button class="btn sm" data-act="openlogs">${I.folder}打开日志文件夹</button>`,
      `<nav class="tabs">${tabs.map((t) => `<button class="${t.name === ui.logTab ? 'on' : ''}" data-logtab="${esc(t.name)}">
          <span class="zh">${esc(t.label)}</span>${t.reused ? '<span class="en">以前开的</span>' : ''}</button>`).join('')}</nav>
       ${hints}<pre class="log scroll" id="log"></pre>
       <div class="foot">出问题时点右上角「复制全部」，把日志发给作者。${s.settings.terminal ? '「显示终端窗口」开着：后端的输出在那个黑窗口里。' : ''}</div>`);
  }

  function voiceHtml() {
    const v = ui.voice;
    const refresh = `<button class="btn sm" data-act="voicecheck" ${ui.voiceBusy ? 'disabled' : ''}>${I.refresh}${ui.voiceBusy ? '正在检查' : '全部重新检查'}</button>`;
    if (v === null) return shell('语音服务器', 'Voice', refresh, '<p class="vnote">正在检查……</p>');
    if (!v.length) {
      return shell('语音服务器', 'Voice', refresh,
        '<div class="howto">游戏里还没接语音服务器。没有也能玩，只是角色不念台词。<br>要接的话：进游戏「插件 → 语音服务」，添加一台 GPT-SoVITS 或 IndexTTS。</div>');
    }
    const ok = v.filter((x) => x.ok).length;
    const summary = ok === v.length ? '都通了' : ok ? `${ok} 台通了` : '都连不上';
    const card = (x) => `<div class="vcard"><div class="top"><b>${esc(x.name)}</b><span class="chip">${esc(x.kind)}</span>
        <span class="st ${x.ok ? 'good' : 'bad'}"><i></i>${x.ok ? '通了' : '连不上'}</span></div>
      <div class="addr">${esc(x.url)}</div>
      <div class="meta">${x.ok ? `${x.ms} ms · 用它的声音 ${x.voices} 个` : esc(x.error)}</div></div>`;
    const howto = ok < v.length ? `<div class="howto"><b>连不上时按顺序看：</b><ol>
        <li>那台电脑上的语音服务开着没（GPT-SoVITS 的黑窗口还在不在）</li>
        <li>地址对不对：游戏里「插件 → 语音服务」，点连接卡上的「测试」</li>
        <li>两台电脑在不在同一个网络里</li></ol></div>` : '';
    return shell('语音服务器', 'Voice', refresh,
      `<p class="vnote">游戏里接了 ${v.length} 台语音服务器，${summary}。地址和声音在游戏里「插件 → 语音服务」改，这里只看通没通。</p>
       <div class="vcards">${v.map(card).join('')}</div>${howto}`);
  }

  function settingsHtml(s) {
    const st = s.settings;
    const seg = (key, items) => `<div class="seg" data-seg="${key}">${items.map(([v, n]) => `<button data-v="${v}" class="${st[key] === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    const sw = (key) => `<label class="switch"><input type="checkbox" data-sw="${key}" ${st[key] ? 'checked' : ''}><span></span></label>`;
    const row = (k, c, note = '') => `<div class="row"><div class="k">${k}</div><div class="c">${c}${note ? `<p class="note">${note}</p>` : ''}</div></div>`;
    // 比这块屏幕大的不列(选着的那个除外);屏幕多大不知道就全列
    const fits = (v) => {
      const [w, h] = v.split('x').map(Number);
      return !ui.screen || (w <= ui.screen[0] && h <= ui.screen[1]) || v === st.game_size;
    };
    const sizes = SIZES.filter(fits).map((v) => [v, v.replace('x', ' × ')]);
    const portNote = s.kind === 'portable' ? '被别的程序占着时自动往后找一个空的。' : '8000 上已经开着后端（以前的 start.bat）就直接用它。';
    return shell('设置', 'Config', '', `<div class="set scroll">
      <h3>启动<em>Launch</em></h3>
      ${row('开始游戏时', seg('open_in', [['window', '游戏窗口'], ['browser', '默认浏览器']]), '游戏窗口是单独的程序，有自己的任务栏图标，怎么显示在下面「游戏窗口」里选。选浏览器就跟以前一样。')}
      ${row('开始游戏以后', seg('after_start', [['stay', '启动器留着'], ['minimize', '最小化'], ['close', '关掉启动器']]), '关掉启动器不影响开着的游戏。启动器和游戏都关了，后台自己停。')}
      ${row('打开启动器就进游戏', sw('auto_start'), '不停在首页，启动好了直接打开游戏。')}
      ${row('显示终端窗口', sw('terminal'), '后端另开一个黑窗口显示输出（以前的样子）。不开也能在「控制台」里看。')}
      <h3>游戏窗口<em>Display</em></h3>
      ${row('显示方式', seg('game_display', [['fullscreen', '全屏'], ['borderless', '无边框窗口'], ['window', '窗口']]), '玩的时候按 F11 或 Alt+Enter 随时切换全屏。窗口可以拖边改大小。')}
      ${row('画面大小', seg('game_size', sizes), `全屏时是按 F11 退出全屏后的大小。游戏开着的话马上套上；游戏里「设置 → 显示」也能改。`)}
      <h3>网络<em>Network</em></h3>
      ${row('让手机连进来', sw('lan'), '同一个 Wi-Fi 下的手机、平板能打开游戏（启动器或游戏开着时）。关掉以后只有这台电脑能用。')}
      ${row('端口', `<input class="input" data-num="port" value="${st.port}" inputmode="numeric" aria-label="端口">`, portNote)}
      ${s.kind === 'portable' ? `<h3>更新<em>Update</em></h3>${row('自动检查更新', sw('auto_update'), '打开启动器时看一眼有没有新版本，有就在开始按钮上面提示，不会自己装。')}` : ''}
      ${s.kind === 'repo' ? `<h3>开发者<em>Developer</em><span class="chip">源码文件夹里才有</span></h3>
        ${row('游戏页面', seg('dev_mode', [['build', '打包版（流畅）'], ['dev', '开发版（改代码马上生效）']]), '打包版就是以前的 play.bat，开发版就是以前的 start.bat。')}` : ''}
      <h3>关于<em>About</em></h3>
      ${row('版本', `<span class="num">${esc(s.version)}</span>`)}
      ${row('存档', `<button class="btn sm" data-act="opendata">${I.folder}打开存档文件夹</button>`)}
    </div>`);
  }

  /* ---------- 画 ---------- */

  function render() {
    const s = ui.snap;
    if (!s) return;
    stage.classList.toggle('on-page', ui.page !== 'home');
    paint($('#side'), sideHtml());
    paint($('#badge'), s.test_copy ? '<span class="testchip glass"><i></i>测试版 · 分身文件夹里的副本</span>' : '');
    if (ui.page === 'home') {
      paint($('#status'), statusHtml(s));
      paint($('#dock'), dockHtml(s));
      paint($('#pop'), popHtml(s));
      paint($('#page'), '');
    } else {
      const html = ui.page === 'console' ? consoleHtml(s) : ui.page === 'voice' ? voiceHtml() : settingsHtml(s);
      const before = ui.keys.page;
      paint($('#page'), html);
      if (ui.page === 'console' && before !== html) {
        ui.logText = '';
        refreshLog();
      }
    }
  }

  function colorLog(lines) {
    return lines.map((line) => {
      const t = esc(line);
      if (/^\S+\s+\$ /.test(line)) return t; // 启动命令本身(带 --logLevel error 这种参数)不上色
      if (/error|traceback|exception|失败|出错/i.test(line)) return `<span class="er">${t}</span>`;
      if (/warn|警告/i.test(line)) return `<span class="wn">${t}</span>`;
      if (/startup complete|running on|ready in|好了/i.test(line)) return `<span class="ok">${t}</span>`;
      return t;
    }).join('\n');
  }

  async function refreshLog() {
    if (ui.page !== 'console' || !ui.logTab) return;
    let lines;
    try {
      lines = await api().logs(ui.logTab);
    } catch (e) {
      return;
    }
    const el = $('#log');
    const text = lines.join('\n');
    if (!el || text === ui.logText) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    ui.logText = text;
    el.innerHTML = colorLog(lines);
    if (atBottom || !el.dataset.seen) el.scrollTop = el.scrollHeight;
    el.dataset.seen = '1';
  }

  /** 问 Python 最多等这么久:有一次没回音(窗口藏起来又叫出来时碰到过)也不能把轮询卡死 */
  const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

  /** 后端刚起来那一下查得慢:没拿到就过几秒再问,问完都没有才说「还没有存档」 */
  async function loadLast(tries = 3) {
    if (ui.lastState === 'idle') ui.lastState = 'loading';
    let got = null;
    try {
      got = await within(api().last_play(), 15000);
    } catch (e) {
      got = null;
    }
    if (!got && tries > 1) {
      setTimeout(() => loadLast(tries - 1), 4000);
      return;
    }
    ui.last = got;
    ui.lastState = 'done';
    render();
  }

  /** again:自动检查时第一次有没通的,过 10 秒再测一次(后端刚起来时语音服务常常还没连上) */
  async function loadVoice(again = false) {
    if (ui.voiceBusy) return;
    ui.voiceBusy = true;
    render();
    try {
      ui.voice = await within(api().voice(), 30000);
    } catch (e) {
      ui.voice = ui.voice || [];
    }
    ui.voiceBusy = false;
    render();
    if (again && ui.voice.some((x) => !x.ok)) setTimeout(() => loadVoice(false), 10000);
  }

  async function poll() {
    try {
      ui.snap = await within(api().snapshot(), 5000);
      const s = ui.snap;
      if (s.phase === 'ready' && ui.prevPhase !== 'ready') {
        loadLast();
        loadVoice(true);
        if (s.settings.auto_start && !ui.autoStarted) {
          ui.autoStarted = true;
          call('start_game');
        }
      }
      if (ui.prevGame && !s.game_open) loadLast(); // 玩完回来,「上次玩的」可能换人了
      ui.prevPhase = s.phase;
      ui.prevGame = s.game_open;
      render();
    } catch (e) {
      /* Python 正忙 / 这次没回音:下次再问 */
    } finally {
      setTimeout(poll, 700);
    }
  }

  /* ---------- 点 ---------- */

  function go(page) {
    ui.page = page;
    ui.pop = null;
    if (page === 'voice' && ready()) loadVoice();
    if (page === 'settings') {
      // 这块屏幕多大:画面大小只列放得下的
      void call('screen').then((wh) => {
        ui.screen = wh || null;
        render();
      });
    }
    render();
  }

  async function act(name) {
    switch (name) {
      case 'start': {
        const r = await call('start_game');
        if (r && r.message) toast(r.message);
        break;
      }
      case 'gear':
        ui.pop = ui.pop === 'gear' ? null : 'gear';
        break;
      case 'closepop':
        ui.pop = null;
        break;
      case 'other': {
        ui.pop = null;
        const r = await call('open_other');
        if (r && r.message) toast(r.message);
        break;
      }
      case 'qr':
      case 'qr-lan':
      case 'qr-tailscale':
        ui.pop = 'qr';
        ui.qrKind = name === 'qr-tailscale' ? 'tailscale' : 'lan';
        ui.qr = null;
        render();
        ui.qr = await call('qr', ui.qrKind);
        break;
      case 'restart':
        ui.restartLater = false;
        ui.lastState = 'idle';
        await call('restart');
        break;
      case 'later':
        ui.restartLater = true;
        break;
      case 'copylogs': {
        const lines = await call('logs', ui.logTab);
        await call('copy', lines.join('\n'));
        toast('日志复制好了');
        break;
      }
      case 'openlogs':
        await call('open_logs');
        break;
      case 'opendata':
        await call('open_data');
        break;
      case 'voicecheck':
        await loadVoice();
        break;
      default:
        break;
    }
    render();
  }

  function bind() {
    stage.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-go],[data-act],[data-copy],[data-open],[data-tab],[data-banner],[data-logtab],[data-win],[data-seg] > button');
      if (!t || t.disabled) return;
      e.preventDefault();
      if (t.dataset.go) return go(t.dataset.go);
      if (t.dataset.win) return call(t.dataset.win === 'min' ? 'minimize' : 'close');
      if (t.dataset.copy) {
        await call('copy', t.dataset.copy);
        return toast(`已复制 ${hostOf(t.dataset.copy)}`);
      }
      if (t.dataset.open) return call('open_url', t.dataset.open);
      if (t.dataset.tab) {
        ui.noticeTab = t.dataset.tab;
        return paint($('#notice'), noticeHtml(ui.notice));
      }
      if (t.dataset.banner) {
        ui.bannerAt = Number(t.dataset.banner);
        return paint($('#notice'), noticeHtml(ui.notice));
      }
      if (t.dataset.logtab) {
        ui.logTab = t.dataset.logtab;
        return render();
      }
      if (t.parentElement && t.parentElement.dataset.seg) {
        ui.snap = await call('set_setting', t.parentElement.dataset.seg, t.dataset.v);
        return render();
      }
      return act(t.dataset.act);
    });
    stage.addEventListener('change', async (e) => {
      const t = e.target;
      try {
        if (t.dataset.sw) ui.snap = await call('set_setting', t.dataset.sw, t.checked);
        if (t.dataset.num) ui.snap = await call('set_setting', t.dataset.num, parseInt(t.value, 10));
      } catch (err) {
        ui.keys.page = null; // 改不进去:按原值重画
      }
      render();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (ui.pop) ui.pop = null;
      else if (ui.page !== 'home') ui.page = 'home';
      render();
    });
  }

  async function init() {
    if (stage) return;
    stage = $('#stage');
    fit();
    addEventListener('resize', fit);
    paint($('#win'), `<button data-win="min" title="最小化">${I.min}</button><button class="x" data-win="close" title="关闭">${I.close}</button>`);
    bind();
    try {
      ui.notice = await (await fetch('notice.json', { cache: 'no-store' })).json();
      paint($('#notice'), noticeHtml(ui.notice));
    } catch (e) {
      $('#notice').hidden = true;
    }
    const mock = window.MOCK || {};
    if (mock.page) ui.page = mock.page;
    if (mock.pop) ui.pop = mock.pop;
    if (mock.pop === 'qr') ui.qr = await api().qr();
    poll();
    setInterval(refreshLog, 1000);
  }

  if (window.pywebview && window.pywebview.api) init();
  else window.addEventListener('pywebviewready', init);
})();
