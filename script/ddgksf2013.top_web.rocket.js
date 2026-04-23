let body = $response.body
  // 1. 保留核心：解锁网页隐藏内容
  .replace(/Lock\s*=\s*\d/g, 'Lock=3')
  
  // 2. 视觉修改：界面全换成 Stash
  .replace(/<\/i>\s*(QuantumultX|Shadowrocket|Surge)/gi, '</i> Stash')
  
  // 3. 拦截协议，并动态处理链接
  .replace(/(quantumult-x:\/\/\/add-resource\?remote-resource=|shadowrocket:\/\/install\?module=|surge:\/\/\/install-module\?url=)([^"'>\s]+)/gi, function(match, prefix, rawUrl) {
      
      // 步骤 A：把原链接解码（原链接里可能带有 %3D 等乱七八糟的编码，先解开）
      let safeUrl = decodeURIComponent(rawUrl);
      
      // 步骤 B：强制升级为 HTTPS，避开 iOS 的 HTTP 拦截报错 -1
      safeUrl = safeUrl.replace(/^http:\/\//i, 'https://');
      
      // 步骤 C：将 Script Hub 的转换目标精准修改为 Stash
      safeUrl = safeUrl.replace(/target=(shadowrocket-module|surge-module|qx-rewrite)/gi, 'target=stash-override');
      
      // 步骤 D：重新进行严格的 URL 编码，并拼接 Stash 协议
      return 'stash://install-override?url=' + encodeURIComponent(safeUrl);
  });

$done({ body });