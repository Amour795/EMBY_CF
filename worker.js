/**
 * =================================================================================
 * Cloudflare Worker 通用 Emby 反向代理脚本 (带 D1 统计 + VisionOS 视觉版)
 * =================================================================================
 *
 * 版本: 6.1 (满血复活修复版)
 * 紧急修复:
 * 1. 修复了 path.includes 导致的误杀拦截，恢复严格的路径格式校验，确保 PlaybackInfo 正常放行！
 * 2. 新增全局 OPTIONS 跨域预检请求放行，彻底根除所有第三方客户端的 CORS 跨域播放报错。
 * 3. 增强环境变量容错，防止 JSON 解析失败导致探针整体崩溃。
 */

// ==========================================
// 🔒 静态基础配置区 (非敏感配置)
// ==========================================

const BLOCKED_PANEL_DOMAINS = ['emby.amour795.club']; 
const ipWafMap = new Map(); 
const JP_COLOS = ['NRT', 'KIX', 'FUK', 'OKA']; 
const DOMAIN_PROXY_RULES = { 'biliblili.uk': 'example.com' };
const MANUAL_REDIRECT_DOMAINS = [
  'emby.bangumi.ca', 'aliyundrive.com', 'aliyundrive.net', 'aliyuncs.com', 'alicdn.com', 'aliyun.com', 
  'cdn.aliyundrive.com', 'xunlei.com', 'xlusercdn.com', 'xycdn.com', 'sandai.net', 'thundercdn.com',
  '115.com', '115cdn.com', '115cdn.net', 'anxia.com', '189.cn', 'mini189.cn', 'ctyunxs.cn', 
  'cloud.189.cn', 'tianyiyun.com', 'telecomjs.com', 'quark.cn', 'quarkdrive.cn', 'uc.cn', 
  'ucdrive.cn', 'xiaoya.pro', 'myqcloud.com', 'cloudfront.net', 'akamaized.net', 'fastly.net', 'hwcdn.net'
];

// ==========================================
// 🎨 前端 UI 模板定义区
// ==========================================

