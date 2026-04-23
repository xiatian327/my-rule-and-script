// 提取用户输入的需要解密的链接
let targetUrl = decodeURIComponent($request.url.substring($request.url.indexOf("?url=") + 5));

$httpClient.get({
    url: targetUrl,
    headers: { 
        "User-Agent": "Surge/1943" // 完美伪装身份，骗过防盗链安检
    },
    "auto-redirect": false, // 【核心】禁止自动跳转，我们要的就是它的跳转目标！
    autoRedirect: false
}, function(err, resp, data) {
    let loc = "";
    if (resp && resp.headers) {
        // 抓取真实的 302 重定向地址
        loc = resp.headers.Location || resp.headers.location || resp.headers.LOCATION;
    }
    
    // 输出一个美观的前端页面展示给 Safari
    let html = `
    <!DOCTYPE html>
    <html lang="zh">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>墨鱼直链解密器</title>
        <style>
            body { font-family: -apple-system, sans-serif; padding: 20px; background: #f9f9f9; }
            .container { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            .url-box { margin-top: 15px; padding: 15px; background: #e8f0fe; border-radius: 8px; word-break: break-all; color: #1a73e8; font-weight: bold; }
            .error { background: #ffebee; color: #c62828; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>🕵️ 真实直链解密器</h2>
            <p style="color: #666; font-size: 14px;">目标: ${targetUrl}</p>
            <div class="url-box ${loc ? '' : 'error'}">
                ${loc ? loc : '解析失败：未检测到重定向 (可能脚本已被作者彻底删除)'}
            </div>
            <p style="margin-top: 20px; font-size: 14px; color: #555;">👉 长按上方链接复制，去 Stash 的覆写文件里替换吧！</p>
        </div>
    </body>
    </html>
    `;
    
    // 直接向浏览器返回生成的页面
    $done({
        response: {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
            body: html
        }
    });
});
