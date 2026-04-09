export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    let targetUrlStr = "";

    // 1. 通用解析引擎：提取路径中的目标 URL (兼容 http/https 以及 CF 的单斜杠压缩)
    const proxyRegex = /^\/(https?):\/?\/?(.*)$/;
    const match = path.match(proxyRegex);

    if (match) {
      // 场景 A：直接带完整目标地址的请求，例如 /https://emby.example.com
      targetUrlStr = `${match[1]}://${match[2]}${url.search}`;
    } else {
      // 场景 B：API 相对路径自动寻路（参考原版逻辑的核心机制）
      // 当页面内部请求 /emby/system/info 时，通过 Referer 顺藤摸瓜找到原本代理的域名
      const referer = request.headers.get("Referer");
      if (referer) {
        try {
          const refUrl = new URL(referer);
          const refMatch = refUrl.pathname.match(proxyRegex);
          if (refMatch) {
            const targetOrigin = `${refMatch[1]}://${refMatch[2].split('/')[0]}`;
            targetUrlStr = `${targetOrigin}${path}${url.search}`;
          }
        } catch (e) {
          // 解析失败静默处理
        }
      }
    }

    // 2. 无效请求拦截
    if (!targetUrlStr) {
      return new Response("🚀 Sikt Universal Proxy is running.\n\n用法: https://你的域名/https://目标地址\n例如: https://sikt.club/https://emby.xxx.com:8096", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    const targetUrl = new URL(targetUrlStr);

    // 3. 构造底层请求头（全量伪装）
    const headers = new Headers(request.headers);
    
    // 强行重写 Host，这是反代任意站点的铁律
    headers.set("Host", targetUrl.host);
    if (headers.has("Origin")) headers.set("Origin", targetUrl.origin);
    if (headers.has("Referer")) headers.set("Referer", `${targetUrl.origin}/`);

    // 扒掉所有 Cloudflare 多层代理的外套，防止被目标服务器的 WAF 拦截
    const headersToRemove = ["cf-connecting-ip", "cf-visitor", "cf-ray", "x-forwarded-for", "x-real-ip"];
    headersToRemove.forEach(h => headers.delete(h));

    try {
      // 4. 发起代理请求 (WebSocket 会自动透传)
      const response = await fetch(targetUrl.href, {
        method: request.method,
        headers: headers,
        body: request.body,
        redirect: "manual" // 必须手动接管重定向，防止跳出代理环境
      });

      const responseHeaders = new Headers(response.headers);
      
      // 无脑放行跨域限制
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Headers", "*");

      // 5. 动态重定向重写
      // 目标站如果返回 302 跳转，自动把它替换成带前缀的代理地址
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        let location = responseHeaders.get("Location");
        if (location) {
          const proxyPrefix = `${url.origin}/${targetUrl.protocol.replace(':', '')}://${targetUrl.host}`;
          if (location.startsWith(targetUrl.origin)) {
             responseHeaders.set("Location", location.replace(targetUrl.origin, proxyPrefix));
          } else if (location.startsWith("/")) {
             responseHeaders.set("Location", `${proxyPrefix}${location}`);
          }
        }
      }

      // 6. 核心流媒体优化
      // 识别 Emby 的推流接口，打断 Cloudflare 边缘节点的强制缓存，解决拖动进度条卡死问题
      const pathLower = targetUrl.pathname.toLowerCase();
      if (pathLower.includes('/stream') || pathLower.includes('/playbackinfo') || pathLower.includes('/video')) {
        responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (e) {
      return new Response(`[Proxy Error] 无法连接到目标: ${targetUrlStr}\n报错详情: ${e.message}`, { status: 502 });
    }
  }
};
