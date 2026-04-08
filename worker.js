/**
 * =================================================================================
 * Cloudflare Worker Emby 控制面板 (高精度定位修复版 + HTTPS 兼容 + 极致间距)
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

const FRONTEND_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <title>Emby 控制面板</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="icon" type="image/png" href="/icon.png">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg-color: #f8fafc; --panel-bg: rgba(255, 255, 255, 0.85); --modal-bg: #ffffff;
      --text-main: #0f172a; --text-soft: #475569; --text-muted: #94a3b8;
      --border: rgba(226, 232, 240, 0.8); --primary: #6366f1;
      --gradient-brand: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      --shadow-lg: 0 20px 40px -15px rgba(99, 102, 241, 0.15);
    }
    html.dark {
      --bg-color: #0f172a; --panel-bg: rgba(30, 41, 59, 0.75); --modal-bg: #1e293b;
      --text-main: #f8fafc; --text-soft: #cbd5e1; --text-muted: #64748b;
      --border: rgba(51, 65, 85, 0.8); --primary: #818cf8;
    }
    * { box-sizing: border-box; transition: background-color 0.2s; }
    body { margin: 0; font-family: -apple-system, sans-serif; background-color: var(--bg-color); color: var(--text-main); min-height: 100vh; overflow-x: hidden; }
    .page { padding: 1rem; width: min(100%, 1200px); margin: 0 auto; }
    .panel { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow-lg); backdrop-filter: blur(10px); padding: 0.8rem; margin-bottom: 0.8rem; }
    .hero__title { font-size: 1.4rem; margin: 0; font-weight: 800; display: flex; align-items: center; justify-content: space-between; }
    .button { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; border: none; border-radius: 999px; padding: 0.5rem 1rem; font-weight: 600; cursor: pointer; font-size: 0.85rem; }
    .button--primary { background: var(--gradient-brand); color: white; }
    .button--secondary { background: transparent; color: var(--text-main); border: 1px solid var(--border); }
    .chart-container { position: relative; height: 160px; width: 100%; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th, td { padding: 0.5rem; border-bottom: 1px solid var(--border); text-align: left; }
    #auth-screen { position: fixed; inset: 0; z-index: 9999; background: var(--bg-color); display: flex; align-items: center; justify-content: center; padding: 1rem;}
    .input-field { width: 100%; padding: 0.8rem; border-radius: 10px; border: 2px solid var(--border); background: var(--modal-bg); color: var(--text-main); margin-bottom: 1rem; outline: none;}
    .modal { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .modal[hidden] { display: none !important; }
    .modal-overlay { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(8px); }
    .modal-content { position: relative; width: 100%; max-width: 400px; background: var(--modal-bg); border-radius: 16px; padding: 1rem; }
    .st-item { display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding: 0.5rem 0; font-size: 0.85rem;}
    .st-label { color: var(--text-soft); }
    .st-val { font-weight: 700; }
  </style>
</head>
<body>

  <div id="auth-screen">
    <div class="panel" style="width: 100%; max-width: 320px; text-align: center;">
      <h3 style="margin-top:0">🔒 访问验证</h3>
      <input type="password" id="auth-input" class="input-field" placeholder="密码">
      <button id="auth-btn" class="button button--primary" style="width: 100%;">确认</button>
    </div>
  </div>

  <main class="page" id="main-content" style="display: none;">
    <div class="panel">
      <div class="hero__title">
        <span>🚀 Emby 数据大屏</span>
        <button id="theme-toggle" class="button button--secondary" style="padding:0.4rem">🌓</button>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-top: 0.8rem;">
        <button id="btn-open-speedtest" class="button button--primary">⚡️ 测速中心</button>
        <button id="stats-refresh" class="button button--secondary">🔄 刷新</button>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.8rem;">
      <div class="panel">
        <div style="font-weight:700; font-size:0.9rem">📈 播放趋势</div>
        <div class="chart-container"><canvas id="trendChart"></canvas></div>
      </div>
      <div class="panel">
        <div style="font-weight:700; font-size:0.9rem">📱 客户端占比</div>
        <div class="chart-container"><canvas id="deviceChart"></canvas></div>
      </div>
    </div>

    <div class="panel">
      <div style="font-weight:700; font-size:0.9rem; margin-bottom:0.5rem">👥 播放排行 (近10日)</div>
      <table>
        <thead><tr><th>IP地址</th><th>客户端</th><th>时长</th></tr></thead>
        <tbody id="user-stats-body"></tbody>
      </table>
    </div>
  </main>

  <div id="speedtest-modal" class="modal" hidden>
    <div class="modal-overlay" onclick="document.getElementById('speedtest-modal').hidden=true"></div>
    <div class="modal-content">
      <h3 style="margin:0 0 0.8rem 0">⚡️ 精准网络诊断</h3>
      <div class="st-item"><span class="st-label">当前 IP:</span><span id="st-ip" class="st-val">--</span></div>
      <div class="st-item"><span class="st-label">地理位置:</span><span id="st-loc" class="st-val" style="color:var(--primary)">--</span></div>
      <div class="st-item"><span class="st-label">运营商:</span><span id="st-isp" class="st-val">--</span></div>
      <div class="st-item"><span class="st-label">CF 节点:</span><span id="st-colo" class="st-val">--</span></div>
      <div class="st-item"><span class="st-label">Ping 延迟:</span><span id="st-ping" class="st-val">--</span></div>
      <div class="st-item"><span class="st-label">实测带宽:</span><b id="st-speed" style="color:var(--primary)">--</b></div>
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
    const checkAuth = async (token) => {
      if(!token) return;
      const res = await fetch('/auth/verify', { headers: {'X-Api-Key': token} });
      if (res.ok) {
        API_TOKEN = token; localStorage.setItem('emby-token', token);
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';
        loadData();
      }
    };
    document.getElementById('auth-btn').onclick = () => checkAuth(document.getElementById('auth-input').value);
    if(API_TOKEN) checkAuth(API_TOKEN);

    async function loadData() {
      const res = await fetch('/stats', { headers: {'X-Api-Key': API_TOKEN} });
      const payload = await res.json();
      const d = payload.data;
      document.getElementById('user-stats-body').innerHTML = d.userStats.map(u => '<tr><td>' + u.ip.split('.').slice(0,2).join('.') + '.*</td><td>' + u.client_name + '</td><td>' + Math.round(u.duration_sec/60) + '分</td></tr>').join('');
      
      if(trendChart) trendChart.destroy();
      trendChart = new Chart(document.getElementById('trendChart'), {
        type: 'line',
        data: {
          labels: d.dailyStats.map(s => s.date.slice(5)).reverse(),
          datasets: [{ data: d.dailyStats.map(s => s.playing_count).reverse(), borderColor: '#6366f1', fill: true, tension: 0.4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });

      if(deviceChart) deviceChart.destroy();
      deviceChart = new Chart(document.getElementById('deviceChart'), {
        type: 'doughnut',
        data: {
          labels: d.clientStats.map(c => c.client_name),
          datasets: [{ data: d.clientStats.map(c => c.total_count), backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ec4899'] }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }
      });
    }

    document.getElementById('btn-open-speedtest').onclick = () => document.getElementById('speedtest-modal').hidden = false;
    
    document.getElementById('st-start-btn').onclick = async () => {
      const btn = document.getElementById('st-start-btn');
      btn.disabled = true; btn.textContent = '🚀 精准定位中...';
      try {
        // 1. 获取基本信息 (增加 cache: "no-store" 绕过缓存)
        const tr = await (await fetch('/trace', { headers: {'X-Api-Key': API_TOKEN}, cache: "no-store" })).json();
        document.getElementById('st-ip').textContent = tr.ip;
        document.getElementById('st-colo').textContent = tr.colo;
        
        // 2. 💡 HTTPS 兼容定位接口 (ipapi.co)
        try {
          const geo = await (await fetch('https://ipapi.co/json/')).json();
          // ipapi.co 返回省份名和运营商
          document.getElementById('st-loc').textContent = geo.region + ' ' + geo.city;
          document.getElementById('st-isp').textContent = geo.org || '未知运营商';
        } catch(e) { 
          document.getElementById('st-loc').textContent = tr.loc;
          document.getElementById('st-isp').textContent = '识别失败 (HTTPS限制)';
        }
        
        btn.textContent = '测延迟...';
        const start = performance.now();
        await fetch('/trace', { method: 'HEAD', headers: {'X-Api-Key': API_TOKEN}, cache: "no-store" });
        document.getElementById('st-ping').textContent = Math.round(performance.now() - start) + 'ms';
        
        btn.textContent = '全速下行中...';
        const sStart = performance.now();
        const res = await fetch('/speedtest', { headers: {'X-Api-Key': API_TOKEN} });
        const blob = await res.blob();
        const mbps = ((blob.size * 8) / (1024*1024) / ((performance.now() - sStart) / 1000)).toFixed(2);
        document.getElementById('st-speed').textContent = mbps + ' Mbps';
      } catch(e) { alert('测速中断，请检查网络'); }
      btn.disabled = false; btn.textContent = '再次测试';
    };
    document.getElementById('stats-refresh').onclick = loadData;
  </script>
</body>
</html>
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // PWA 资源路由
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

    // 地区拦截
    if (request.cf?.country && !ALLOWED_COUNTRIES.includes(request.cf.country)) return new Response('Blocked', { status: 403 });

    // 鉴权
    const authKey = request.headers.get('X-Api-Key');
    const isApi = ['/stats', '/trace', '/speedtest', '/auth/verify'].includes(url.pathname);
    if (isApi) {
      if (authKey !== PANEL_PASSWORD) return new Response('Unauthorized', { status: 401 });
      if (url.pathname === '/auth/verify') return new Response('OK');
    }

    if (url.pathname === '/') return new Response(FRONTEND_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/stats') return handleStatsRequest(env);
    
    // 🚀 /trace 增加禁用缓存响应头，修复定位和延迟测量的准确性
    if (url.pathname === '/trace') {
      return new Response(JSON.stringify({
        ip: request.headers.get('cf-connecting-ip'),
        loc: (request.cf?.city || '') + ' ' + (request.cf?.country || ''),
        colo: request.cf?.colo || 'N/A'
      }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
    }

    if (url.pathname === '/speedtest') {
      return new Response(new ReadableStream({
        start(c) { for(let i=0; i<8; i++) c.enqueue(SPEEDTEST_CHUNK); c.close(); }
      }), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
    }

    // 核心反代逻辑
    let upstream;
    try {
      let p = url.pathname.slice(1).replace(/^(https?)\/(?!\/)/, '$1://');
      if (!/^https?:\/\//i.test(p)) p = 'https://' + p;
      upstream = new URL(p); upstream.search = url.search;
    } catch { return new Response('Invalid', { status: 400 }); }

    const clientRaw = request.headers.get('X-Emby-Client') || 'Device';
    let clientName = clientRaw;
    if (clientRaw.toLowerCase().includes('vidhub')) clientName = 'VidHub';
    else if (clientRaw.toLowerCase().includes('popcorn') || clientRaw.includes('爆米花')) clientName = '网易爆米花';
    else if (clientRaw.toLowerCase().includes('infuse')) clientName = 'Infuse';

    if (upstream.pathname.includes('/Playing/Progress')) {
      ctx.waitUntil(recordUserAudit(env, request.headers.get('cf-connecting-ip') || '0.0.0.0', clientName, 10));
    }
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
  const col = type === 'playing' ? 'playing_count' : 'playback_info_count';
  const sql = "INSERT INTO auto_emby_daily_stats (date, " + col + ") VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET " + col + " = " + col + " + 1";
  await env.DB.prepare(sql).bind(today).run();
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
    env.DB.prepare("SELECT date, playing_count FROM auto_emby_daily_stats ORDER BY date DESC LIMIT 10"),
    env.DB.prepare("SELECT ip, client_name, SUM(duration_sec) as duration_sec FROM auto_emby_user_stats GROUP BY ip, client_name ORDER BY duration_sec DESC LIMIT 10"),
    env.DB.prepare("SELECT client_name, SUM(count) as total_count FROM auto_emby_client_stats GROUP BY client_name ORDER BY total_count DESC LIMIT 5")
  ]);
  return new Response(JSON.stringify({
    ok: true, enabled: true,
    data: { dailyStats: batch[0].results, userStats: batch[1].results, clientStats: batch[2].results }
  }));
}
