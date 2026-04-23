let body = $response.body
  // 1. 保留核心：强制解锁网页隐藏内容
  .replace(/Lock\s*=\s*\d/g, 'Lock=3')
  
  // 2. 视觉修改：把界面上的按钮文字改成 Stash
  .replace(/<\/i>\s*(QuantumultX|Shadowrocket)/gi, '</i> Stash')
  
  // 3. 协议替换：把小火箭的唤醒协议改成 Stash 的覆写导入协议
  .replace(/shadowrocket:\/\/install\?module=/gi, 'stash://install-override?url=')
  
  // 4. 目标替换：告诉 Script Hub，我们需要转换成 stash-override 格式，而不是小火箭格式
  .replace(/target(%3D|=)shadowrocket-module/gi, 'target$1stash-override')
  .replace(/target(%3D|=)surge-module/gi, 'target$1stash-override');

$done({ body });