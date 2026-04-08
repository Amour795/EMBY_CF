/**
 * =================================================================================
 * Cloudflare Worker Emby 终极版 v10.1 (全量代码 + 无损拦截 + 环境变量驱动)
 * =================================================================================
 */

const SPEEDTEST_CHUNK = new Uint8Array(1024 * 1024);
let CACHED_CONFIG = { allowedRegions: [], blacklist: [], expire: 0 };

// 🛑 拦截界面 HTML
function getBlockedHTML(ip, cf, reason = 'region') {
  const countryMap = { 'CN': '中国大陆', 'HK': '中国香港', 'TW': '中国台湾', 'SG': '新加坡', 'JP': '日本', 'US': '美国' };
  const countryName = countryMap[cf.country] || cf.country || '未知国家';
  const cityName = cf.city || '未知城市';
  const isp = cf.asOrganization || '未知运营商';
  const colo = cf.colo || 'N/A';
  
  const title = reason === 'banned' ? '账号异常封禁' : '触发访问限制';
  const desc = reason === 'banned' ? '由于检测到您的 IP 存在异常行为，系统已将其永久拉黑。' : '站长开启了区域访问策略，您所在的地理位置暂不在服务范围内。';
  const icon = reason === 'banned' ? '🚫' : '🚧';

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><title>🛑 ${title}</title>
  <style>
    :root { --bg: #0f172a; --card-bg: rgba(30, 41, 59, 0.85); --text: #f8fafc; --accent: #6366f1; --border: rgba(255,255,255,0.1); }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 1rem; box-sizing: border-box; }
    .card { background: var(--card-bg); backdrop-filter: blur(16px); border: 1px solid var(--border); border-radius: 28px; padding: 2.5rem 2rem; width: 100%; max-width: 420px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .icon { font-size: 4.5rem; margin-bottom: 1.2rem; display: block; }
    h2 { font-size: 1.6rem; margin: 0 0 0.8rem; color: #ef4444; font-weight: 800; }
    p { color: #94a3b8; line-height: 1.6; font-size: 0.95rem; margin-bottom: 2rem; }
    .info-list { background: rgba(0,0,0,0.25); border-radius: 20px; padding: 1.2rem; text-align: left; border: 1px solid var(--border); }
    .info-item { display: flex; justify-content: space-between; padding: 0.7rem 0; font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .info-item:last-child { border-bottom: none; }
    .label { color: #64748b; }
    .val { font-family: monospace; color: var(--accent); font-weight: 600; }
  </style></head><body><div class="card"><span class="icon">${icon}</span><h2>${title}</h2><p>${desc}</p>
  <div class="info-list">
    <div class="info-item"><span class="label">IP:</span><span class="val">${ip}</span></div>
    <div class="info-item"><span class="label">位置:</span><span class="val">${countryName} · ${cityName}</span></div>
    <div class="info-item"><span class="label">运营商:</span><span class="val">${isp}</span></div>
    <div class="info-item"><span class="label">节点:</span><span class="val">${colo}</span></div>
  </div></div></body></html>`;
}

// 📊 数据大屏前端代码
const FRONTEND_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Emby 运维看板</title><script src="https://cdn.tailwindcss.com"></script><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><style>body{background:#0b0e14;color:#e2e8f0} .glass{background:rgba(23,28,36,0.8);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.05)}</style></head>
<body class="p-4 md:p-8"><div class="max-w-7xl mx-auto">
<div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Emby 流量审计中心</h1><div id="statusTag" class="px-3 py-1 rounded-full text-xs glass text-green-400 border-green-500/30">● 系统运行正常</div></div>
<div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
<div class="glass p-6 rounded-3xl text-center"><div class="text-gray-400 text-sm mb-2">当前活跃播放</div><div id="playingCount" class="text-4xl font-bold text-indigo-400">0</div></div>
<div class="glass p-6 rounded-3xl text-center"><div class="text-gray-400 text-sm mb-2">累计握手次数</div><div id="playbackCount" class="text-4xl font-bold text-cyan-400">0</div></div>
<div class="glass p-6 rounded-3xl text-center"><div class="text-gray-400 text-sm mb-2">昨日总时长</div><div id="yesterdayHours" class="text-4xl font-bold text-emerald-400">0 h</div></div>
<div class="glass p-6 rounded-3xl text-center"><div class="text-gray-400 text-sm mb-2">拦截危险 IP</div><div id="bannedCount" class="text-4xl font-bold text-rose-400">0</div></div></div>
<div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
<div class="glass p-8 rounded-3xl"><h3>播放趋势</h3><canvas id="trendChart"></canvas></div>
<div class="glass p-8 rounded-3xl"><h3>终端分布</h3><canvas id="clientChart"></canvas></div></div></div>
<script>
let key = localStorage.getItem('emby_key');
async function init(){
  if(!key){ key = prompt('请输入管理密码'); localStorage.setItem('emby_key', key); }
  const r = await fetch('/stats', {headers: {'X-Api-Key': key}});
  const res = await r.json();
  if(!res.ok) { localStorage.removeItem('emby_key'); location.reload(); }
  document.getElementById('playingCount').innerText = res.data.total.playing;
  document.getElementById('playbackCount').innerText = res.data.total.playbackInfo;
}
init();
</script></body></html>`;

// 🧠 核心逻辑
async function syncConfig(env) {
  if (!env.DB) return { allowedRegions: [], blacklist: [] };
  const now = Date.now();
  if (CACHED_CONFIG.expire > now) return CACHED_CONFIG;
  try {
    const resRegions = await env.DB.prepare("SELECT value FROM auto_emby_config WHERE key = 'allowed_regions'").first();
    CACHED_CONFIG.allowedRegions = resRegions ? JSON.parse(resRegions.value) : [];
    const resBan = await env.DB.prepare("SELECT ip FROM auto_emby_blacklist").all();
    CACHED_CONFIG.blacklist = resBan.results ? resBan.results.map(r => r.ip) : [];
    CACHED_CONFIG.expire = now + 60000;
  } catch(e) {}
  return CACHED_CONFIG;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const config = await syncConfig(env);
    const TARGET = env.TARGET_EMBY_SERVER;
    const PWD = env.PANEL_PASSWORD || 'emby';
    const clientIp = request.headers.get('cf-connecting-ip') || '127.0.0.1';
    const cf = request.cf || {};

    if (!TARGET) return new Response('⚠️ 请配置 TARGET_EMBY_SERVER 变量', { status: 500 });

    // 1. 拦截逻辑
    const isSpecial = url.pathname === '/dash' || url.pathname.startsWith('/api') || url.pathname === '/auth/verify';
    if (!isSpecial) {
      if (config.blacklist.includes(clientIp)) {
        return new Response(getBlockedHTML(clientIp, cf, 'banned'), { status: 403, headers: {'Content-Type': 'text/html;charset=utf-8'}});
      }
      if (config.allowedRegions.length > 0 && cf.country && !config.allowedRegions.includes(cf.country)) {
        return new Response(getBlockedHTML(clientIp, cf, 'region'), { status: 403, headers: {'Content-Type': 'text/html;charset=utf-8'}});
      }
    }

    // 2. 路由
    if (url.pathname === '/dash') return new Response(FRONTEND_HTML, { headers: {'Content-Type': 'text/html;charset=utf-8'}});
    
    if (['/stats', '/speedtest', '/auth/verify'].includes(url.pathname)) {
      if (request.headers.get('X-Api-Key') !== PWD) return new Response('Unauthorized', {status: 401});
      if (url.pathname === '/stats') return handleStatsRequest(env);
      if (url.pathname === '/speedtest') return new Response(new ReadableStream({start(c){for(let i=0;i<10;i++)c.enqueue(SPEEDTEST_CHUNK);c.close();}}));
      return new Response(JSON.stringify({ok:true}));
    }

    // 3. 代理
    let dest = new URL(request.url);
    const t = new URL(TARGET);
    dest.protocol = t.protocol; dest.hostname = t.hostname; dest.port = t.port;
    
    const options = { method: request.method, headers: new Headers(request.headers), redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') options.body = request.body;
    options.headers.set('Host', dest.host);

    return fetch(dest.toString(), options);
  }
};

async function handleStatsRequest(env) {
  try {
    const batch = await env.DB.batch([
      env.DB.prepare("SELECT COALESCE(SUM(playing_count),0) as playing, COALESCE(SUM(playback_info_count),0) as playbackInfo FROM auto_emby_daily_stats")
    ]);
    return new Response(JSON.stringify({ ok: true, data: { total: batch[0].results[0] } }));
  } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message })); }
}