const BLOCKED_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <title>纯净代理节点</title>
  <style>
    :root { --bg-color: #000; --text-main: #fff; --danger: #ff453a; }
    body { margin: 0; padding: 20px; background-color: var(--bg-color); color: var(--text-main); font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; text-align: center; }
    .card { background: rgba(30, 30, 32, 0.6); backdrop-filter: blur(40px); border: 1px solid rgba(255,255,255,0.1); border-radius: 32px; padding: 40px; box-shadow: inset 0 1px 1px rgba(255,255,255,0.1), 0 20px 40px rgba(0,0,0,0.5); max-width: 400px; width: 100%; }
    .hacker-box { background: rgba(255, 69, 58, 0.1); border: 1px dashed rgba(255, 69, 58, 0.4); padding: 20px; border-radius: 20px; margin: 20px 0; text-align: left; font-family: monospace; font-size: 0.9rem; line-height: 1.8; color: #ff9f9c; }
  </style>
</head>
<body>
  <div class="card">
    <h2 style="color:var(--danger); margin-top:0;">🛑 纯净转发节点</h2>
    <p style="opacity:0.8; font-size:0.95rem;">此域名已关闭控制台访问。<br>已记录您的握手信息：</p>
    <div class="hacker-box">
      <div>🎯 IP: {{CLIENT_IP}}</div>
      <div>🌍 Loc: {{GEO_LOC}}</div>
      <div style="word-break:break-all;">📱 UA: {{USER_AGENT}}</div>
    </div>
    <div style="font-weight: bold; font-size: 1.1rem; margin-top: 20px;">莫来沾边，回去追剧吧 🍿</div>
  </div>
</body>
</html>
`;

const WALLPAPER_ENGINE_HTML = `
  <div id="dynamic-bg" class="dynamic-bg"></div>
  <div id="bg-overlay" class="bg-overlay"></div>
  <style>
    .dynamic-bg { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-size: cover; background-position: center; z-index: -3; opacity: 0; transition: opacity 1.5s ease-in-out; transform: scale(1.02); }
    .dynamic-bg.loaded { opacity: 1; transform: scale(1); transition: opacity 1.5s, transform 15s ease-out; }
    .bg-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: -2; transition: background 0.5s ease; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
    :root { --overlay-color: rgba(242, 242, 247, 0.65); }
    [data-theme="dark"] { --overlay-color: rgba(0, 0, 0, 0.75); }
    .bg-overlay { background: var(--overlay-color); }
  </style>
  <script>
    const WALLPAPERS = [ "https://image.tmdb.org/t/p/original/lzWHmYdfeFiMIY4JaMmtR7GEli3.jpg", "https://image.tmdb.org/t/p/original/pbrkL804c8yAv3zBZR4QPEafpAR.jpg", "https://image.tmdb.org/t/p/original/8rpDcsfLJypbO6vtec8Oed40oF8.jpg" ];
    document.addEventListener("DOMContentLoaded", () => {
      const bgEl = document.getElementById('dynamic-bg'); const randomUrl = WALLPAPERS[Math.floor(Math.random() * WALLPAPERS.length)];
      const img = new Image(); img.src = randomUrl; img.onload = () => { bgEl.style.backgroundImage = \`url('\${randomUrl}')\`; bgEl.classList.add('loaded'); };
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme); else if (systemDark) document.documentElement.setAttribute('data-theme', 'dark');
    });
  </script>
`;

const LOGIN_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <title>安全验证 | Emby 控制台</title>
  <style>
    :root { --primary: #007aff; --accent: #34c759; --text-main: #1c1c1e; --danger: #ff3b30; --card-bg: rgba(255,255,255,0.6); --card-border: rgba(255,255,255,0.5); --inner-glow: inset 0 1px 1px rgba(255,255,255,0.8); --shadow: 0 20px 40px rgba(0,0,0,0.1); }
    [data-theme="dark"] { --primary: #0a84ff; --accent: #30d158; --text-main: #fff; --danger: #ff453a; --card-bg: rgba(30,30,32,0.5); --card-border: rgba(255,255,255,0.1); --inner-glow: inset 0 1px 1px rgba(255,255,255,0.15); --shadow: 0 30px 60px rgba(0,0,0,0.6); }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
    body { margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 100vh; overflow: hidden; color: var(--text-main); }
    .glass-card { background: var(--card-bg); backdrop-filter: blur(40px) saturate(200%); -webkit-backdrop-filter: blur(40px) saturate(200%); border: 1px solid var(--card-border); border-radius: 36px; padding: 48px 32px; box-shadow: var(--shadow), var(--inner-glow); width: 100%; max-width: 400px; text-align: center; }
    .auth-input { width: 100%; padding: 18px; border-radius: 20px; border: 1px solid var(--card-border); background: rgba(128, 128, 128, 0.1); color: var(--text-main); font-size: 1.5rem; text-align: center; margin-bottom: 24px; outline: none; letter-spacing: 6px; font-weight: bold; box-shadow: inset 0 2px 4px rgba(0,0,0,0.05); transition: all 0.3s; }
    .auth-input:focus { border-color: var(--primary); background: rgba(128, 128, 128, 0.2); box-shadow: 0 0 0 4px rgba(0,122,255,0.15); }
    .btn { width: 100%; background: var(--primary); color: white; border: none; padding: 18px; border-radius: 20px; font-size: 1.1rem; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 8px 20px rgba(0,122,255,0.3), inset 0 1px 1px rgba(255,255,255,0.3); }
    .btn:hover { transform: scale(1.02) translateY(-2px); } .btn:active { transform: scale(0.98); }
    .error-msg { color: var(--danger); font-size: 0.9rem; margin-top: 16px; opacity: 0; transition: opacity 0.3s; }
  </style>
</head>
<body>
  \${WALLPAPER_ENGINE_HTML}
  <div class="glass-card" id="login-card">
    <h1 style="margin:0 0 8px; font-size: 2rem;">VisionOS</h1>
    <div style="opacity:0.6; margin-bottom:32px;">Emby 极客控制中心</div>
    <input type="password" id="auth-code" class="auth-input" placeholder="••••••" autocomplete="off" />
    <button id="login-btn" class="btn" onclick="verifyCode()">解锁终端</button>
    <div id="error-msg" class="error-msg">安全密钥错误，请重试</div>
  </div>
  <script>
    const codeInput = document.getElementById('auth-code'); const btn = document.getElementById('login-btn'); const errorMsg = document.getElementById('error-msg');
    codeInput.focus(); codeInput.addEventListener('keypress', e => { if (e.key === 'Enter') verifyCode(); });
    async function verifyCode() {
      const code = codeInput.value.trim(); if (!code) return;
      btn.disabled = true; btn.innerText = '验证中...'; errorMsg.style.opacity = '0';
      try {
        const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        if (res.ok) { btn.innerText = '授权成功'; btn.style.background = 'var(--accent)'; setTimeout(() => window.location.reload(), 500); } 
        else { throw new Error('Invalid'); }
      } catch (e) { btn.disabled = false; btn.innerText = '解锁终端'; errorMsg.style.opacity = '1'; codeInput.value = ''; }
    }
  </script>
</body>
</html>
`;

const FRONTEND_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <title>Emby 控制台 | VisionOS</title>
  <style>
    :root {
      --primary: #0a84ff; --accent: #30d158; --danger: #ff453a;
      --text-main: #1c1c1e; --text-muted: #8e8e93; 
      --card-bg: rgba(255, 255, 255, 0.6); --card-border: rgba(255, 255, 255, 0.5);
      --inner-glow: inset 0 1px 1px rgba(255, 255, 255, 0.8);
      --shadow: 0 16px 40px rgba(0, 0, 0, 0.08);
      --skeleton-base: rgba(0,0,0,0.05); --skeleton-shine: rgba(0,0,0,0.02);
    }
    [data-theme="dark"] {
      --text-main: #ffffff; --text-muted: #ebebf5;
      --card-bg: rgba(30, 30, 32, 0.5); --card-border: rgba(255, 255, 255, 0.1);
      --inner-glow: inset 0 1px 1px rgba(255, 255, 255, 0.15);
      --shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
      --skeleton-base: rgba(255,255,255,0.05); --skeleton-shine: rgba(255,255,255,0.1);
    }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", sans-serif; }
    body { margin: 0; padding: max(20px, env(safe-area-inset-top)) 20px 40px; color: var(--text-main); display: flex; justify-content: center; }
    
    .bento-container { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: minmax(min-content, max-content); gap: 24px; max-width: 1100px; width: 100%; position: relative; z-index: 1; padding-bottom: 40px; }
    
    .bento-card { 
      background: var(--card-bg); backdrop-filter: blur(40px) saturate(200%); -webkit-backdrop-filter: blur(40px) saturate(200%); 
      border: 1px solid var(--card-border); border-radius: 36px; padding: 32px; 
      box-shadow: var(--shadow), var(--inner-glow); transition: transform 0.4s cubic-bezier(0.25, 1, 0.5, 1), box-shadow 0.4s ease; 
      display: flex; flex-direction: column;
    }
    .bento-card:hover { transform: translateY(-4px) scale(1.01); box-shadow: 0 30px 60px rgba(0,0,0,0.15), var(--inner-glow); }
    
    .bento-header { grid-column: 1 / -1; flex-direction: row; justify-content: space-between; align-items: center; padding: 24px 32px; }
    .bento-nodes { grid-column: span 2; grid-row: span 2; }
    .bento-speed { grid-column: span 1; align-items: center; text-align: center; }
    .bento-stats { grid-column: span 1; }
    .bento-table { grid-column: 1 / -1; }

    h2, h3 { margin: 0 0 16px 0; letter-spacing: -0.5px; display: flex; align-items: center; gap: 10px; }
    
    @keyframes skeleton-loading { 0% { background-color: var(--skeleton-base); } 50% { background-color: var(--skeleton-shine); } 100% { background-color: var(--skeleton-base); } }
    .skeleton { animation: skeleton-loading 1.5s infinite ease-in-out; border-radius: 16px; width: 100%; height: 60px; margin-bottom: 12px; }

    .health-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; background: rgba(128,128,128,0.15); border-radius: 20px; font-size: 0.85rem; font-weight: 600; border: 1px solid var(--card-border); }
    .health-badge.online { color: var(--accent); background: rgba(52,199,89,0.15); }
    .pulse { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { transform: scale(0.95); opacity: 0.5; } 50% { transform: scale(1.2); opacity: 1; } }

    .node-item { display: flex; justify-content: space-between; align-items: center; background: rgba(128, 128, 128, 0.08); border: 1px solid var(--card-border); padding: 16px 20px; border-radius: 20px; transition: all 0.2s; margin-bottom: 12px; }
    .node-item:hover { background: rgba(128, 128, 128, 0.15); transform: translateX(4px); }
    .node-name { font-size: 1.1rem; font-weight: 700; }
    .btn-copy { background: rgba(0,122,255,0.1); color: var(--primary); padding: 10px 18px; border-radius: 16px; font-weight: 600; font-size: 0.95rem; border: none; cursor: pointer; transition: all 0.2s; }
    .btn-copy:hover { background: rgba(0,122,255,0.2); transform: scale(1.05); }

    .dial-container { position: relative; width: 200px; height: 200px; margin: 10px auto 24px; display: flex; align-items: center; justify-content: center; }
    #speed-num { font-size: 3.5rem; line-height: 1; font-weight: 800; letter-spacing: -1.5px; text-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .btn-action { background: var(--primary); color: #fff; border: none; padding: 14px 30px; border-radius: 100px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: inset 0 1px 1px rgba(255,255,255,0.3), 0 8px 20px rgba(0,122,255,0.3); }
    .btn-action:hover { transform: translateY(-2px) scale(1.02); } .btn-action:active { transform: scale(0.98); }

    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .stat-box { background: rgba(128, 128, 128, 0.1); border: 1px solid var(--card-border); padding: 20px; border-radius: 24px; text-align: center; }
    .stat-value { font-size: 2rem; font-weight: 800; color: var(--accent); margin-top: 8px; text-shadow: 0 2px 10px rgba(0,0,0,0.1); }

    table { width: 100%; border-collapse: collapse; text-align: left; margin-top: 10px; }
    th, td { padding: 16px; border-bottom: 1px solid var(--card-border); font-size: 0.95rem; }
    th { color: var(--text-main); opacity: 0.7; font-size: 0.85rem; text-transform: uppercase; border-bottom: 2px solid var(--card-border); }
    tr:hover td { background: rgba(128, 128, 128, 0.1); }
    .ip-tag { color: var(--primary); font-family: monospace; font-weight: bold; background: rgba(128,128,128,0.15); padding: 4px 8px; border-radius: 8px; }
    .node-tag { color: var(--accent); background: rgba(52,199,89,0.1); border: 1px solid rgba(52,199,89,0.2); padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: bold; }
    .client-tag { display: inline-block; padding: 4px 10px; border-radius: 8px; font-size: 0.8rem; font-weight: 600; background: rgba(0, 122, 255, 0.1); color: var(--primary); border: 1px solid rgba(0,122,255,0.2); }

    @media (max-width: 900px) {
      .bento-container { grid-template-columns: 1fr; }
      .bento-header, .bento-nodes, .bento-speed, .bento-stats, .bento-table { grid-column: span 1; grid-row: auto; }
      .node-item { flex-direction: column; gap: 16px; align-items: stretch; text-align: center; }
      .stats-grid { grid-template-columns: 1fr; }
      thead { display: none; }
      tr { display: flex; flex-direction: column; background: rgba(128,128,128,0.05); margin-bottom: 16px; border-radius: 20px; padding: 16px; border: 1px solid var(--card-border); }
      td { display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(128,128,128,0.2); padding: 10px 0; align-items: center; }
      td:last-child { border-bottom: none; }
      td::before { content: attr(data-label); color: var(--text-muted); font-size: 0.85rem; font-weight: bold; margin-right: 15px; }
    }
  </style>
</head>
<body>
  \${WALLPAPER_ENGINE_HTML}
  
  <div class="bento-container">
    
    <div class="bento-card bento-header">
      <h1 style="margin:0; font-size:1.8rem; font-weight:800; letter-spacing:-1px;">Emby Base</h1>
      <div style="display:flex; gap:12px;">
        <button id="theme-toggle" class="btn-copy" style="padding: 8px 14px;" title="切换明暗主题">🌓</button>
      </div>
    </div>

    <div class="bento-card bento-nodes">
      <h2>📡 分发路由矩阵</h2>
      <p style="opacity: 0.7; font-size: 0.95rem; margin-top: 0; margin-bottom: 24px;">一键复制您的专属直连分发节点，自动规避源站拥堵与审查。</p>
      <div id="node-list">
        <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>
      </div>
    </div>

    <div class="bento-card bento-speed">
      <h3 style="justify-content:center;">⚡ 边缘链路测速</h3>
      <div class="dial-container">
        <svg style="position:absolute; width:100%; height:100%; transform:rotate(-90deg); filter: drop-shadow(0 2px 8px rgba(0,0,0,0.1));" viewBox="0 0 36 36">
          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--card-border)" stroke-width="2.5" stroke-linecap="round" />
          <path id="speed-progress" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--primary)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="0, 100" style="transition: stroke-dasharray 0.2s linear;" />
        </svg>
        <div class="speed-value">
          <div id="speed-num">0.00</div>
          <div style="font-size:0.9rem; opacity:0.6; font-weight:bold;">MBPS</div>
        </div>
      </div>
      <button id="btn-speed" class="btn-action" onclick="startSpeedTest()">执行链路压测</button>
    </div>

    <div class="bento-card bento-stats">
      <h3>📊 流量数据大盘</h3>
      <div id="stats-loading">
        <div class="skeleton" style="height:100px;"></div><div class="skeleton" style="height:100px;"></div>
      </div>
      <div id="stats-content" class="stats-grid" style="display:none;">
        <div class="stat-box">
          <div class="title">今日播放次数</div>
          <div class="stat-value odometer" id="t-play" data-val="0">0</div>
        </div>
        <div class="stat-box">
          <div class="title">总在线时长</div>
          <div class="stat-value odometer" id="t-time" data-val="0" style="color:var(--primary);">0<span style="font-size:1rem;">h</span></div>
        </div>
      </div>
    </div>

    <div class="bento-card bento-table">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; margin-bottom:20px;">
        <h3 style="margin:0;">🕵️ 访问追踪明细 <span style="font-size:0.8rem; font-weight:normal; opacity:0.6; background:rgba(128,128,128,0.2); padding:4px 10px; border-radius:12px; margin-left:10px;">近 3 天数据</span></h3>
      </div>
      <div style="overflow-x:auto;">
        <table id="ip-table">
          <thead><tr><th>追踪 IP 地址</th><th>地理归属</th><th>目标路由</th><th>最后活跃</th><th>客户端</th><th>驻留时长</th></tr></thead>
          <tbody>
             <tr><td colspan="6"><div class="skeleton"></div><div class="skeleton"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>
    
  </div>

  <script>
    function animateValue(obj, start, end, duration, isFloat = false) {
      let startTimestamp = null;
      const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 4); 
        const current = start + (end - start) * ease;
        obj.innerHTML = isFloat ? current.toFixed(1) + '<span style="font-size:1rem;">h</span>' : Math.floor(current);
        if (progress < 1) window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    }

    const themeToggle = document.getElementById('theme-toggle');
    themeToggle.addEventListener('click', () => { 
      const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme); localStorage.setItem('theme', newTheme); 
    });

    fetch('/api/health').then(r => r.json()).then(data => {
      const container = document.getElementById('node-list'); container.innerHTML = ''; 
      const currentOrigin = window.location.origin;

      if (data.servers && data.servers.length > 0) {
        data.servers.forEach((server) => {
          const finalUrl = \`\${currentOrigin}/\${server.url}\`;
          const isOk = server.status === 'online';
          const badge = isOk ? \`<span class="health-badge online"><div class="pulse"></div>\${server.ping}ms</span>\` 
                             : \`<span class="health-badge" style="color:var(--danger); border-color:rgba(255,69,58,0.4);"><div class="pulse" style="background:var(--danger); animation:none;"></div>异常</span>\`;
          
          const div = document.createElement('div'); div.className = 'node-item';
          div.innerHTML = \`<div class="node-info"><span class="node-name">\${server.name}</span>\${badge}</div>
                           <button class="btn-copy" onclick="copyDynamicUrl(this, '\${finalUrl}')">🔗 一键复制</button>\`;
          container.appendChild(div);
        });
      } else { container.innerHTML = '<div style="opacity:0.6;">未配置源站。</div>'; }
    }).catch(() => document.getElementById('node-list').innerHTML = '获取失败');

    window.copyDynamicUrl = function(btn, text) {
      if (btn.innerText.includes('成功')) return;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => showSuccess(btn)).catch(() => fallbackCopy(btn, text));
      } else { fallbackCopy(btn, text); }
      
      function fallbackCopy(btnObj, txt) {
        const textArea = document.createElement("textarea"); textArea.value = txt; textArea.style.position = "fixed"; textArea.style.left = "-9999px"; document.body.appendChild(textArea); textArea.focus(); textArea.select();
        try { document.execCommand('copy') ? showSuccess(btnObj) : alert('请手动复制'); } catch (err) {} document.body.removeChild(textArea);
      }
      function showSuccess(btnObj) {
        const ori = btnObj.innerText; btnObj.innerText = '✅ 复制成功'; btnObj.style.background = 'rgba(52,199,89,0.2)'; btnObj.style.color = 'var(--accent)';
        setTimeout(() => { btnObj.innerText = ori; btnObj.style.background = ''; btnObj.style.color = ''; }, 2000);
      }
    };

    async function startSpeedTest() {
      const btn = document.getElementById('btn-speed'); const num = document.getElementById('speed-num'); const prog = document.getElementById('speed-progress');
      btn.disabled = true; btn.innerText = '深空测速中...'; num.innerText = '0.00'; prog.style.strokeDasharray = '0, 100';
      try {
        const start = performance.now(); const res = await fetch('/api/speedtest?t=' + Date.now());
        const reader = res.body.getReader(); let loaded = 0; let lastT = start; let lastL = 0;
        while(true) {
          const {done, value} = await reader.read(); if (done) break; loaded += value.length; const now = performance.now();
          if (now - lastT > 250) {
            const mbps = ((loaded - lastL) * 8 / ((now - lastT)/1000) / 1048576).toFixed(2);
            num.innerText = mbps; prog.style.strokeDasharray = Math.min((mbps/1000)*100, 100) + ', 100'; lastT = now; lastL = loaded;
          }
        }
        const finalMbps = (loaded * 8 / ((performance.now() - start)/1000) / 1048576).toFixed(2);
        num.innerText = finalMbps; prog.style.strokeDasharray = Math.min((finalMbps/1000)*100, 100) + ', 100';
      } catch(e) { num.innerText = 'ERR'; } finally { btn.disabled = false; btn.innerText = '执行链路压测'; }
    }

    fetch('/stats').then(r => r.json()).then(res => {
      document.getElementById('stats-loading').style.display = 'none';
      if(res.error) { document.getElementById('stats-content').innerHTML = res.error; document.getElementById('stats-content').style.display = 'block'; return; }
      
      document.getElementById('stats-content').style.display = 'grid';
      const playEl = document.getElementById('t-play'); const timeEl = document.getElementById('t-time');
      animateValue(playEl, 0, res.data.total.playing, 1500);
      animateValue(timeEl, 0, res.data.total.onlineTime / 3600, 1500, true);

      const tbody = document.querySelector('#ip-table tbody'); tbody.innerHTML = '';
      if (res.data.ipStats && res.data.ipStats.length > 0) {
        res.data.ipStats.forEach(row => {
          const tr = document.createElement('tr');
          const mins = Math.round((row.online_time || 0) / 60);
          let ip = row.ip.includes(':') && row.ip.length > 16 ? row.ip.substring(0, 15) + '...' : row.ip;
          
          const locationText = row.location && row.location !== 'Unknown' ? row.location : '未知区域';
          const nodeText = row.target_node && row.target_node !== '-' ? row.target_node : '默认节点';

          tr.innerHTML = \`
            <td data-label="追踪 IP"><span class="ip-tag">\${ip}</span></td>
            <td data-label="地理归属"><span style="opacity:0.8;">🌍 \${locationText}</span></td>
            <td data-label="目标路由"><span class="node-tag">\${nodeText}</span></td>
            <td data-label="最后活跃"><span style="opacity:0.7;">\${row.last_time || '-'}</span></td>
            <td data-label="客户端"><span class="client-tag">\${row.client}</span></td>
            <td data-label="驻留时长"><span style="color:var(--primary); font-weight:800;">\${mins} min</span></td>
          \`;
          tbody.appendChild(tr);
        });
      } else { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.6; padding:30px;">暂无猎网数据，等待产生新流量。</td></tr>'; }
    }).catch(e => {
        document.getElementById('stats-loading').innerHTML = '请求异常，请检查 D1 绑定。';
    });
  </script>
</body>
</html>
`;

export default {
  async fetch(request, env, ctx) {
    // ⚠️ 修复核心 1：全局处理 OPTIONS 预检请求，防止播放器 CORS 拦截
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400',
            }
        });
    }

    const workerUrl = new URL(request.url);
    const currentHost = workerUrl.host;

    // ==========================================
    // [环境读取] 密码与节点从 ENV 读取，提供容错兜底
    // ==========================================
    const ACCESS_CODE = env.ACCESS_CODE || '888888';
    
    let TARGET_EMBY_SERVERS = [];
    try {
        if (env.TARGET_EMBY_SERVERS) { 
            TARGET_EMBY_SERVERS = JSON.parse(env.TARGET_EMBY_SERVERS); 
        } 
    } catch (e) {
        console.error("环境变量解析失败，使用内置备用节点");
    }

    // 兜底：如果环境变量未配置或解析失败，使用你的专属内置节点
    if (TARGET_EMBY_SERVERS.length === 0) {
        TARGET_EMBY_SERVERS = [
            { name: '✨ OK Emby', url: 'https://link00.okemby.org:8443' },
            { name: '🚀 Unbound', url: 'https://faemby.vip:443' },
            { name: '🍿 UHD', url: 'https://v1.uhdnow.com' },
            { name: '🌊 Hohai', url: 'https://emby-npo.hohai.eu.org' }
        ];
    }

    // ==========================================
    // [核心] 访客特征提取与百度 IP 探针
    // ==========================================
    const clientIp = request.headers.get('cf-connecting-ip') || 'Unknown IP';
    const userAgent = request.headers.get('User-Agent') || '未知设备';
    
    let geoLoc = '未知区域';
    if (request.cf?.country) { geoLoc = [request.cf.country, request.cf.region, request.cf.city].filter(Boolean).join(' '); }

    const isPanelBlocked = BLOCKED_PANEL_DOMAINS.includes(currentHost);
    const authCookieName = 'emby_proxy_auth';
    const cookieString = request.headers.get('Cookie') || '';
    const isAuthenticated = cookieString.includes(`${authCookieName}=${ACCESS_CODE}`);

    // API: Login
    if (workerUrl.pathname === '/api/login' && request.method === 'POST') {
        if (isPanelBlocked) return new Response(JSON.stringify({ success: false, error: 'Panel Disabled' }), { status: 403 });
        try {
            const body = await request.json();
            if (body.code === ACCESS_CODE) {
                return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${authCookieName}=${ACCESS_CODE}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict` }});
            } else { return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 }); }
        } catch(e) { return new Response(JSON.stringify({ success: false }), { status: 400 }); }
    }

    // WAF
    if (clientIp !== 'Unknown IP' && !isAuthenticated && !workerUrl.pathname.startsWith('/api/') && workerUrl.pathname !== '/' && workerUrl.pathname !== '/stats') {
        const now = Date.now(); const ipData = ipWafMap.get(clientIp) || { count: 0, startTime: now };
        if (now - ipData.startTime > 10000) { ipData.count = 1; ipData.startTime = now; } 
        else { ipData.count++; if (ipData.count > 200) return new Response('WAF Blocked.', { status: 429 }); }
        if (ipWafMap.size > 10000) ipWafMap.clear(); ipWafMap.set(clientIp, ipData);
    }

    // ==========================================
    // 1. 本地拦截路由
    // ==========================================
    const panelRoutes = ['/', '/stats', '/api/health', '/api/info', '/api/speedtest'];
    if (panelRoutes.includes(workerUrl.pathname)) {
        
        if (isPanelBlocked) {
            return new Response(BLOCKED_HTML.replace('{{CLIENT_IP}}', clientIp).replace('{{GEO_LOC}}', geoLoc).replace('{{USER_AGENT}}', userAgent), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (workerUrl.pathname === '/') {
            if (!isAuthenticated) return new Response(LOGIN_HTML.replace('${WALLPAPER_ENGINE_HTML}', WALLPAPER_ENGINE_HTML), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            return new Response(FRONTEND_HTML.replace('${WALLPAPER_ENGINE_HTML}', WALLPAPER_ENGINE_HTML), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (workerUrl.pathname === '/api/health') {
            const checkServer = async (serverObj) => {
                const startTime = Date.now();
                try {
                    const cleanUrl = serverObj.url.replace(/\/$/, ''); const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000); 
                    const res = await fetch(cleanUrl + '/system/info/public', { signal: controller.signal, headers: { 'User-Agent': 'CF-Worker' } }); clearTimeout(timeoutId);
                    if (res.ok) return { name: serverObj.name, url: cleanUrl, status: 'online', ping: Date.now() - startTime }; 
                    else return { name: serverObj.name, url: cleanUrl, status: 'error', detail: res.status };
                } catch (e) { return { name: serverObj.name, url: serverObj.url, status: 'offline', detail: e.message }; }
            };
            const results = await Promise.all(TARGET_EMBY_SERVERS.map(checkServer));
            return new Response(JSON.stringify({ servers: results }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (workerUrl.pathname === '/api/info') {
            let finalLoc = geoLoc;
            try {
                const bRes = await fetch(`https://qifu-api.baidubce.com/info/rvh/getIpInfo?ip=${clientIp}`);
                const bData = await bRes.json();
                if (bData.code === 'Success' && bData.data) {
                    finalLoc = [bData.data.country, bData.data.prov, bData.data.city, bData.data.isp].filter(Boolean).join(' ');
                }
            } catch(e) {}
            return new Response(JSON.stringify({ ip: clientIp, location: finalLoc }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
        }

        if (workerUrl.pathname === '/api/speedtest') {
            const size = 10 * 1024 * 1024; const buffer = new Uint8Array(size);
            return new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': size.toString(), 'Cache-Control': 'no-store' } });
        }
        
        if (workerUrl.pathname === '/stats') { 
            if (!isAuthenticated) return new Response('Unauthorized', { status: 401 });
            return handleStatsRequest(env); 
        }
    }

    if (workerUrl.pathname === '/favicon.ico') { return new Response('', { headers: { 'Content-Type': 'image/x-icon' } }); }
    if (workerUrl.pathname.startsWith('/cdn-cgi/')) { return new Response('Not Found', { status: 404 }); }

    // ==========================================
    // 2. 反向代理业务逻辑
    // ==========================================
    let upstreamUrl;
    try {
        let path = workerUrl.pathname.substring(1);
        
        // ⚠️ 修复核心 2：恢复严格的格式校验，严禁使用 includes('PlaybackInfo') 误杀合法请求！
        if (path.startsWith('/')) { return new Response('Invalid format.', { status: 400 }); }
        if (path === 'Sessions/Playing' || path.startsWith('Sessions/Playing/') || path === 'PlaybackInfo' || path.startsWith('PlaybackInfo/')) { return new Response('Invalid format.', { status: 400 }); }
        
        path = path.replace(/^(https?)\/(?!\/)/, '$1://'); if (!path.startsWith('http')) path = 'https://' + path;
        upstreamUrl = new URL(path); upstreamUrl.search = workerUrl.search;
        if (!upstreamUrl.hostname) return new Response('Invalid.', { status: 400 });
    } catch (e) { return new Response('Invalid URL.', { status: 400 }); }

    const currentEdgeColo = request.cf?.colo;
    if (currentEdgeColo && JP_COLOS.includes(currentEdgeColo)) {
        for (const suffix in DOMAIN_PROXY_RULES) {
            if (upstreamUrl.host.endsWith(suffix)) { upstreamUrl.hostname = DOMAIN_PROXY_RULES[suffix]; break; }
        }
    }

    let clientName = request.headers.get('X-Emby-Client') || (userAgent.toLowerCase().includes('vidhub') ? 'VidHub' : userAgent.toLowerCase().includes('infuse') ? 'Infuse' : 'WebBrowser');
    let targetNodeName = '默认源站';
    
    for (const srv of TARGET_EMBY_SERVERS) {
        try {
            if (upstreamUrl.origin.includes(new URL(srv.url).host)) { targetNodeName = srv.name; break; }
        } catch(e) {}
    }

    if (upstreamUrl.pathname.endsWith('/Sessions/Playing/Progress')) ctx.waitUntil(recordStats(env, 'progress', clientName, clientIp, targetNodeName));
    else if (upstreamUrl.pathname.endsWith('/Sessions/Playing')) ctx.waitUntil(recordStats(env, 'playing', clientName, clientIp, targetNodeName));
    else if (upstreamUrl.pathname.includes('/PlaybackInfo')) ctx.waitUntil(recordStats(env, 'playback_info', clientName, clientIp, targetNodeName));

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return fetch(upstreamUrl.toString(), request);

    const upstreamReqHeaders = new Headers(request.headers);
    upstreamReqHeaders.set('Host', upstreamUrl.host); upstreamReqHeaders.delete('Referer'); 
    if (clientIp !== 'Unknown IP') { upstreamReqHeaders.set('x-forwarded-for', clientIp); upstreamReqHeaders.set('x-real-ip', clientIp); }

    const upstreamReq = new Request(upstreamUrl.toString(), { method: request.method, headers: upstreamReqHeaders, body: request.body, redirect: 'manual' });

    let upstreamRes; let isCacheHit = false; const cache = caches.default; let cacheKey;
    const isImg = request.method === 'GET' && upstreamUrl.pathname.match(/\/(Items|Users)\/.*\/Images\//i);

    if (isImg) {
        cacheKey = new Request(upstreamUrl.toString(), request); const cachedRes = await cache.match(cacheKey);
        if (cachedRes) { upstreamRes = new Response(cachedRes.body, cachedRes); isCacheHit = true; }
    }

    if (!upstreamRes) {
        upstreamRes = await fetch(upstreamReq);
        if (isImg && upstreamRes.status === 200) {
            const resToCache = new Response(upstreamRes.clone().body, upstreamRes); resToCache.headers.set('Cache-Control', 'public, max-age=2592000'); 
            ctx.waitUntil(cache.put(cacheKey, resToCache));
        }
    }

    const locUrl = upstreamRes.headers.get('Location');
    if (locUrl && upstreamRes.status >= 300 && upstreamRes.status < 400) {
      try {
        const redirUrl = new URL(locUrl, upstreamUrl);
        if (MANUAL_REDIRECT_DOMAINS.some(d => redirUrl.hostname.endsWith(d))) {
          const redirHead = new Headers(upstreamRes.headers); 
          redirHead.set('Location', redirUrl.toString());
          
          // ⚠️ 修复核心 3：为 302 重定向补齐跨域头
          redirHead.set('Access-Control-Allow-Origin', '*'); 
          redirHead.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          redirHead.set('Access-Control-Allow-Headers', '*');
          
          return new Response(upstreamRes.body, { status: upstreamRes.status, headers: redirHead });
        }
        const followHead = new Headers(upstreamReqHeaders); followHead.set('Host', redirUrl.host);
        return fetch(redirUrl.toString(), { method: request.method, headers: followHead, body: request.body, redirect: 'follow' });
      } catch (e) { return upstreamRes; }
    }

    const resHead = new Headers(upstreamRes.headers);
    // ⚠️ 修复核心 4：为正常流媒体请求补齐跨域头，防止浏览器直接阻断
    resHead.set('Access-Control-Allow-Origin', '*'); 
    resHead.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    resHead.set('Access-Control-Allow-Headers', '*');
    resHead.delete('Content-Security-Policy'); 
    resHead.delete('X-Frame-Options');

    if (isImg) resHead.set('X-Edge-Cache-Status', isCacheHit ? 'HIT' : 'MISS');
    return new Response(upstreamRes.body, { status: upstreamRes.status, headers: resHead });
  },
};

// ==========================================
// 附加工具模块：D1 数据库交互层
// ==========================================

async function recordStats(env, type, clientName, clientIp, targetNodeName) {
    try {
        if (!env.DB) return;
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
        const nowTime = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
        
        let geoLoc = '未知区域';
        if (clientIp && clientIp !== 'Unknown IP') {
            try {
                const res = await fetch(`https://qifu-api.baidubce.com/info/rvh/getIpInfo?ip=${clientIp}`);
                const data = await res.json();
                if (data.code === 'Success' && data.data) geoLoc = [data.data.country, data.data.prov, data.data.city, data.data.isp].filter(Boolean).join(' '); 
            } catch (err) {}
        }

        if (type === 'playing') {
            await env.DB.prepare(`INSERT INTO auto_emby_daily_stats (date, playing_count, playback_info_count, online_time, clients) VALUES (?, 1, 0, 0, json_object(?, 1)) ON CONFLICT(date) DO UPDATE SET playing_count = playing_count + 1, clients = json_set(clients, '$.' || ?, coalesce(json_extract(clients, '$.' || ?), 0) + 1)`).bind(today, clientName, clientName, clientName).run();
        } else if (type === 'playback_info') {
            await env.DB.prepare(`INSERT INTO auto_emby_daily_stats (date, playing_count, playback_info_count, online_time, clients) VALUES (?, 0, 1, 0, json_object(?, 1)) ON CONFLICT(date) DO UPDATE SET playback_info_count = playback_info_count + 1, clients = json_set(clients, '$.' || ?, coalesce(json_extract(clients, '$.' || ?), 0) + 1)`).bind(today, clientName, clientName, clientName).run();
        } else if (type === 'progress') {
            await env.DB.prepare(`INSERT INTO auto_emby_daily_stats (date, playing_count, playback_info_count, online_time, clients) VALUES (?, 0, 0, 10, '{}') ON CONFLICT(date) DO UPDATE SET online_time = online_time + 10`).bind(today).run();
        }

        let addTime = (type === 'progress') ? 10 : 0;
        await env.DB.prepare(`
            INSERT INTO auto_emby_ip_stats (date, ip, client, online_time, last_time, location, target_node)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, ip, client) DO UPDATE SET online_time = online_time + ?, last_time = ?, location = CASE WHEN ? = '未知区域' THEN location ELSE ? END, target_node = ?
        `).bind(today, clientIp, clientName, addTime, nowTime, geoLoc, targetNodeName, addTime, nowTime, geoLoc, geoLoc, targetNodeName).run();

    } catch (e) {}
}

async function handleStatsRequest(env) {
    try {
        if (!env.DB) return new Response(JSON.stringify({ error: "D1 数据库未绑定" }), { headers: { 'Content-Type': 'application/json' }});
        const totalResult = await env.DB.prepare(`SELECT SUM(playing_count) as total_playing, SUM(playback_info_count) as total_playback_info, SUM(online_time) as total_online_time FROM auto_emby_daily_stats WHERE date >= date(datetime('now', '+8 hours'), '-30 days')`).first();
        const ipStatsResult = await env.DB.prepare(`SELECT date, ip, client, online_time, last_time, location, target_node FROM auto_emby_ip_stats WHERE date >= date(datetime('now', '+8 hours'), '-3 days') ORDER BY date DESC, last_time DESC LIMIT 100`).all();

        return new Response(JSON.stringify({
            error: null,
            data: { 
                ipStats: ipStatsResult.results || [],
                total: { playing: totalResult?.total_playing || 0, onlineTime: totalResult?.total_online_time || 0 }
            }
        }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { headers: { 'Content-Type': 'application/json' }});
    }
}
