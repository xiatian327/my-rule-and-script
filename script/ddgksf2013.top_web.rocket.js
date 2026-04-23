let body = $response.body
  // 1. 解锁隐藏内容
  .replace(/Lock\s*=\s*\d/g, 'Lock=3')
  
  // 2. 视觉修改：把 QX、小火箭、Surge 字眼全换成 Stash
  .replace(/<\/i>\s*(QuantumultX|Shadowrocket|Surge)/gi, '</i> Stash')
  
  // 3. 协议通杀替换：把这三家的唤醒协议，全部替换成 Stash 的导入协议
  .replace(/(quantumult-x:\/\/\/add-resource\?remote-resource=|shadowrocket:\/\/install\?module=|surge:\/\/\/install-module\?url=)/gi, 'stash://install-override?url=')
  
  // 4. 转换目标替换：强制告诉 Script Hub 输出 stash-override 格式
  .replace(/target(%3D|=)(shadowrocket-module|surge-module|qx-rewrite)/gi, 'target$1stash-override');

$done({ body });