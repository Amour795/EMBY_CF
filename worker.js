export default {
  async fetch(request, env, ctx) {
    const TARGET_HOST = "v1.uhdnow.com";
    const url = new URL(request.url);
    
    // 强制修改 URL 目标
    url.hostname = TARGET_HOST;
    url.protocol = "https:";
    url.port = ""; 

    // 重新构造请求，剔除掉可能引起源站报错的 Header
    const headers = new Headers(request.headers);
    headers.set("Host", TARGET_HOST);
    headers.set("Referer", `https://${TARGET_HOST}/`);
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    const newRequest = new Request(url.toString(), {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: "follow"
    });

    try {
      let response = await fetch(newRequest);
      
      // 处理源站重定向
      if ([301, 302].includes(response.status)) {
        const location = response.headers.get("Location");
        if (location) {
          const newLocation = location.replace(`https://${TARGET_HOST}`, `https://${new URL(request.url).hostname}`);
          return Response.redirect(newLocation, response.status);
        }
      }
      return response;
    } catch (e) {
      return new Response(`Worker 连不上 UHD: ${e.message}`, { status: 502 });
    }
  }
};
