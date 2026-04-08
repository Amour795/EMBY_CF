/**
 * =================================================================================
 * Cloudflare Worker Emby 数据大屏 (精准客户端识别版 + 极致间距 + 安全锁)
 * =================================================================================
 */

// 🔐 安全锁：控制台访问密码
const PANEL_PASSWORD = 'emby';

// 🛡️ 核心防御：仅允许大陆访问
const ALLOWED_COUNTRIES = ['CN'];

const MANUAL_REDIRECT_DOMAINS = ['emby.bangumi.ca','aliyundrive.com','aliyundrive.net','aliyuncs.com','alicdn.com','aliyun.com','cdn.aliyundrive.com','xunlei.com','xlusercdn.com','xycdn.com','sandai.net','thundercdn.com','115.com','115cdn.com','115cdn.net','anxia.com','189.cn','mini189.cn','ctyunxs.cn','cloud.189.cn','tianyiyun.com','telecomjs.com','quark.cn','quarkdrive.cn','uc.cn','ucdrive.cn','xiaoya.pro','myqcloud.com','cloudfront.net','akamaized.net','fastly.net','hwcdn.net','bytecdn.cn','bdcdn.net'];
const DOMAIN_PROXY_RULES = { 'biliblili.uk': 'example.com' };
const JP_COLOS = ['NRT', 'KIX', 'FUK', 'OKA'];
const MAX_REDIRECTS = 5;
const SPEEDTEST_CHUNK = new Uint8Array(1024 * 1024);

