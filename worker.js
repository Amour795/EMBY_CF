/**
 * =================================================================================
 * Cloudflare Worker Emby 终极版 v8.0 (专线直连 + 严控拦截 + 环境变量驱动)
 * =================================================================================
 * ⚠️ 部署后请务必在 CF -> Settings -> Variables 设置：
 * 1. TARGET_EMBY_SERVER (如: https://link00.okemby.org:8443)
 * 2. PANEL_PASSWORD (设置大屏密码)
 */

const SPEEDTEST_CHUNK = new Uint8Array(1024 * 1024);

// =====================================
// 🧠 配置同步与缓存
// =====================================
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
  } catch(e) { console.error("Sync Error", e); }
  return CACHED_CONFIG;
}

// =====================================
// 🛑 拦截界面 HTML
// =====================================
function getBlockedHTML(ip, countryCode, city, colo, reason = 'region') {
  const countryMap = { 'CN': '中国大陆', 'HK': '中国香港', 'TW': '中国台湾', 'SG': '新加坡', 'JP': '日本', 'KR': '韩国', 'US': '美国' };
  const locName = (countryMap[countryCode] || countryCode) + (city ? ' ' + city : '');
  const title = reason === 'banned' ? '账号封禁' : '访问受限';
  const desc = reason === 'banned' ? '系统检测到异常行为，IP 已被永久封禁。' : '当前所在地区暂未开放访问，请联系站长。';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><title>🛑 访问受限</title><style>body{background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#1e293b;padding:2rem;border-radius:16px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.3);max-width:380px}.icon{font-size:4rem;margin-bottom:1rem}h2{color:#ef4444;margin:0 0 1rem}p{color:#94a3b8;line-height:1.5}.info{margin-top:1.5rem;background:rgba(0,0,0,0.2);padding:1rem;border-radius:10px;text-align:left;font-size:0.85rem}.info-row{display:flex;justify-content:space-between;margin:0.3rem 0}</style></head><body><div class="card"><div class="icon">${reason==='banned'?'🚫':'🚧'}</div><h2>${title}</h2><p>${desc}</p><div class="info"><div class="info-row"><span>IP:</span><span>${ip}</span></div><div class="info-row"><span>地区:</span><span>${locName}</span></div><div class="info-row"><span>节点:</span><span>${colo}</span></div></div></div></body></html>`;
}

// =====================================
// 📊 数据大屏 HTML (保持原样)
// =====================================
const FRONTEND_HTML = `...`; // (此处省略，保持你之前的 HTML 内容即可)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const config = await syncConfig(env);
    
    // 🔐 环境参数
    const TARGET_SERVER = env.TARGET_EMBY_SERVER || 'https://link00.okemby.org:8443';
    const ADMIN_PWD = env.PANEL_PASSWORD || 'emby';

    const clientIp = request.headers.get('cf-connecting-ip') || '未知';
    const countryCode = request.cf?.country || 'XX';
    const city = request.cf?.city || '';
    const colo = request.cf?.colo || 'N/A';

    // =====================================
    // 🛡️ 核心拦截网关 (所有非管理员路径都必须检查)
    // =====================================
    const isAdminPath = url.pathname === '/dash' || url.pathname.startsWith('/api') || url.pathname === '/auth/verify';
    
    if (!isAdminPath) {
      // 1. 黑名单拦截
      if (config.blacklist.includes(clientIp)) {
        return new Response(getBlockedHTML(clientIp, countryCode, city, colo, 'banned'), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' }});
      }
      // 2. 地区拦截 (如果设置了允许区域)
      if (config.allowedRegions.length > 0 && countryCode !== 'XX' && !config.allowedRegions.includes(countryCode)) {
        return new Response(getBlockedHTML(clientIp, countryCode, city, colo, 'region'), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' }});
      }
    }

    // =====================================
    // 🎮 API 路由
    // =====================================
    if (url.pathname === '/dash') return new Response(FRONTEND_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    
    const authKey = request.headers.get('X-Api-Key');
    const isApiRequest = ['/stats', '/trace', '/speedtest', '/auth/verify', '/api/config', '/api/ban', '/api/speedlog'].includes(url.pathname);
    
    if (isApiRequest) {
      if (authKey !== ADMIN_PWD) return new Response(JSON.stringify({ok:false, error:'Unauthorized'}), { status: 401 });
      if (url.pathname === '/auth/verify') return new Response(JSON.stringify({ok:true}), { status: 200 });
      if (url.pathname === '/stats') return handleStatsRequest(env);
      if (url.pathname === '/trace') return new Response(JSON.stringify({ ip: clientIp, colo: colo }));
      if (url.pathname === '/speedtest') return new Response(new ReadableStream({ start(c) { for(let i=0; i<15; i++) c.enqueue(SPEEDTEST_CHUNK); c.close(); } }));
      // ... 其余 API 逻辑保持一致
    }

    // =====================================
    // 🎬 Emby 转发引擎 (带 Body 透传)
    // =====================================
    let upstream = new URL(request.url);
    const targetURL = new URL(TARGET_SERVER);
    upstream.protocol = targetURL.protocol;
    upstream.hostname = targetURL.hostname;
    upstream.port = targetURL.port;

    const options = { 
      method: request.method, 
      headers: new Headers(request.headers),
      redirect: 'manual' 
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      options.body = request.body;
    }
    options.headers.set('Host', upstream.host);
    
    // 首屏加速
    if (/\.(mp4|mkv|ts|m3u8|PlaybackInfo)$/i.test(upstream.pathname)) {
      options.headers.delete('Accept-Encoding'); 
    }

    return fetch(upstream.toString(), options);
  }
};

// 后续 handleStatsRequest 等函数保持不变...
