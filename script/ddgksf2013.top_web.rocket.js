let body = $response.body
  // 1. 解锁网页
  .replace(/Lock\s*=\s*\d/g, 'Lock=3')
  
  // 2. 改名字为 Stash
  .replace(/<\/i>\s*(QuantumultX|Shadowrocket|Surge)/gi, '</i> Stash')
  
  // 3. 暴力替换所有唤醒协议为 Stash
  .replace(/shadowrocket:\/\/install\?module=/gi, 'stash://install-override?url=')
  .replace(/quantumult-x:\/\/\/add-resource\?remote-resource=/gi, 'stash://install-override?url=')
  .replace(/surge:\/\/\/install-module\?url=/gi, 'stash://install-override?url=')
  
  // 4. 暴力修复 -1 报错：把 http 强行换成 https (兼容明文和被转义两种情况)
  .replace(/http:\/\/script\.hub/gi, 'https://script.hub')
  .replace(/http%3A%2F%2Fscript\.hub/gi, 'https%3A%2F%2Fscript.hub')
  
  // 5. 暴力修改 Script Hub 的转换目标为 stash-override (兼容明文和被转义两种情况)
  .replace(/target=(shadowrocket-module|surge-module|qx-rewrite)/gi, 'target=stash-override')
  .replace(/target%3D(shadowrocket-module|surge-module|qx-rewrite)/gi, 'target%3Dstash-override');

$done({ body });