// 🎨 前端界面代码
const FRONTEND_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <title>Emby 客户端大屏</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#f8fafc" id="meta-theme-color">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="icon" type="image/png" href="/icon.png">
  <link rel="apple-touch-icon" href="/icon.png">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg-color: #f8fafc; --panel-bg: rgba(255, 255, 255, 0.85); --modal-bg: #ffffff;
      --text-main: #0f172a; --text-soft: #475569; --text-muted: #94a3b8;
      --border: rgba(226, 232, 240, 0.8); --table-head: #f8fafc; --table-hover: #e0e7ff;
      --code-bg: #f1f5f9; --primary: #6366f1; --primary-hover: #4f46e5; --primary-light: #e0e7ff;
      --gradient-brand: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      --gradient-text: linear-gradient(135deg, #4338ca 0%, #7e22ce 100%);
      --shadow-lg: 0 20px 40px -15px rgba(99, 102, 241, 0.15);
      --grid-gradient: radial-gradient(at 10% 10%, rgba(99, 102, 241, 0.12) 0px, transparent 50%), radial-gradient(at 90% 10%, rgba(168, 85, 247, 0.12) 0px, transparent 50%), radial-gradient(at 50% 90%, rgba(14, 165, 233, 0.12) 0px, transparent 50%);
    }
    html.dark {
      --bg-color: #0f172a; --panel-bg: rgba(30, 41, 59, 0.75); --modal-bg: #1e293b;
      --text-main: #f8fafc; --text-soft: #cbd5e1; --text-muted: #64748b;
      --border: rgba(51, 65, 85, 0.8); --table-head: #0f172a; --table-hover: rgba(99, 102, 241, 0.2);
      --code-bg: #0f172a; --primary: #818cf8; --primary-light: rgba(99, 102, 241, 0.2);
      --gradient-text: linear-gradient(135deg, #a5b4fc 0%, #d8b4fe 100%);
      --grid-gradient: radial-gradient(at 10% 10%, rgba(99, 102, 241, 0.08) 0px, transparent 50%), radial-gradient(at 90% 10%, rgba(168, 85, 247, 0.08) 0px, transparent 50%);
    }
    * { box-sizing: border-box; transition: background-color 0.3s, border-color 0.3s; }
    body { margin: 0; font-family: -apple-system, sans-serif; background-color: var(--bg-color); background-image: var(--grid-gradient); color: var(--text-main); min-height: 100vh; overflow-x: hidden; }
    
    .page { padding: 1rem; width: min(100%, 1200px); margin: 0 auto; }
    .panel { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow-lg); backdrop-filter: blur(20px); padding: 0.8rem; margin-bottom: 0.8rem; }
    
    .hero__title { font-size: 1.4rem; margin: 0; font-weight: 800; }
    .hero__title span { background: var(--gradient-text); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    
    .button { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; border: none; border-radius: 999px; padding: 0.5rem 1rem; font-weight: 600; cursor: pointer; font-size: 0.85rem; }
    .button--primary { background: var(--gradient-brand); color: white; }
    .button--secondary { background: transparent; color: var(--text-main); border: 1px solid var(--border); }
    
    .stat-val { font-size: 1.5rem; font-weight: 800; color: var(--primary); }
    .stat-label { font-size: 0.75rem; color: var(--text-soft); }
    
    .chart-container { position: relative; height: 180px; width: 100%; margin-top: 0.5rem;}
    
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th, td { padding: 0.5rem; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); text-align: left; }
    
    #auth-screen { position: fixed; inset: 0; z-index: 9999; background: var(--bg-color); display: flex; align-items: center; justify-content: center; padding: 1rem;}
    
    .modal { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .modal[hidden] { display: none !important; }
    .modal-overlay { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(8px); }
    .modal-content { position: relative; width: 100%; max-width: 400px; background: var(--modal-bg); border-radius: 20px; padding: 1rem; z-index: 1001; }
    
    .st-item { display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding: 0.4rem 0; font-size: 0.85rem;}
    .badge { padding: 0.2rem 0.5rem; border-radius: 999px; font-size: 0.7rem; font-weight: 700; background: rgba(16, 185, 129, 0.15); color: #10b981; }
  </style>
</head>
<body>

  <div id="auth-screen">
    <div class="panel" style="width: 100%; max-width: 320px; text-align: center;">
      <h3 style="margin-top:0">身份验证</h3>
      <input type="password" id="auth-input" style="width:100%; padding:0.8rem; border-radius:10px; border:1px solid var(--border); margin-bottom:1rem" placeholder="密码">
      <button id="auth-btn" class="button button--primary" style="width: 100%;">解锁进入</button>
    </div>
  </div>

  <main class="page" id="main-content" style="display: none;">
    <div class="panel">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem">
        <h1 class="hero__title">🚀 Emby <span>客户端大屏</span></h1>
        <button id="theme-toggle" class="button button--secondary" style="border-radius:50%; width:30px; height:30px; padding:0">🌓</button>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <button id="btn-open-speedtest" class="button button--primary">⚡️ 开始测速</button>
        <button id="stats-refresh" class="button button--secondary">🔄 刷新</button>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0.8rem;">
      <div class="panel">
        <div style="font-weight:700; font-size:0.9rem">📈 播放趋势 (近10日)</div>
        <div class="chart-container"><canvas id="trendChart"></canvas></div>
      </div>
      <div class="panel">
        <div style="font-weight:700; font-size:0.9rem">📱 客户端分布 (30日)</div>
        <div class="chart-container"><canvas id="deviceChart"></canvas></div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.8rem; margin-top:0.8rem">
      <div class="panel" style="text-align:center">
        <div class="stat-val" id="total-playing">0</div>
        <div class="stat-label">总播放</div>
      </div>
      <div class="panel" style="text-align:center">
        <div class="stat-val" id="total-playback-info">0</div>
        <div class="stat-label">获取链接</div>
      </div>
    </div>

    <div class="panel">
      <div style="font-weight:700; font-size:0.9rem; margin-bottom:0.5rem">👥 详细审计 (VidHub / 爆米花等)</div>
      <table id="user-stats-table">
        <thead><tr><th>IP地址</th><th>使用的客户端</th><th>累计时长</th></tr></thead>
        <tbody id="user-stats-body"></tbody>
      </table>
    </div>
  </main>

  <div id="speedtest-modal" class="modal" hidden>
    <div class="modal-overlay" onclick="document.getElementById('speedtest-modal').hidden=true"></div>
    <div class="modal-content">
      <h3 style="margin:0 0 0.8rem 0">⚡️ 网络诊断</h3>
      <div class="st-item"><span>当前 IP</span><span id="st-ip" style="font-weight:700">--</span></div>
      <div class="st-item"><span>物理位置</span><span id="st-loc" style="font-weight:700">--</span></div>
      <div class="st-item"><span>CF 节点</span><span id="st-colo" style="font-weight:700">--</span></div>
      <div class="st-item"><span>Ping 延迟</span><span id="st-ping" style="font-weight:700">--</span></div>
      <div class="st-item"><span>下载带宽</span><b id="st-speed" style="color:var(--primary)">--</b></div>
      <button id="st-start-btn" class="button button--primary" style="width: 100%; margin-top: 1rem;">开始测试</button>
      <button onclick="document.getElementById('speedtest-modal').hidden=true" class="button button--secondary" style="width: 100%; margin-top: 0.5rem;">关闭</button>
    </div>
  </div>

  <script>
    let trendChart, deviceChart;

    const setDark = (d) => {
      document.documentElement.classList.toggle('dark', d);
      localStorage.setItem('theme', d ? 'dark' : 'light');
    };
    setDark(localStorage.getItem('theme') === 'dark');
    document.getElementById('theme-toggle').onclick = () => setDark(!document.documentElement.classList.contains('dark'));

    let API_TOKEN = localStorage.getItem('emby-token') || '';
    const authScreen = document.getElementById('auth-screen');
    const mainContent = document.getElementById('main-content');

    const checkAuth = async (token) => {
      if(!token) return;
      const res = await fetch('/auth/verify', { headers: {'X-Api-Key': token} });
      if (res.ok) {
        API_TOKEN = token; localStorage.setItem('emby-token', token);
        authScreen.style.display = 'none'; mainContent.style.display = 'block';
        loadData();
      } else { alert('验证失败'); }
    };

    document.getElementById('auth-btn').onclick = () => checkAuth(document.getElementById('auth-input').value);
    if (API_TOKEN) checkAuth(API_TOKEN);

    async function loadData() {
      const res = await fetch('/stats', { headers: {'X-Api-Key': API_TOKEN} });
      const json = await res.json();
      const d = json.data;

      document.getElementById('total-playing').textContent = d.total.playing;
      document.getElementById('total-playback-info').textContent = d.total.playbackInfo;
      document.getElementById('user-stats-body').innerHTML = d.userStats.map(u => \`<tr><td>\${u.ip.split('.').slice(0,2).join('.')}.*</td><td>\${u.client_name}</td><td>\${Math.round(u.duration_sec/60)}分</td></tr>\`).join('');

      const ctxTrend = document.getElementById('trendChart').getContext('2d');
      if(trendChart) trendChart.destroy();
      trendChart = new Chart(ctxTrend, {
        type: 'line',
        data: {
          labels: d.dailyStats.map(s => s.date.slice(5)).reverse(),
          datasets: [{ label: '播放', data: d.dailyStats.map(s => s.playing_count).reverse(), borderColor: '#6366f1', tension: 0.4, fill: true, backgroundColor: 'rgba(99, 102, 241, 0.1)' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });

      const ctxDevice = document.getElementById('deviceChart').getContext('2d');
      if(deviceChart) deviceChart.destroy();
      deviceChart = new Chart(ctxDevice, {
        type: 'doughnut',
        data: {
          labels: d.clientStats.map(c => c.client_name),
          datasets: [{ data: d.clientStats.map(c => c.total_count), backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#a855f7', '#0ea5e9'] }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }
      });
    }

    document.getElementById('btn-open-speedtest').onclick = () => document.getElementById('speedtest-modal').hidden = false;
    
    document.getElementById('st-start-btn').onclick = async () => {
      const btn = document.getElementById('st-start-btn');
      btn.disabled = true; btn.textContent = '检测信息...';
      try {
        const trRes = await fetch('/trace', { headers: {'X-Api-Key': API_TOKEN} });
        const trace = await trRes.json();
        document.getElementById('st-ip').textContent = trace.ip;
        document.getElementById('st-loc').textContent = trace.loc;
        document.getElementById('st-colo').textContent = trace.colo;

        btn.textContent = '测Ping...';
        const start = performance.now();
        await fetch('/trace', { method: 'HEAD', headers: {'X-Api-Key': API_TOKEN} });
        document.getElementById('st-ping').textContent = Math.round(performance.now() - start) + 'ms';
        
        btn.textContent = '测宽带...';
        const sStart = performance.now();
        const res = await fetch('/speedtest', { headers: {'X-Api-Key': API_TOKEN} });
        const blob = await res.blob();
        const dur = (performance.now() - sStart) / 1000;
        document.getElementById('st-speed').textContent = ((blob.size * 8) / (1024*1024) / dur).toFixed(2) + ' Mbps';
      } catch(e) { alert('测速失败'); }
      btn.disabled = false; btn.textContent = '再次测试';
    };
    document.getElementById('stats-refresh').onclick = loadData;
  </script>
</body>
</html>
`;

export default {
  async fetch(request, env, ctx) {
    const country = request.cf?.country;
    if (country && !ALLOWED_COUNTRIES.includes(country)) return new Response('Blocked', { status: 403 });

    const url = new URL(request.url);

    // PWA & 资源路由
    if (url.pathname === '/icon.png') {
      const icon = await fetch('https://raw.githubusercontent.com/google/material-design-icons/master/png/device/wallpaper/materialicons/48dp/1x/baseline_wallpaper_black_48dp.png');
      return new Response(icon.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' } });
    }
    if (url.pathname === '/manifest.json') {
      return new Response(JSON.stringify({
        name: "Emby 控制台", short_name: "EmbyDash", start_url: "/", display: "standalone",
        background_color: "#f8fafc", theme_color: "#6366f1",
        icons: [{ src: "/icon.png", sizes: "48x48", type: "image/png" }]
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/sw.js') return new Response("self.addEventListener('fetch',()=>{})", { headers: { 'Content-Type': 'application/javascript' } });

    // 鉴权
    const authKey = request.headers.get('X-Api-Key');
    const isApi = ['/stats', '/trace', '/speedtest', '/auth/verify'].includes(url.pathname);
    if (isApi) {
      if (authKey !== PANEL_PASSWORD) return new Response('Unauthorized', { status: 401 });
      if (url.pathname === '/auth/verify') return new Response('OK');
    }

    if (url.pathname === '/') return new Response(FRONTEND_HTML, { headers: { 'Content-Type': 'text/html' } });
    if (url.pathname === '/stats') return handleStatsRequest(env);
    if (url.pathname === '/trace') {
      return new Response(JSON.stringify({
        ip: request.headers.get('cf-connecting-ip'),
        loc: (request.cf?.city || '') + ' ' + (request.cf?.country || ''),
        colo: request.cf?.colo || 'N/A'
      }));
    }
    if (url.pathname === '/speedtest') {
      return new Response(new ReadableStream({
        start(c) { for(let i=0; i<8; i++) c.enqueue(SPEEDTEST_CHUNK); c.close(); }
      }));
    }

    // --- 核心反代 & 客户端识别逻辑 ---
    let upstream;
    try {
      let p = url.pathname.slice(1).replace(/^(https?)\/(?!\/)/, '$1://');
      if (!/^https?:\/\//i.test(p)) p = 'https://' + p;
      upstream = new URL(p);
      upstream.search = url.search;
    } catch { return new Response('Invalid', { status: 400 }); }

    // 🚀 识别客户端 (vidhub / 爆米花等)
    const clientRaw = request.headers.get('X-Emby-Client') || request.headers.get('X-Emby-Device-Name') || 'Web Browser';
    let clientName = clientRaw;
    
    // 逻辑清洗：把冗长的 User-Agent 或设备型号清洗成直观的 App 名字
    if (clientRaw.toLowerCase().includes('vidhub')) clientName = 'VidHub';
    else if (clientRaw.toLowerCase().includes('popcorn') || clientRaw.includes('爆米花')) clientName = '网易爆米花';
    else if (clientRaw.toLowerCase().includes('infuse')) clientName = 'Infuse';
    else if (clientRaw.toLowerCase().includes('fileball')) clientName = 'Fileball';
    else if (clientRaw.toLowerCase().includes('android') && clientRaw.includes('emby')) clientName = 'Emby Android';
    else if (clientRaw.toLowerCase().includes('iphone') && clientRaw.includes('emby')) clientName = 'Emby iOS';

    // 观影心跳统计 (10秒累加)
    if (upstream.pathname.includes('/Playing/Progress')) {
      const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
      ctx.waitUntil(recordUserAudit(env, ip, clientName, 10));
    }

    // 基础播放次数统计
    if (upstream.pathname.endsWith('/Sessions/Playing') || upstream.pathname.includes('/PlaybackInfo')) {
      ctx.waitUntil(recordBasicStats(env, upstream.pathname.endsWith('/Sessions/Playing') ? 'playing' : 'playback', clientName));
    }

    const options = { method: request.method, headers: new Headers(request.headers) };
    options.headers.set('Host', upstream.host);
    if (/\.(jpeg|jpg|png|gif|css|js|woff2)$/i.test(upstream.pathname)) options.cf = { cacheTtl: 7200, cacheEverything: true };

    return fetch(upstream.toString(), options);
  }
};

async function recordBasicStats(env, type, client) {
  if (!env.DB) return;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  if (type === 'playing') {
    await env.DB.prepare("INSERT INTO auto_emby_daily_stats (date, playing_count) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET playing_count = playing_count + 1").bind(today).run();
  } else {
    await env.DB.prepare("INSERT INTO auto_emby_daily_stats (date, playback_info_count) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET playback_info_count = playback_info_count + 1").bind(today).run();
  }
  // 记录客户端总量
  await env.DB.prepare("INSERT INTO auto_emby_client_stats (date, client_name, count) VALUES (?, ?, 1) ON CONFLICT(date, client_name) DO UPDATE SET count = count + 1").bind(today, client).run();
}

async function recordUserAudit(env, ip, client, sec) {
  if (!env.DB) return;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  await env.DB.prepare("INSERT INTO auto_emby_user_stats (date, ip, client_name, duration_sec) VALUES (?, ?, ?, ?) ON CONFLICT(date, ip, client_name) DO UPDATE SET duration_sec = duration_sec + ?").bind(today, ip, client, sec, sec).run();
}

async function handleStatsRequest(env) {
  if (!env.DB) return new Response(JSON.stringify({enabled:false}));
  const batch = await env.DB.batch([
    env.DB.prepare("SELECT COALESCE(SUM(playing_count),0) as playing, COALESCE(SUM(playback_info_count),0) as playbackInfo FROM auto_emby_daily_stats"),
    env.DB.prepare("SELECT date, playing_count FROM auto_emby_daily_stats ORDER BY date DESC LIMIT 10"),
    env.DB.prepare("SELECT ip, client_name, SUM(duration_sec) as duration_sec FROM auto_emby_user_stats GROUP BY ip, client_name ORDER BY duration_sec DESC LIMIT 15"),
    env.DB.prepare("SELECT client_name, SUM(count) as total_count FROM auto_emby_client_stats GROUP BY client_name ORDER BY total_count DESC LIMIT 8")
  ]);
  return new Response(JSON.stringify({
    ok: true, enabled: true,
    data: {
      total: batch[0].results[0],
      dailyStats: batch[1].results,
      userStats: batch[2].results,
      clientStats: batch[3].results
    }
  }));
}
