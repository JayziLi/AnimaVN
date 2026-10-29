/* 假的 Python(只给截图自查用):ui/index.html?mock=1&state=ready|boot|failed|playing|restart&page=home|console|voice|settings&pop=gear|qr&kind=repo|portable */
(function () {
  const q = new URLSearchParams(location.search);
  const st = q.get('state') || 'ready';
  const settings = { open_in: 'window', after_start: 'stay', game_display: 'fullscreen', game_size: '1920x1080', auto_start: false, terminal: false, lan: true, port: 8000, auto_update: true, dev_mode: 'build' };
  const snap = {
    phase: st === 'boot' ? 'preparing' : st === 'failed' ? 'failed' : 'ready',
    message: st === 'boot' ? '正在打包游戏页面……' : st === 'failed' ? '端口 8000 被别的程序占着。关掉以前开的 start.bat / play.bat 黑窗口，再点「重试」。' : '',
    kind: q.get('kind') || 'repo',
    version: '源码文件夹 · feat/game-launcher',
    settings,
    restart_needed: st === 'restart',
    test_copy: q.get('test') === '1',
    game_open: st === 'playing',
    game_url: 'http://localhost:5180/debug.html?play=1',
    lan_url: 'http://192.168.1.23:5180/debug.html?play=1',
    tailscale_url: 'http://100.101.102.103:5180/debug.html?play=1',
    logs: [{ name: 'build', label: '打包游戏页面', alive: false, reused: false },
      { name: 'backend', label: '后端', alive: true, reused: false },
      { name: 'web', label: '游戏页面', alive: true, reused: false }],
    hints: st === 'failed' ? ['端口被别的程序占着。关掉以前开的 start.bat / play.bat 黑窗口，或者到设置里换一个端口。'] : [],
  };
  const ok = (v) => Promise.resolve(v);
  window.pywebview = {
    api: {
      snapshot: () => ok(snap),
      screen: () => ok([2560, 1440]),
      logs: () => ok(['21:20:03  $ npx vite build --logLevel error', '21:20:11  INFO:     Uvicorn running on http://0.0.0.0:8000',
        '21:20:12  INFO:     Application startup complete.', '21:21:52  POST /api/debug/stream 200', '21:24:07  WARNING: 语音服务慢了']),
      last_play: () => ok({ card_id: 'k', card_name: '星绘', chat_name: '夜路', avatar: '' }),
      voice: () => ok([{ id: 'a', name: '台式机', kind: 'GPT-SoVITS', url: 'http://192.168.1.50:9880', voices: 3, ok: true, ms: 42, error: '' },
        { id: 'b', name: 'IndexTTS', kind: 'IndexTTS-2.5', url: 'http://192.168.1.50:9890', voices: 0, ok: false, ms: null, error: '连不上语音服务' }]),
      qr: (kind) => ok({ url: kind === 'tailscale' ? snap.tailscale_url : snap.lan_url, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7"><path fill="#1e1e26" d="M0 0h3v3H0zM4 4h3v3H4zM4 0h1v1H4z"/></svg>' }),
      start_game: () => ok({ ok: true, message: '' }),
      open_other: () => ok({ ok: true, message: '在默认浏览器里打开了' }),
      copy: () => ok(true),
      open_url: () => ok(true),
      open_logs: () => ok(true),
      open_data: () => ok(true),
      set_setting: (k, v) => { settings[k] = v; return ok(snap); },
      restart: () => ok(true),
      minimize: () => ok(true),
      close: () => ok(true),
    },
  };
  window.MOCK = { page: q.get('page'), pop: q.get('pop') };
})();
