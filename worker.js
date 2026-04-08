/**
 * =================================================================================
 * Cloudflare Worker Emby 终极版 v9.0 (无痕安全 + 华丽卡片 + 环境变量驱动)
 * =================================================================================
 */

const SPEEDTEST_CHUNK = new Uint8Array(1024 * 1024);

// 🧠 内存缓存
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

// 🛑 华丽卡片拦截界面 HTML
function getBlockedHTML(ip, countryCode, city, colo, reason = 'region') {
  const countryMap = { 'CN': '中国大陆', 'HK': '中国香港', 'TW': '中国台湾', 'SG': '新加坡', 'JP': '日本', 'KR': '韩国', 'US': '美国' };
  const locName = (countryMap[countryCode] || countryCode) + (city ? ' ' + city : '');
  const title = reason === 'banned' ? '账号异常封禁' : '触发访问限制';
  const desc = reason === 'banned' ? '由于检测到您的 IP 存在异常行为，系统已将其永久拉黑。' : '站长开启了区域访问策略，您所在的地理位置暂不在服务范围内。';
  const icon = reason === 'banned' ? '🚫' : '🚧';
  
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><title>🛑 ${title}</title>
  <style>
    :root { --bg: #0f172a; --card-bg: rgba(30, 41, 59, 0.8); --text: #f8fafc; --accent: #6366f1; --border: rgba(255,255,255,0.1); }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, system-ui, sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 1rem; box-sizing: border-box; }
    .card { background: var(--card-bg); backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: 24px; padding: 2rem; width: 100%; max-width: 400px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .icon { font-size: 4rem; margin-bottom: 1rem; display: block; }
    h2 { font-size: 1.5rem; margin: 0 0 1rem; color: #ef4444; }
    p { color: #94a3b8; line-height: 1.6; font-size: 0.95rem; margin-bottom: 2rem; }
    .info-list { background: rgba(0,0,0,0.2); border-radius: 16px; padding: 1rem; text-align: left; }
    .info-item { display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding: 0.5rem 0; font-size: 0.85rem; }
    .info-item:last-child { border-bottom: none; }
    .label { color: #64748b; }
    .val { font-family: monospace; color: var(--accent); font-weight: bold; }
  </style></head><body><div class="card"><span class="icon">${icon}</span><h2>${title}</h2><p>${desc}</p>
  <div class="info-list">
    <div class="info-item"><span class="label">客户端 IP:</span><span class="val">${ip}</span></div>
    <div class="info-item"><span class="label">地理位置:</span><span class="val">${locName}</span></div>
    <div class="info-item"><span class="label">连接节点:</span><span class="val">${colo}</span></div>
  </div></div></body></html>`;
}

// 📊 数据大屏 FRONTEND_HTML (由于你之前已经有了，这里直接合并)
const FRONTEND_HTML = \`...\`; // 请保留你之前的 HTML 代码

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const config = await syncConfig(env);
    
    // 🔐 环境变量获取（如果没有配置，则设为 undefined）
    const TARGET_EMBY = env.TARGET_EMBY_SERVER;
    const PANEL_PWD = env.PANEL_PASSWORD;

    const clientIp = request.headers.get('cf-connecting-ip') || '未知 IP';
    const countryCode = request.cf?.country || 'XX';
    const city = request.cf?.city || '';
    const colo = request.cf?.colo || 'N/A';

    // 💡 环境变量自检：如果没配置，直接拦截并报错
    if (!TARGET_EMBY) {
        return new Response('⚠️ Worker 未就绪：请在 Cloudflare 环境变量中设置 TARGET_EMBY_SERVER', { status: 500 });
    }

    // =====================================
    // 🛡️ 拦截网关
    // =====================================
    const isSpecialPath = url.pathname === '/dash' || url.pathname.startsWith('/api') || url.pathname === '/auth/verify';
    
    if (!isSpecialPath) {
      if (config.blacklist.includes(clientIp)) {
        return new Response(getBlockedHTML(clientIp, countryCode, city, colo, 'banned'), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' }});
      }
      if (config.allowedRegions.length > 0 && countryCode !== 'XX' && !config.allowedRegions.includes(countryCode)) {
        return new Response(getBlockedHTML(clientIp, countryCode, city, colo, 'region'), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' }});
      }
    }

    // =====================================
    // 🎮 大屏与 API 逻辑
    // =====================================
    if (url.pathname === '/dash') return new Response(FRONTEND_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    
    const authKey = request.headers.get('X-Api-Key');
    const isApi = ['/stats', '/trace', '/speedtest', '/auth/verify', '/api/config', '/api/ban', '/api/speedlog'].includes(url.pathname);
    
    if (isApi) {
      if (authKey !== (PANEL_PWD || 'emby')) return new Response(JSON.stringify({ok:false, error:'Unauthorized'}), { status: 401 });
      if (url.pathname === '/auth/verify') return new Response(JSON.stringify({ok:true}));
      if (url.pathname === '/stats') return handleStatsRequest(env);
      if (url.pathname === '/trace') return new Response(JSON.stringify({ ip: clientIp, colo: colo }));
      if (url.pathname === '/speedtest') return new Response(new ReadableStream({ start(c) { for(let i=0; i<15; i++) c.enqueue(SPEEDTEST_CHUNK); c.close(); } }));
      // ... 其他 API 逻辑由你之前的版本补全
    }

    // =====================================
    // 🎬 核心：专线代理（全量透传）
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
    
    // 修复最关键的 POST 登录 Bug
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      options.body = request.body;
    }

    options.headers.set('Host', upstream.host);
    
    // 提速：干掉 Accept-Encoding，强迫源站返回原始流
    if (upstream.pathname.includes('/PlaybackInfo') || upstream.pathname.includes('/stream')) {
        options.headers.delete('Accept-Encoding');
    }

    return fetch(upstream.toString(), options);
  }
};

// ... handleStatsRequest 等数据库函数保持不变

