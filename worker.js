export default {
  async fetch(request, env, ctx) {
    // --- 目标源站配置 ---
    const TARGET_HOST = "v1.uhdnow.com"; 
    const TARGET_URL = `https://${TARGET_HOST}`;

    const url = new URL(request.url);
    // 构造发往源站的新 URL
    const upstreamUrl = new URL(url.pathname + url.search, TARGET_URL);

    // 复制原始请求头并进行修正
    const newHeaders = new Headers(request.headers);
    
    // 【核心操作】必须重写 Host 头部，否则对方服务器会报 403 或 SSL 错误
    newHeaders.set("Host", TARGET_HOST);
    
    // 清理掉可能干扰反代的原始信息
    newHeaders.delete("Referer");
    newHeaders.delete("Origin");

    const modifiedRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: "follow" 
    });

    try {
      const response = await fetch(modifiedRequest);
      
      // 构造响应，允许流媒体直接通过
      const responseHeaders = new Headers(response.headers);
      
      // 跨域和缓存优化
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      if (url.pathname.includes('/stream') || url.pathname.includes('/PlaybackInfo')) {
         responseHeaders.set('Cache-Control', 'no-store');
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (e) {
      return new Response(`[Sikt-Worker] 无法连接到 UHD 源站: ${e.message}`, { status: 502 });
    }
  }
};
