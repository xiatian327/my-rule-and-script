let body = $response.body
  // 1. 解锁网页
  .replace(/Lock\s*=\s*\d/g, 'Lock=3')
  
  // 2. 视觉修改
  .replace(/<\/i>\s*(QuantumultX|Shadowrocket|Surge)/gi, '</i> Stash')
  
  // 3. 剥离小火箭/QX的外壳，直接提取真实的 Script Hub 链接让浏览器打开
  .replace(/(shadowrocket:\/\/install\?module=|quantumult-x:\/\/\/add-resource\?remote-resource=|surge:\/\/\/install-module\?url=)([^"'>\s]+)/gi, function(match, prefix, rawUrl) {
      
      // 把被编码过的链接解开，还原成 http://script.hub... 的正常样式
      let decodedUrl = decodeURIComponent(rawUrl);
      
      // 把链接里的 qx/surge 目标，精准替换为 stash-override
      decodedUrl = decodedUrl.replace(/(target|type)=(shadowrocket-module|surge-module|qx-rewrite)/gi, '$1=stash-override');
      
      // 【关键】直接返回普通网址，不再套用 stash:// 协议！
      return decodedUrl;
  });

$done({ body });