/**
 * =================================================================================
 * Cloudflare Worker Emby 终极版 v11.0 (全功能大屏 + 身份证拦截 + 变量驱动)
 * =================================================================================
 */

const SPEEDTEST_CHUNK = new Uint8Array(1024 * 1024);
let CACHED_CONFIG = { allowedRegions: [], blacklist: [], expire: 0 };

// --- 🛑 拦截界面：显示访问者详细网络身份证 ---
function getBlockedHTML(ip, cf, reason = 'region') {
  const countryMap = { 'CN': '中国大陆', 'HK': '中国香港', 'TW': '中国台湾', 'SG': '新加坡', 'JP': '日本', 'US': '美国' };
  const countryName = countryMap[cf.country] || cf.country || '未知国家';
  const isp = cf.asOrganization || '未知运营商';
  const title = reason === 'banned' ? '账号异常封禁' : '触发访问限制';
  const icon = reason === 'banned' ? '🚫' : '🚧';

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><title>🛑 ${title}</title><style>:root { --bg: #0f172a; --card-bg: rgba(30, 41, 59, 0.85); --text: #f8fafc; --accent: #6366f1; --border: rgba(255,255,255,0.1); }body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 1rem; box-sizing: border-box; }.card { background: var(--card-bg); backdrop-filter: blur(16px); border: 1px solid var(--border); border-radius: 28px; padding: 2.5rem 2rem; width: 100%; max-width: 420px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }.icon { font-size: 4.5rem; margin-bottom: 1.2rem; display: block; }h2 { font-size: 1.6rem; margin: 0 0 0.8rem; color: #ef4444; }p { color: #94a3b8; line-height: 1.6; margin-bottom: 2rem; }.info-list { background: rgba(0,0,0,0.25); border-radius: 20px; padding: 1.2rem; text-align: left; }.info-item { display: flex; justify-content: space-between; padding: 0.7rem 0; font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.05); }.info-item:last-child { border-bottom: none; }.label { color: #64748b; }.val { font-family: monospace; color: var(--accent); font-weight: 600; }</style></head><body><div class="card"><span class="icon">${icon}</span><h2>${title}</h2><p>当前所在地区暂未开放访问，请联系站长开通。</p><div class="info-list"><div class="info-item"><span class="label">访问 IP</span><span class="val">${ip}</span></div><div class="info-item"><span class="label">物理位置</span><span class="val">${countryName} ${cf.city || ''}</span></div><div class="info-item"><span class="label">运营商</span><span class="val">${isp}</span></div><div class="info-item"><span class="label">CF 节点</span><span class="val">${cf.colo || 'N/A'}</span></div></div></div></body></html>`;
}

// --- 📊 全功能数据大屏前端 ---
const FRONTEND_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Emby 运维审计大屏</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { background-color: #0b0e14; color: #e2e8f0; font-family: 'Inter', system-ui, sans-serif; }
        .glass { background: rgba(23, 28, 36, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.05); }
        .stat-card { transition: transform 0.3s ease; }
        .stat-card:hover { transform: translateY(-5px); }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: #2d3748; border-radius: 10px; }
    </style>
</head>
<body class="p-4 md:p-8">
    <div class="max-w-7xl mx-auto">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
            <div>
                <h1 class="text-3xl font-black bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">EMBY DASHBOARD</h1>
                <p class="text-gray-500 text-sm mt-1">实时流量审计与接入安全控制系统</p>
            </div>
            <div class="flex gap-3">
                <button onclick="toggleRegionConfig()" class="glass px-4 py-2 rounded-xl text-sm border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 transition">地区策略</button>
                <button onclick="location.reload()" class="glass px-4 py-2 rounded-xl text-sm border-gray-700 hover:bg-white/5 transition">刷新数据</button>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="glass p-6 rounded-3xl stat-card">
                <div class="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">活跃播放</div>
                <div id="playingNow" class="text-4xl font-black text-indigo-400">0</div>
            </div>
            <div class="glass p-6 rounded-3xl stat-card">
                <div class="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">全天请求</div>
                <div id="totalRequests" class="text-4xl font-black text-cyan-400">0</div>
            </div>
            <div class="glass p-6 rounded-3xl stat-card">
                <div class="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">平均延迟</div>
                <div id="avgPing" class="text-4xl font-black text-emerald-400">-- <span class="text-sm">ms</span></div>
            </div>
            <div class="glass p-6 rounded-3xl stat-card">
                <div class="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">拦截威胁</div>
                <div id="blockedCount" class="text-4xl font-black text-rose-500">0</div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
            <div class="lg:col-span-2 glass p-8 rounded-[2rem]">
                <h3 class="text-lg font-bold mb-6 flex items-center gap-2"><span class="w-2 h-2 bg-indigo-500 rounded-full"></span> 播放量趋势 (24h)</h3>
                <div class="h-[300px]"><canvas id="trendChart"></canvas></div>
            </div>
            <div class="glass p-8 rounded-[2rem]">
                <h3 class="text-lg font-bold mb-6 flex items-center gap-2"><span class="w-2 h-2 bg-pink-500 rounded-full"></span> 客户端分布</h3>
                <div class="h-[300px] flex items-center justify-center"><canvas id="clientChart"></canvas></div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div class="glass p-8 rounded-[2rem] overflow-hidden">
                <h3 class="text-lg font-bold mb-6">活跃用户审计</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-left">
                        <thead><tr class="text-gray-500 text-xs border-b border-white/5"><th class="pb-4">用户/IP</th><th class="pb-4">终端</th><th class="pb-4">累计时长</th><th class="pb-4">操作</th></tr></thead>
                        <tbody id="userTableBody" class="text-sm"></tbody>
                    </table>
                </div>
            </div>
            <div class="glass p-8 rounded-[2rem]">
                <h3 class="text-lg font-bold mb-6">节点性能监控 (Speedtest)</h3>
                <div id="speedLogList" class="space-y-4"></div>
            </div>
        </div>
    </div>

    <div id="regionModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm hidden flex items-center justify-center p-4 z-50">
        <div class="glass p-8 rounded-[2.5rem] max-w-md w-full border-white/10">
            <h3 class="text-2xl font-bold mb-4">区域访问控制</h3>
            <p class="text-gray-400 text-sm mb-6">勾选允许访问的地区，其余地区将显示拦截页面。</p>
            <div class="grid grid-cols-2 gap-4 mb-8" id="regionList">
                <label class="flex items-center gap-3 p-3 glass rounded-2xl cursor-pointer"><input type="checkbox" value="CN" class="w-5 h-5 rounded-lg accent-indigo-500"> 中国大陆</label>
                <label class="flex items-center gap-3 p-3 glass rounded-2xl cursor-pointer"><input type="checkbox" value="HK" class="w-5 h-5 rounded-lg accent-indigo-500"> 中国香港</label>
                <label class="flex items-center gap-3 p-3 glass rounded-2xl cursor-pointer"><input type="checkbox" value="TW" class="w-5 h-5 rounded-lg accent-indigo-500"> 中国台湾</label>
                <label class="flex items-center gap-3 p-3 glass rounded-2xl cursor-pointer"><input type="checkbox" value="SG" class="w-5 h-5 rounded-lg accent-indigo-500"> 新加坡</label>
            </div>
            <div class="flex gap-4">
                <button onclick="saveRegions()" class="flex-1 bg-indigo-600 hover:bg-indigo-500 py-3 rounded-2xl font-bold transition">应用更改</button>
                <button onclick="toggleRegionConfig()" class="px-6 py-3 glass rounded-2xl">取消</button>
            </div>
        </div>
    </div>

    <script>
        let apiKey = localStorage.getItem('emby_admin_key');
        let trendChart, clientChart;

        async function api(path, method = 'GET', body = null) {
            const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };
            const options = { method, headers };
            if (body) options.body = JSON.stringify(body);
            const res = await fetch(path, options);
            if (res.status === 401) {
                apiKey = prompt('🔐 请输入管理密码:');
                localStorage.setItem('emby_admin_key', apiKey);
                return api(path, method, body);
            }
            return res.json();
        }

        async function refresh() {
            const res = await api('/stats');
            if (!res.ok) return;
            const data = res.data;

            document.getElementById('playingNow').innerText = data.total.playing;
            document.getElementById('totalRequests').innerText = data.total.playbackInfo;
            
            // 渲染表格
            const tbody = document.getElementById('userTableBody');
            tbody.innerHTML = data.userStats.map(u => \`
                <tr class="border-b border-white/5">
                    <td class="py-4"><div class="font-bold">\${u.ip}</div><div class="text-xs text-gray-500">用户审计</div></td>
                    <td class="py-4 text-gray-400">\${u.client_name}</td>
                    <td class="py-4 font-mono">\${(u.duration_sec/3600).toFixed(1)} h</td>
                    <td class="py-4"><button onclick="banIp('\${u.ip}')" class="text-rose-500 hover:underline">封禁</button></td>
                </tr>
            \`).join('');

            // 渲染测速
            const speedBox = document.getElementById('speedLogList');
            speedBox.innerHTML = data.speedLogs.map(s => \`
                <div class="flex justify-between items-center p-4 glass rounded-2xl">
                    <div><div class="text-sm font-bold">\${s.loc}</div><div class="text-xs text-gray-500">\${s.isp}</div></div>
                    <div class="text-right"><div class="text-emerald-400 font-bold">\${s.speed_mbps} Mbps</div><div class="text-xs text-gray-500">\${s.ping}ms</div></div>
                </div>
            \`).join('');

            renderCharts(data);
        }

        function renderCharts(data) {
            const ctx1 = document.getElementById('trendChart').getContext('2d');
            if(trendChart) trendChart.destroy();
            trendChart = new Chart(ctx1, {
                type: 'line',
                data: {
                    labels: data.dailyStats.map(s => s.date).reverse(),
                    datasets: [{
                        label: '播放请求',
                        data: data.dailyStats.map(s => s.playing_count).reverse(),
                        borderColor: '#818cf8',
                        backgroundColor: 'rgba(129, 140, 248, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' } } } }
            });

            const ctx2 = document.getElementById('clientChart').getContext('2d');
            if(clientChart) clientChart.destroy();
            clientChart = new Chart(ctx2, {
                type: 'doughnut',
                data: {
                    labels: data.clientStats.map(c => c.client_name),
                    datasets: [{
                        data: data.clientStats.map(c => c.total_count),
                        backgroundColor: ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f59e0b']
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } } }
            });
        }

        function toggleRegionConfig() { document.getElementById('regionModal').classList.toggle('hidden'); }
        async function saveRegions() {
            const selected = Array.from(document.querySelectorAll('#regionList input:checked')).map(i => i.value);
            await api('/api/config', 'POST', { allowedRegions: selected });
            alert('策略已应用！');
            toggleRegionConfig();
        }
        async function banIp(ip) {
            if(confirm('确定要永久封禁 IP: ' + ip + ' 吗？')) {
                await api('/api/ban', 'POST', { ip });
                alert('已拉黑');
                refresh();
            }
        }

        refresh();
        setInterval(refresh, 30000);
    </script>
</body>
</html>
`;

// --- 🧠 后端逻辑：数据库与代理核心 ---
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

    if (!TARGET) return new Response('⚠️ Worker 错误：请在后台配置 TARGET_EMBY_SERVER 变量', { status: 500 });

    // 1. 严格拦截网关
    const isControlPath = url.pathname === '/dash' || url.pathname.startsWith('/api') || url.pathname === '/stats' || url.pathname === '/speedtest' || url.pathname === '/auth/verify';
    if (!isControlPath) {
      if (config.blacklist.includes(clientIp)) {
        return new Response(getBlockedHTML(clientIp, cf, 'banned'), { status: 403, headers: {'Content-Type': 'text/html;charset=utf-8'}});
      }
      if (config.allowedRegions.length > 0 && cf.country && !config.allowedRegions.includes(cf.country)) {
        return new Response(getBlockedHTML(clientIp, cf, 'region'), { status: 403, headers: {'Content-Type': 'text/html;charset=utf-8'}});
      }
    }

    // 2. 路由处理
    if (url.pathname === '/dash') return new Response(FRONTEND_HTML, { headers: {'Content-Type': 'text/html;charset=utf-8'}});
    
    if (isControlPath) {
      if (request.headers.get('X-Api-Key') !== PWD) return new Response(JSON.stringify({ok:false, error:'Unauthorized'}), { status: 401 });
      if (url.pathname === '/stats') return handleStatsRequest(env);
      if (url.pathname === '/auth/verify') return new Response(JSON.stringify({ok:true}));
      if (url.pathname === '/speedtest') return new Response(new ReadableStream({start(c){for(let i=0;i<15;i++)c.enqueue(SPEEDTEST_CHUNK);c.close();}}));
      
      // 处理配置更新
      if (request.method === 'POST') {
        const body = await request.json();
        if (url.pathname === '/api/config') {
          const val = JSON.stringify(body.allowedRegions);
          await env.DB.prepare("INSERT INTO auto_emby_config (key, value) VALUES ('allowed_regions', ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(val, val).run();
          CACHED_CONFIG.expire = 0;
          return new Response(JSON.stringify({ok:true}));
        }
        if (url.pathname === '/api/ban') {
          await env.DB.prepare("INSERT INTO auto_emby_blacklist (ip, created_at) VALUES (?, ?)").bind(body.ip, new Date().toISOString()).run();
          CACHED_CONFIG.expire = 0;
          return new Response(JSON.stringify({ok:true}));
        }
      }
    }

    // 3. 全透明代理转发
    let dest = new URL(request.url);
    const t = new URL(TARGET);
    dest.protocol = t.protocol; dest.hostname = t.hostname; dest.port = t.port;
    
    const options = { method: request.method, headers: new Headers(request.headers), redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') options.body = request.body;
    options.headers.set('Host', dest.host);
    
    // 自动记录统计（不影响主流程）
    if (dest.pathname.includes('/Playing/Progress')) ctx.waitUntil(recordAudit(env, clientIp, "EmbyPlayer", 10));

    return fetch(dest.toString(), options);
  }
};

// --- 🗄️ 数据库操作函数集 ---
async function recordAudit(env, ip, client, sec) {
  if (!env.DB) return;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  await env.DB.prepare("INSERT INTO auto_emby_user_stats (date, ip, client_name, duration_sec) VALUES (?, ?, ?, ?) ON CONFLICT(date, ip, client_name) DO UPDATE SET duration_sec = duration_sec + ?").bind(today, ip, client, sec, sec).run();
}

async function handleStatsRequest(env) {
  try {
    const batch = await env.DB.batch([
      env.DB.prepare("SELECT date, playing_count FROM auto_emby_daily_stats ORDER BY date DESC LIMIT 14"),
      env.DB.prepare("SELECT ip, client_name, duration_sec FROM auto_emby_user_stats ORDER BY duration_sec DESC LIMIT 15"),
      env.DB.prepare("SELECT client_name, SUM(count) as total_count FROM auto_emby_client_stats GROUP BY client_name LIMIT 5"),
      env.DB.prepare("SELECT COALESCE(SUM(playing_count),0) as playing, COALESCE(SUM(playback_info_count),0) as playbackInfo FROM auto_emby_daily_stats"),
      env.DB.prepare("SELECT loc, isp, ping, speed_mbps FROM auto_emby_speed_log ORDER BY id DESC LIMIT 5")
    ]);
    return new Response(JSON.stringify({
      ok: true,
      data: {
        dailyStats: batch[0].results,
        userStats: batch[1].results,
        clientStats: batch[2].results,
        total: batch[3].results[0],
        speedLogs: batch[4].results
      }
    }));
  } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message })); }
}
