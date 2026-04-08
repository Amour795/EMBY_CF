/**
 * =================================================================================
 * Cloudflare Worker Emby 终极版 v10.0 (IP信息全显示 + 环境变量驱动 + 专线代理)
 * =================================================================================
 */

const SPEEDTEST_CHUNK = new Uint8Array(1024 * 1024);
let CACHED_CONFIG = { allowedRegions: [], blacklist: [], expire: 0 };

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

// 🛑 增强版拦截界面：显示访问者详细地理位置与网络信息
function getBlockedHTML(ip, cf, reason = 'region') {
  const countryMap = { 'CN': '中国大陆', 'HK': '中国香港', 'TW': '中国台湾', 'SG': '新加坡', 'JP': '日本', 'US': '美国' };
  const countryName = countryMap[cf.country] || cf.country || '未知国家';
  const cityName = cf.city || '未知城市';
  const isp = cf.asOrganization || '未知运营商';
  const colo = cf.colo || 'N/A';
  
  const title = reason === 'banned' ? '账号异常封禁' : '区域访问受限';
  const desc = reason === 'banned' ? '您的设备已被系统永久拉黑，无法访问此资源。' : '抱歉，当前所在地区未在站长的授权访问范围内。';
  const icon = reason === 'banned' ? '🚫' : '🚧';

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><title>🛑 ${title}</title>
  <style>
    :root { --bg: #0f172a; --card-bg: rgba(30, 41, 59, 0.85); --text: #f8fafc; --accent: #6366f1; --border: rgba(255,255,255,0.1); }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 1rem; box-sizing: border-box; overflow: hidden; }
    .card { background: var(--card-bg); backdrop-filter: blur(16px); border: 1px solid var(--border); border-radius: 28px; padding: 2.5rem 2rem; width: 100%; max-width: 420px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .icon { font-size: 4.5rem; margin-bottom: 1.2rem; display: block; }
    h2 { font-size: 1.6rem; margin: 0 0 0.8rem; color: #ef4444; font-weight: 800; }
    p { color: #94a3b8; line-height: 1.6; font-size: 0.95rem; margin-bottom: 2rem; padding: 0 10px; }
    .info-list { background: rgba(0,0,0,0.25); border-radius: 20px; padding: 1.2rem; text-align: left; border: 1px solid var(--border); }
    .info-item { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(255,255,255,0.05); padding: 0.7rem 0; font-size: 0.85rem; }
    .info-item:last-child { border-bottom: none; }
    .label { color: #64748b; white-space: nowrap; margin-right: 1rem; }
    .val { font-family: "SF Mono", monospace; color: var(--accent); font-weight: 600; text-align: right; word-break: break-all; }
  </style></head><body><div class="card"><span class="icon">${icon}</span><h2>${title}</h2><p>${desc}</p>
  <div class="info-list">
    <div class="info-item"><span class="label">访问 IP</span><span class="val">${ip}</span></div>
    <div class="info-item"><span class="label">国家地区</span><span class="val">${countryName}</span></div>
    <div class="info-item"><span class="label">所在城市</span><span class="val">${cityName}</span></div>
    <div class="info-item"><span class="label">运营商</span><span class="val">${isp}</span></div>
    <div class="info-item"><span class="label">数据中心</span><span class="val">${colo}</span></div>
  </div></div></body></html>`;
}

// 📊 数据大屏 HTML 内容 (此处保持之前版本)
const FRONTEND_HTML = `...`; // 请在这里粘贴之前版本的大屏 HTML 代码

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const config = await syncConfig(env);
    
    // 🔐 从环境变量动态读取 (TARGET_EMBY_SERVER & PANEL_PASSWORD)
    const TARGET_EMBY = env.TARGET_EMBY_SERVER;
    const PANEL_PWD = env.PANEL_PASSWORD || 'emby';

    const clientIp = request.headers.get('cf-connecting-ip') || '未知';
    const cfData = request.cf || {};

    // 💡 检查 Worker 是否已配置变量
    if (!TARGET_EMBY) {
        return new Response('⚠️ Worker 运行错误：未配置 TARGET_EMBY_SERVER 环境变量。', { status: 500 });
    }

    // =====================================
    // 🛡️ 智能拦截网关
    // =====================================
    const isControlPath = url.pathname === '/dash' || url.pathname.startsWith('/api') || url.pathname === '/auth/verify';
    
    if (!isControlPath) {
      // 1. 黑名单校验
      if (config.blacklist.includes(clientIp)) {
        return new Response(getBlockedHTML(clientIp, cfData, 'banned'), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' }});
      }
      // 2. 地区白名单校验
      const countryCode = cfData.country || 'XX';
      if (config.allowedRegions.length > 0 && countryCode !== 'XX' && !config.allowedRegions.includes(countryCode)) {
        return new Response(getBlockedHTML(clientIp, cfData, 'region'), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' }});
      }
    }

    // =====================================
    // 🎮 API 路由处理
    // =====================================
    if (url.pathname === '/dash') return new Response(FRONTEND_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    
    const authKey = request.headers.get('X-Api-Key');
    const isApi = ['/stats', '/trace', '/speedtest', '/auth/verify', '/api/config', '/api/ban', '/api/speedlog'].includes(url.pathname);
    
    if (isApi) {
      if (authKey !== PANEL_PWD) return new Response(JSON.stringify({ok:false}), { status: 401 });
      if (url.pathname === '/auth/verify') return new Response(JSON.stringify({ok:true}));
      if (url.pathname === '/stats') return handleStatsRequest(env);
      if (url.pathname === '/trace') return new Response(JSON.stringify({ ip: clientIp, colo: cfData.colo || 'N/A' }));
      if (url.pathname === '/speedtest') return new Response(new ReadableStream({ start(c) { for(let i=0; i<15; i++) c.enqueue(SPEEDTEST_CHUNK); c.close(); } }));
      
      // 处理数据库更新操作
      if (request.method === 'POST') {
        const body = await request.json();
        if (url.pathname === '/api/config') {
          const regionsJSON = JSON.stringify(body.allowedRegions || []);
          await env.DB.prepare("INSERT INTO auto_emby_config (key, value) VALUES ('allowed_regions', ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(regionsJSON, regionsJSON).run();
          CACHED_CONFIG.expire = 0; return new Response(JSON.stringify({ok:true}));
        }
        if (url.pathname === '/api/ban') {
          await env.DB.prepare("INSERT INTO auto_emby_blacklist (ip, created_at) VALUES (?, ?) ON CONFLICT(ip) DO NOTHING").bind(body.ip, new Date().toISOString()).run();
          CACHED_CONFIG.expire = 0; return new Response(JSON.stringify({ok:true}));
        }
        if (url.pathname === '/api/speedlog') {
          await env.DB.prepare("INSERT INTO auto_emby_speed_log (created_at, ip, loc, isp, ping, speed_mbps) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(new Date().toISOString(), clientIp, body.loc, body.isp, body.ping, body.speed_mbps).run();
          return new Response(JSON.stringify({ok:true}));
        }
      }
    }

    // =====================================
    // 🎬 核心：全透明专线代理 (支持 POST Body)
    // =====================================
    let upstream = new URL(request.url);
    const target = new URL(TARGET_EMBY);
    upstream.protocol = target.protocol;
    upstream.hostname = target.hostname;
    upstream.port = target.port;

    const options = { 
      method: request.method, 
      headers: new Headers(request.headers),
      redirect: 'manual' 
    };
    
    // 💡 关键：确保非 GET 的 Body 能够传给 Emby (登录必用)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      options.body = request.body;
    }

    options.headers.set('Host', upstream.host);
    
    // 流媒体优化：干掉压缩编码提速
    if (upstream.pathname.includes('/PlaybackInfo') || upstream.pathname.includes('/stream')) {
        options.headers.delete('Accept-Encoding');
    }

    // 记录播放统计 (异步不阻塞主进程)
    if (upstream.pathname.includes('/Playing/Progress')) ctx.waitUntil(recordUserAudit(env, clientIp, "Player", 10));

    return fetch(upstream.toString(), options);
  }
};

// 🗄️ 数据库统计函数 ( recordUserAudit, handleStatsRequest 等保持之前逻辑)
async function recordUserAudit(env, ip, client, sec) {
  if (!env.DB) return;
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    await env.DB.prepare("INSERT INTO auto_emby_user_stats (date, ip, client_name, duration_sec) VALUES (?, ?, ?, ?) ON CONFLICT(date, ip, client_name) DO UPDATE SET duration_sec = duration_sec + ?").bind(today, ip, client, sec, sec).run();
  } catch (e) {}
}

async function handleStatsRequest(env) {
  if (!env.DB) return new Response(JSON.stringify({ok: false, error: "D1 Not Ready"}));
  try {
    const batch = await env.DB.batch([
      env.DB.prepare("SELECT date, playing_count FROM auto_emby_daily_stats ORDER BY date DESC LIMIT 10"),
      env.DB.prepare("SELECT ip, client_name, SUM(duration_sec) as duration_sec FROM auto_emby_user_stats GROUP BY ip, client_name ORDER BY duration_sec DESC LIMIT 10"),
      env.DB.prepare("SELECT client_name, SUM(count) as total_count FROM auto_emby_client_stats GROUP BY client_name ORDER BY total_count DESC LIMIT 8"),
      env.DB.prepare("SELECT COALESCE(SUM(playing_count),0) as playing, COALESCE(SUM(playback_info_count),0) as playbackInfo FROM auto_emby_daily_stats"),
      env.DB.prepare("SELECT created_at, loc, isp, ping, speed_mbps FROM auto_emby_speed_log ORDER BY id DESC LIMIT 5")
    ]);
    return new Response(JSON.stringify({ ok: true, data: { dailyStats: batch[0].results, userStats: batch[1].results, clientStats: batch[2].results, total: batch[3].results[0], speedLogs: batch[4].results ? batch[4].results : [] } }));
  } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message })); }
}
