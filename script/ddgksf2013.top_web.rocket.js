let body = $response.body
  // 1. 解锁网页
  .replace(/Lock\s*=\s*\d/g, 'Lock=3')
  
  // 2. 改名字为 Stash
  .replace(/<\/i>\s*(QuantumultX|Shadowrocket|Surge|qx)/gi, '</i> Stash')
  
  // 3. 拦截唤醒协议，并给你的“暴力替换”套上安全外壳
  .replace(/(shadowrocket:\/\/install\?module=|quantumult-x:\/\/\/add-resource\?remote-resource=|surge:\/\/\/install-module\?url=)([^"'>\s]+)/gi, function(match, prefix, rawUrl) {
      
      // 在提取出来的纯净链接上，执行你的暴力替换逻辑
      let safeUrl = rawUrl
          // 强行换成 https
          .replace(/http:\/\/script\.hub/gi, 'https://script.hub')
          .replace(/http%3A%2F%2Fscript\.hub/gi, 'https%3A%2F%2Fscript.hub')
          // 修改转换目标为 stash
          .replace(/target=(shadowrocket-module|surge-module|qx-rewrite)/gi, 'target=stash-override')
          .replace(/target%3D(shadowrocket-module|surge-module|qx-rewrite)/gi, 'target%3Dstash-override')
          .replace(/type=(shadowrocket-module|surge-module|qx-rewrite)/gi, 'type=stash-override')
          .replace(/type%3D(shadowrocket-module|surge-module|qx-rewrite)/gi, 'type%3Dstash-override');

      // 【解决 -1 报错的核心】：
      // 如果这个链接是明文的 (以 https:// 开头)，我们必须用 encodeURIComponent 把它包裹起来
      // 否则 Stash 在解析 stash:// 协议时会因为符号冲突而崩溃报错 -1
      if (safeUrl.startsWith('https://') || safeUrl.startsWith('http://')) {
          safeUrl = encodeURIComponent(safeUrl);
      }

      // 完美拼接，执行自动跳转
      return 'stash://install-override?url=' + safeUrl;
  });

$done({ body });