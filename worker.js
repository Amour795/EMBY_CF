/**
 * =================================================================================
 * Cloudflare Worker Emby 终极版 (一键封禁 + 修复 IPv6 移动端溢出)
 * =================================================================================
 */

const PANEL_PASSWORD = 'emby'; // 访问密码
const SPEEDTEST_CHUNK = new Uint8Array(1024 * 1024);

// =====================================
// 🧠 内存级全局配置缓存 (保护 D1 额度)
// =====================================
let CACHED_CONFIG = { allowedRegions: [], blacklist: [], expire: 0 };

async function syncConfig(env) {
  if (!env.DB) return { allowedRegions: [], blacklist: [] };
  const now = Date.now();
  if (CACHED_CONFIG.expire > now) return CACHED_CONFIG;
  
  try {
    const resRegions = await env.DB.prepare("SELECT value FROM auto_emby_config WHERE key = 'allowed_regions'").first();
    CACHED_CONFIG.allowedRegions = resRegions ? JSON.parse(resRegions.value) : [];
  } catch(e) { CACHED_CONFIG.allowedRegions = []; }

  try {
    const resBan = await env.DB.prepare("SELECT ip FROM auto_emby_blacklist").all();
    CACHED_CONFIG.blacklist = resBan.results ? resBan.results.map(r => r.ip) : [];
  } catch(e) { CACHED_CONFIG.blacklist = []; }

  CACHED_CONFIG.expire = now + 60000;
  return CACHED_CONFIG;
}

