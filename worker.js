export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- 1. 核心逻辑：动态提取目标地址 ---
    // 注意：浏览器和 Cloudflare 常常会把路径里的双斜杠 // 压缩成单斜杠 /
    // 所以你输入的 https:// 到了代码里会变成 /https:/
    const subPathPrefix = "/https:/";
    
    // 如果没有严格按照代理格式请求，直接拦截（没有默认站了）
    if (!url.pathname.startsWith(subPathPrefix)) {
      return new Response("Sikt Proxy Gateway is running. 请在 URL 后面拼接目标地址，例如: /https://v1.uhdnow.com", { 
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    // 提取出真实的目标 URL
    const fullTargetUrlString = "https:/" + url.pathname.slice(subPathPrefix.length) + url.search;
    let targetHost = "";
    let upstreamProtocol = "";
    let finalPathAndQuery = "";

    try {
      const fullTargetUrl = new URL(fullTargetUrlString);
      targetHost = fullTargetUrl.host;
      upstreamProtocol = fullTargetUrl.protocol;
      finalPathAndQuery = fullTargetUrl.pathname + fullTargetUrl.search;
    } catch (e) {
      return new Response(`[Gateway Error] 提取目标域名失败，请检查格式是否正确。错误: ${e.message}`, { status: 400 });
    }

    const upstreamUrlString = `${upstreamProtocol}//${targetHost}${finalPathAndQuery}`;

    // --- 2. 构造完美伪装请求头 ---
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetHost);
    newHeaders.set("Referer", `${upstreamProtocol}//${targetHost}/`);
    newHeaders.set("Origin", `${upstreamProtocol}//${targetHost}`);
    newHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    // 抹除代理痕迹
    newHeaders.delete("CF-Connecting-IP");
    newHeaders.delete("CF-Ray");
    newHeaders.delete("X-Forwarded-Proto");

    const fetchOptions = {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: "manual" // 【改动】这里改为 manual 手动处理重定向，防止源站重定向导致跨域问题
    };

    try {
      let response = await fetch(upstreamUrlString, fetchOptions);
      const responseHeaders = new Headers(response.headers);
      
      // --- 3. 流媒体极速传输优化 ---
      if (url.pathname.includes('/stream') || url.pathname.includes('/PlaybackInfo')) {
         responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
         responseHeaders.set('Pragma', 'no-cache');
         responseHeaders.set('Expires', '0');
      }

      // --- 4. 动态重定向重写（极其重要） ---
      // 当源站（比如 Emby）要求你跳转到 /web/index.html 时，我们要把它改写回代理格式
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        if (location) {
          // 如果重定向是完整的绝对路径
          if (location.startsWith(`${upstreamProtocol}//${targetHost}`)) {
            const proxyPrefix = `${url.origin}${subPathPrefix}${targetHost}`;
            const newLocation = location.replace(`${upstreamProtocol}//${targetHost}`, proxyPrefix);
            responseHeaders.set("Location", newLocation);
          } 
          // 如果重定向是相对路径 (比如 /web/index.html)
          else if (location.startsWith("/")) {
             responseHeaders.set("Location", `${url.origin}${subPathPrefix}${targetHost}${location}`);
          }
          return new Response(null, {
            status: response.status,
            headers: responseHeaders
          });
        }
      }

      // --- 5. 跨域放行 ---
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, TRACE, OPTIONS, PATCH");
      responseHeaders.set("Access-Control-Allow-Headers", "*");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (e) {
      return new Response(`[ Gateway 502 ] 无法代理到目标: ${targetHost}\n网络报错: ${e.message}`, { status: 502 });
    }
  }
};