// =====================================
// 🛑 动态拦截页 HTML 模板
// =====================================
function getBlockedHTML(ip, countryCode, city, colo, reason = 'region') {
  const countryMap = { 'CN': '中国大陆', 'HK': '中国香港', 'TW': '中国台湾', 'SG': '新加坡', 'JP': '日本', 'KR': '韩国', 'US': '美国', 'GB': '英国' };
  const locName = (countryMap[countryCode] || countryCode) + (city ? ' ' + city : '');
  
  const title = reason === 'banned' ? '账号异常封禁' : '结界已触发';
  const desc = reason === 'banned' 
    ? '系统检测到您的 IP 存在异常行为（或由管理员手动操作），当前设备已被永久封禁。' 
    : '哎呀！站长开启了严格的区域访问控制策略，您当前所在的次元暂未开放访问权限哦~';
  const icon = reason === 'banned' ? '🚫' : '🚧';
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>🛑 访问受限</title>
  <style>
    :root { --bg-color: #f8fafc; --panel-bg: rgba(255, 255, 255, 0.9); --text-main: #0f172a; --border: rgba(226, 232, 240, 0.8); }
    @media (prefers-color-scheme: dark) { :root { --bg-color: #0f172a; --panel-bg: rgba(30, 41, 59, 0.85); --text-main: #f8fafc; --border: rgba(51, 65, 85, 0.8); } }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, sans-serif; background-color: var(--bg-color); color: var(--text-main); min-height: 100vh; display: flex; align-items: center; overflow-x: hidden; }
    .page { padding: 1rem; width: 100%; max-width: 420px; margin: 0 auto; }
    .panel { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 20px 40px -15px rgba(0,0,0,0.2); padding: 0.8rem; backdrop-filter: blur(10px); text-align: center; }
    .inner-content { padding: 1rem 0.5rem; }
    .icon { font-size: 4rem; margin-bottom: 0.5rem; line-height: 1; }
    h2 { margin: 0 0 1rem 0; color: #ef4444; font-size: 1.4rem; }
    p { color: #64748b; font-size: 0.9rem; margin-bottom: 1.5rem; line-height: 1.5; }
    .info-box { background: rgba(100, 116, 139, 0.05); border-radius: 12px; padding: 1rem; text-align: left; border: 1px solid var(--border); width: 100%; }
    .info-item { display: flex; justify-content: space-between; align-items: flex-start; font-size: 0.85rem; padding: 0.4rem 0; border-bottom: 1px dashed var(--border); gap: 1rem; }
    .info-item:last-child { border-bottom: none; padding-bottom: 0; }
    .info-label { color: #64748b; white-space: nowrap; flex-shrink: 0; }
    .info-val { font-weight: 700; color: #6366f1; font-family: monospace; word-break: break-all; text-align: right; }
  </style>
</head>
<body>
  <div class="page">
    <div class="panel">
      <div class="inner-content">
        <div class="icon">${icon}</div>
        <h2>${title}</h2>
        <p>${desc}</p>
        <div class="info-box">
          <div class="info-item"><span class="info-label">您的 IP:</span><span class="info-val">${ip}</span></div>
          <div class="info-item"><span class="info-label">物理位置:</span><span class="info-val">${locName}</span></div>
          <div class="info-item"><span class="info-label">拦截节点:</span><span class="info-val">${colo}</span></div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// =====================================
// 📊 数据大屏 HTML
// =====================================
const FRONTEND_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <title>Emby 运维大屏</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="apple-mobile-web-app-capable" content="yes">
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
    
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; table-layout: fixed; }
    th, td { padding: 0.5rem 0.2rem; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; word-wrap: break-word; }
    th { color: var(--text-soft); font-weight: 600; font-size: 0.75rem; }
    
    #auth-screen { position: fixed; inset: 0; z-index: 9999; background: var(--bg-color); display: flex; align-items: center; justify-content: center; padding: 1rem;}
    .input-field { width: 100%; padding: 0.8rem; border-radius: 10px; border: 2px solid var(--border); background: var(--modal-bg); color: var(--text-main); margin-bottom: 1rem; outline: none;}
    
    .modal { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .modal[hidden] { display: none !important; }
    .modal-overlay { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(8px); }
    .modal-content { position: relative; width: 100%; max-width: 400px; background: var(--modal-bg); border-radius: 16px; padding: 1rem; }
    
    .st-item { display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding: 0.4rem 0; font-size: 0.85rem;}
    .speed-number { font-size: 2.2rem; font-weight: 800; color: var(--primary); display: block; text-align: center; margin: 0.5rem 0; font-family: monospace; }
    .stat-val { font-size: 1.6rem; font-weight: 800; color: var(--primary); }
    .stat-label { font-size: 0.75rem; color: var(--text-soft); margin-top: 0.2rem;}

    .region-cb { display: none; }
    .region-label { padding: 0.5rem 1rem; border: 1px solid var(--border); border-radius: 10px; font-size: 0.85rem; cursor: pointer; color: var(--text-soft); background: var(--modal-bg); transition: all 0.2s;}
    .region-cb:checked + .region-label { background: var(--primary-light); color: var(--primary); border-color: var(--primary); font-weight: 700; box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.1); }
  </style>
</head>
<body>

  <div id="auth-screen">
    <div class="panel" style="width: 100%; max-width: 320px; text-align: center;">
      <h3 style="margin-top:0">🔑 身份验证</h3>
      <input type="password" id="auth-input" class="input-field" placeholder="请输入密码">
      <button id="auth-btn" class="button button--primary" style="width: 100%;">进入控制台</button>
    </div>
  </div>

  <main class="page" id="main-content" style="display: none;">
    <div class="panel">
      <div class="hero__title">
        <span>🚀 Emby 数据大屏</span>
        <div style="display:flex; gap:0.5rem;">
          <button id="settings-btn" class="button button--secondary" style="padding:0.4rem; border-radius: 50%; width: 34px; height: 34px;">⚙️</button>
          <button id="theme-toggle" class="button button--secondary" style="padding:0.4rem; border-radius: 50%; width: 34px; height: 34px;">🌓</button>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-top: 0.8rem;">
        <button id="btn-open-speedtest" class="button button--primary">⚡️ 实时测速</button>
        <button id="stats-refresh" class="button button--secondary">🔄 刷新数据</button>
      </div>
    </div>

    <div id="db-warning" style="display:none; background: #fee2e2; color: #ef4444; padding: 0.8rem; border-radius: 12px; font-size: 0.85rem; margin-bottom: 0.8rem; border: 1px solid #fca5a5;">
      ⚠️ 数据库异常或缺失统计表，请确认已绑定 D1 数据库。
    </div>

    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.8rem; margin-bottom:0.8rem">
      <div class="panel" style="text-align:center; margin-bottom:0"><div class="stat-val" id="total-playing">0</div><div class="stat-label">总播放量</div></div>
      <div class="panel" style="text-align:center; margin-bottom:0"><div class="stat-val" id="total-playback-info">0</div><div class="stat-label">获取链接</div></div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.8rem;">
      <div class="panel"><div style="font-weight:700; font-size:0.9rem">📈 观影趋势</div><div class="chart-container"><canvas id="trendChart"></canvas></div></div>
      <div class="panel"><div style="font-weight:700; font-size:0.9rem">📱 客户端分布</div><div class="chart-container"><canvas id="deviceChart"></canvas></div></div>
    </div>

    <div class="panel">
      <div style="font-weight:700; font-size:0.9rem; margin-bottom:0.5rem">👥 活跃审计 (近10日)</div>
      <div style="overflow-x: hidden;">
        <table>
          <thead>
            <tr>
              <th style="width: 35%;">IP地址</th>
              <th style="width: 30%;">客户端</th>
              <th style="width: 15%;">时长</th>
              <th style="width: 20%; text-align:right">操作</th>
            </tr>
          </thead>
          <tbody id="user-stats-body"></tbody>
        </table>
      </div>
    </div>
  </main>

  <div id="settings-modal" class="modal" hidden>
    <div class="modal-overlay" onclick="document.getElementById('settings-modal').hidden=true"></div>
    <div class="modal-content">
      <h3 style="margin:0 0 1rem 0">⚙️ 访问控制设置</h3>
      <div style="font-size: 0.9rem; font-weight: 700; margin-bottom: 0.4rem;">🌍 允许访问的地区 (多选)</div>
      <div style="font-size: 0.75rem; color: var(--text-soft); margin-bottom: 1.2rem;">不勾选任何地区即为“不限制”，允许全球访问。</div>
      <div id="region-checkboxes" style="display: flex; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 1.5rem;"></div>
      <button id="save-settings-btn" class="button button--primary" style="width: 100%;">保存并生效</button>
      <button onclick="document.getElementById('settings-modal').hidden=true" class="button button--secondary" style="width: 100%; margin-top: 0.5rem;">取消</button>
    </div>
  </div>

  <div id="speedtest-modal" class="modal" hidden>
    <div class="modal-overlay" onclick="document.getElementById('speedtest-modal').hidden=true"></div>
    <div class="modal-content">
      <h3 style="margin:0 0 0.8rem 0">🛰️ 边缘网络诊断</h3>
      <div id="st-results">
        <div class="st-item"><span>地理位置:</span><span id="st-loc" style="color:var(--primary); font-weight:700">正在定位...</span></div>
        <div class="st-item"><span>运营商:</span><span id="st-isp" style="font-weight:700">--</span></div>
        <div class="st-item"><span>延迟 (Ping):</span><span id="st-ping">--</span></div>
      </div>
      <div class="speed-number"><span id="live-speed">0.00</span><small style="font-size:1rem; margin-left:4px">Mbps</small></div>
      <button id="st-start-btn" class="button button--primary" style="width: 100%; margin-top: 0.5rem; padding:0.8rem">开始测试</button>
      <button onclick="document.getElementById('speedtest-modal').hidden=true" class="button button--secondary" style="width: 100%; margin-top: 0.5rem;">关闭</button>
    </div>
  </div>

  <script>
    if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(()=>{}); }); }

    let trendChart, deviceChart;
    const setDark = (d) => { document.documentElement.classList.toggle('dark', d); localStorage.setItem('theme', d ? 'dark' : 'light'); };
    setDark(localStorage.getItem('theme') === 'dark');
    document.getElementById('theme-toggle').onclick = () => setDark(!document.documentElement.classList.contains('dark'));

    let API_TOKEN = localStorage.getItem('emby-token') || '';
    const checkAuth = async (token) => {
      if(!token) return;
      try {
        const res = await fetch('/auth/verify', { headers: {'X-Api-Key': token} });
        if (res.ok) {
          API_TOKEN = token; localStorage.setItem('emby-token', token);
          document.getElementById('auth-screen').style.display = 'none';
          document.getElementById('main-content').style.display = 'block';
          loadData();
        } else { alert('面板密码不正确'); }
      } catch(e) { console.error("Auth Error", e); }
    };
    document.getElementById('auth-btn').onclick = () => checkAuth(document.getElementById('auth-input').value);
    if(API_TOKEN) checkAuth(API_TOKEN);

    const REGIONS = [{code: 'CN', name: '中国大陆'}, {code: 'HK', name: '香港'}, {code: 'TW', name: '台湾'}, {code: 'SG', name: '新加坡'}, {code: 'JP', name: '日本'}, {code: 'KR', name: '韩国'}, {code: 'US', name: '美国'}];
    document.getElementById('region-checkboxes').innerHTML = REGIONS.map(r => '<label><input type="checkbox" class="region-cb" value="'+r.code+'"><div class="region-label">'+r.name+'</div></label>').join('');

    document.getElementById('settings-btn').onclick = async () => {
      document.getElementById('settings-modal').hidden = false;
      try {
        const res = await (await fetch('/api/config', { headers: {'X-Api-Key': API_TOKEN} })).json();
        const allowed = res.data?.allowedRegions || [];
        document.querySelectorAll('.region-cb').forEach(cb => { cb.checked = allowed.includes(cb.value); });
      } catch(e) {}
    };

    document.getElementById('save-settings-btn').onclick = async () => {
      const btn = document.getElementById('save-settings-btn');
      btn.disabled = true; btn.textContent = '保存中...';
      const selected = Array.from(document.querySelectorAll('.region-cb:checked')).map(cb => cb.value);
      try {
        const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_TOKEN }, body: JSON.stringify({ allowedRegions: selected }) });
        if (res.ok) { alert('✅ 地区限制策略已生效！'); document.getElementById('settings-modal').hidden = true; } 
        else { alert('保存失败，请检查 D1 数据库。'); }
      } catch(e) { alert('保存中断'); }
      btn.disabled = false; btn.textContent = '保存并生效';
    };

    window.banIP = async (ip) => {
      if(!confirm('⚠️ 确定要永久封禁 IP: ' + ip + ' 吗？\\n封禁后该用户将无法访问源站。')) return;
      try {
        const res = await fetch('/api/ban', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_TOKEN }, body: JSON.stringify({ ip }) });
        if(res.ok) { alert('✅ 封禁成功！'); loadData(); } 
        else { alert('封禁失败，可能缺少数据库表'); }
      } catch(e) { alert('请求出错'); }
    };

    // 🧠 核心修复：IPv6 和 IPv4 智能截断掩码，防止移动端表格爆炸
    const formatMaskedIP = (ip) => {
      if (!ip) return '未知';
      if (ip.includes(':')) {
        const parts = ip.split(':');
        return parts.length > 2 ? parts[0] + ':..:' + parts[parts.length - 1] : ip;
      }
      return ip.split('.').slice(0, 2).join('.') + '.*';
    };

    async function loadData() {
      try {
        const res = await fetch('/stats', { headers: {'X-Api-Key': API_TOKEN} });
        const payload = await res.json();
        if (!payload.ok) { document.getElementById('db-warning').style.display = 'block'; document.getElementById('db-warning').innerText = '⚠️ 数据库连接异常: ' + (payload.error || '未知错误'); } 
        else { document.getElementById('db-warning').style.display = 'none'; }

        const d = payload.data || { dailyStats: [], userStats: [], clientStats: [], total: {playing: 0, playbackInfo: 0} };
        if (d.total) {
          document.getElementById('total-playing').textContent = d.total.playing || 0;
          document.getElementById('total-playback-info').textContent = d.total.playbackInfo || 0;
        }
        
        document.getElementById('user-stats-body').innerHTML = d.userStats.map(u => 
          '<tr>' +
          '<td style="font-family:monospace; font-size:0.75rem; color:var(--primary);">' + formatMaskedIP(u.ip) + '</td>' +
          '<td style="font-size:0.8rem; word-break:break-all;">' + u.client_name + '</td>' +
          '<td style="font-size:0.8rem;">' + Math.round(u.duration_sec/60) + '分</td>' + 
          '<td style="text-align:right"><button class="button" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; border: 1px solid #fca5a5; color: #ef4444; background: transparent; white-space: nowrap;" onclick="banIP(\\''+u.ip+'\\')">封禁</button></td>' +
          '</tr>'
        ).join('');
        
        if(d.userStats.length === 0) document.getElementById('user-stats-body').innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">暂无数据记录</td></tr>';
        
        const commonOpt = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
        if(trendChart) trendChart.destroy();
        trendChart = new Chart(document.getElementById('trendChart'), { type: 'line', data: { labels: d.dailyStats.map(s => s.date.slice(5)).reverse(), datasets: [{ data: d.dailyStats.map(s => s.playing_count).reverse(), borderColor: '#6366f1', fill: true, tension: 0.4 }] }, options: commonOpt });
        if(deviceChart) deviceChart.destroy();
        deviceChart = new Chart(document.getElementById('deviceChart'), { type: 'doughnut', data: { labels: d.clientStats.map(c => c.client_name), datasets: [{ data: d.clientStats.map(c => c.total_count), backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#a855f7', '#0ea5e9'] }] }, options: { ...commonOpt, plugins: { legend: { display: true, position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } } });
      } catch (e) { console.error("渲染失败", e); }
    }
    document.getElementById('stats-refresh').onclick = loadData;

    const ispMap = { 'China Mobile': '中国移动', 'China Unicom': '中国联通', 'China Telecom': '中国电信', 'CMCC': '中国移动', 'UNICOM': '中国联通', 'CHINANET': '中国电信' };
    document.getElementById('btn-open-speedtest').onclick = () => document.getElementById('speedtest-modal').hidden = false;
    
    document.getElementById('st-start-btn').onclick = async () => {
      const btn = document.getElementById('st-start-btn');
      const speedEl = document.getElementById('live-speed');
      btn.disabled = true; btn.textContent = '卫星定位中...'; speedEl.textContent = '0.00';
      
      try {
        fetch('https://ipapi.co/json/').then(r => r.json()).then(geo => {
          document.getElementById('st-loc').textContent = geo.region + ' ' + geo.city;
          let rawIsp = geo.org || ''; let finalIsp = '未知网络';
          for (let key in ispMap) { if(rawIsp.toUpperCase().includes(key.toUpperCase())) { finalIsp = ispMap[key]; break; } }
          document.getElementById('st-isp').textContent = finalIsp;
        }).catch(() => { document.getElementById('st-loc').textContent = '定位限流使用默认'; });

        const pStart = performance.now();
        await fetch('/trace', { method: 'HEAD', headers: {'X-Api-Key': API_TOKEN}, cache: 'no-store' });
        document.getElementById('st-ping').textContent = Math.round(performance.now() - pStart) + ' ms';

        btn.textContent = '全速下行测速中...';
        const response = await fetch('/speedtest', { headers: {'X-Api-Key': API_TOKEN} });
        const reader = response.body.getReader();
        let receivedLength = 0, startTime = performance.now();

        while(true) {
          const {done, value} = await reader.read();
          if (done) break;
          receivedLength += value.length;
          const duration = (performance.now() - startTime) / 1000;
          if (duration > 0.1) speedEl.textContent = ((receivedLength * 8) / (1024 * 1024) / duration).toFixed(2);
        }
        btn.textContent = '重新测试';
      } catch(e) { alert('测速连接中断'); }
      btn.disabled = false;
    };
  </script>
</body>
</html>
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/icon.png') {
      const icon = await fetch('https://raw.githubusercontent.com/google/material-design-icons/master/png/device/wallpaper/materialicons/48dp/1x/baseline_wallpaper_black_48dp.png');
      return new Response(icon.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' } });
    }
    if (url.pathname === '/manifest.json') {
      return new Response(JSON.stringify({ name: "Emby 大屏", short_name: "EmbyDash", start_url: "/", display: "standalone", background_color: "#f8fafc", theme_color: "#6366f1", icons: [{ src: "/icon.png", sizes: "48x48", type: "image/png" }] }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/sw.js') return new Response("self.addEventListener('fetch',()=>{})", { headers: { 'Content-Type': 'application/javascript' } });

    // =====================================
    // 🛑 黑名单与地区拦截中间件
    // =====================================
    const config = await syncConfig(env);
    const clientIp = request.headers.get('cf-connecting-ip') || '未知 IP';
    const countryCode = request.cf?.country || 'XX';
    const city = request.cf?.city || '';
    const colo = request.cf?.colo || 'N/A';

    if (config.blacklist.includes(clientIp)) {
      return new Response(getBlockedHTML(clientIp, countryCode, city, colo, 'banned'), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' }});
    }

    if (config.allowedRegions.length > 0 && countryCode !== 'XX' && !config.allowedRegions.includes(countryCode)) {
      return new Response(getBlockedHTML(clientIp, countryCode, city, colo, 'region'), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' }});
    }

    const authKey = request.headers.get('X-Api-Key');
    const isApi = ['/stats', '/trace', '/speedtest', '/auth/verify', '/api/config', '/api/ban'].includes(url.pathname);
    if (isApi) {
      if (authKey !== PANEL_PASSWORD) return new Response(JSON.stringify({ok:false, error:'Unauthorized'}), { status: 401 });
      if (url.pathname === '/auth/verify') return new Response(JSON.stringify({ok:true}), { status: 200 });
    }

    if (url.pathname === '/') return new Response(FRONTEND_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/stats') return handleStatsRequest(env);
    if (url.pathname === '/trace') return new Response(JSON.stringify({ ip: clientIp, colo: colo }), { headers: { 'Cache-Control': 'no-store' } });
    if (url.pathname === '/speedtest') return new Response(new ReadableStream({ start(c) { for(let i=0; i<15; i++) c.enqueue(SPEEDTEST_CHUNK); c.close(); } }), { headers: { 'Content-Type': 'application/octet-stream' } });
    
    if (url.pathname === '/api/config') {
      if (request.method === 'GET') return new Response(JSON.stringify({ok: true, data: { allowedRegions: config.allowedRegions }}));
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          if (!env.DB) throw new Error("未绑定数据库");
          await env.DB.prepare("CREATE TABLE IF NOT EXISTS auto_emby_config (key TEXT PRIMARY KEY, value TEXT)").run();
          const regionsJSON = JSON.stringify(body.allowedRegions || []);
          await env.DB.prepare("INSERT INTO auto_emby_config (key, value) VALUES ('allowed_regions', ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(regionsJSON, regionsJSON).run();
          CACHED_CONFIG.allowedRegions = body.allowedRegions; CACHED_CONFIG.expire = 0; 
          return new Response(JSON.stringify({ok: true}));
        } catch(e) { return new Response(JSON.stringify({ok: false, error: e.message}), {status: 500}); }
      }
    }

    if (url.pathname === '/api/ban' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!env.DB) throw new Error("未绑定数据库");
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS auto_emby_blacklist (ip TEXT PRIMARY KEY, created_at TEXT)").run();
        await env.DB.prepare("INSERT INTO auto_emby_blacklist (ip, created_at) VALUES (?, ?) ON CONFLICT(ip) DO NOTHING").bind(body.ip, new Date().toISOString()).run();
        CACHED_CONFIG.blacklist.push(body.ip); CACHED_CONFIG.expire = 0; 
        return new Response(JSON.stringify({ok: true}));
      } catch(e) { return new Response(JSON.stringify({ok: false, error: e.message}), {status: 500}); }
    }

    let upstream;
    try {
      let p = url.pathname.slice(1).replace(/^(https?)\/(?!\/)/, '$1://');
      if (!/^https?:\/\//i.test(p)) p = 'https://' + p;
      upstream = new URL(p); upstream.search = url.search;
    } catch { return new Response('Invalid Request', { status: 400 }); }

    const embyClient = request.headers.get('X-Emby-Client') || '';
    const userAgent = request.headers.get('User-Agent') || '';
    let clientName = embyClient || '网页浏览器';

    if (userAgent.includes('VidHub') || embyClient.includes('VidHub')) clientName = 'VidHub';
    else if (userAgent.includes('Popcorn') || embyClient.includes('Popcorn') || userAgent.includes('爆米花')) clientName = '网易爆米花';
    else if (userAgent.includes('Infuse') || embyClient.includes('Infuse')) clientName = 'Infuse';
    else if (userAgent.includes('Fileball')) clientName = 'Fileball';
    else if (userAgent.includes('Firefox')) clientName = 'Firefox 浏览器';
    else if (userAgent.includes('Chrome')) clientName = 'Chrome 浏览器';
    else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) clientName = 'Safari 浏览器';

    if (upstream.pathname.includes('/Playing/Progress')) ctx.waitUntil(recordUserAudit(env, clientIp, clientName, 10));
    if (upstream.pathname.endsWith('/Sessions/Playing') || upstream.pathname.includes('/PlaybackInfo')) ctx.waitUntil(recordBasicStats(env, upstream.pathname.endsWith('/Sessions/Playing') ? 'playing' : 'playback', clientName));

    const options = { method: request.method, headers: new Headers(request.headers) };
    options.headers.set('Host', upstream.host);
    if (/\.(jpeg|jpg|png|gif|css|js|woff2|woff|ttf)$/i.test(upstream.pathname)) options.cf = { cacheTtl: 7200, cacheEverything: true };

    return fetch(upstream.toString(), options);
  }
};

async function recordBasicStats(env, type, client) {
  if (!env.DB) return;
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const col = type === 'playing' ? 'playing_count' : 'playback_info_count';
    const sql = "INSERT INTO auto_emby_daily_stats (date, " + col + ") VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET " + col + " = " + col + " + 1";
    await env.DB.prepare(sql).bind(today).run();
    await env.DB.prepare("INSERT INTO auto_emby_client_stats (date, client_name, count) VALUES (?, ?, 1) ON CONFLICT(date, client_name) DO UPDATE SET count = count + 1").bind(today, client).run();
  } catch (e) {}
}

async function recordUserAudit(env, ip, client, sec) {
  if (!env.DB) return;
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    await env.DB.prepare("INSERT INTO auto_emby_user_stats (date, ip, client_name, duration_sec) VALUES (?, ?, ?, ?) ON CONFLICT(date, ip, client_name) DO UPDATE SET duration_sec = duration_sec + ?").bind(today, ip, client, sec, sec).run();
  } catch (e) {}
}

async function handleStatsRequest(env) {
  if (!env.DB) return new Response(JSON.stringify({ok: false, enabled: false, error: "未绑定D1数据库"}));
  try {
    const batch = await env.DB.batch([
      env.DB.prepare("SELECT date, playing_count FROM auto_emby_daily_stats ORDER BY date DESC LIMIT 10"),
      env.DB.prepare("SELECT ip, client_name, SUM(duration_sec) as duration_sec FROM auto_emby_user_stats GROUP BY ip, client_name ORDER BY duration_sec DESC LIMIT 10"),
      env.DB.prepare("SELECT client_name, SUM(count) as total_count FROM auto_emby_client_stats GROUP BY client_name ORDER BY total_count DESC LIMIT 5"),
      env.DB.prepare("SELECT COALESCE(SUM(playing_count),0) as playing, COALESCE(SUM(playback_info_count),0) as playbackInfo FROM auto_emby_daily_stats")
    ]);
    return new Response(JSON.stringify({ ok: true, enabled: true, data: { dailyStats: batch[0].results, userStats: batch[1].results, clientStats: batch[2].results, total: batch[3].results[0] } }));
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, enabled: true, error: e.message, data: { dailyStats: [], userStats: [], clientStats: [], total: {playing: 0, playbackInfo: 0} } }));
  }
}
