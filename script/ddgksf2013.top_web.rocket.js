try {
    let body = $response.body
      // 1. 解锁网页
      .replace(/Lock\s*=\s*\d/g, 'Lock=3')
      
      // 2. 视觉修改：界面全换成 Stash
      .replace(/<\/i>\s*(QuantumultX|Shadowrocket|Surge)/gi, '</i> Stash')
      
      // 3. 剥除外壳：直接把各种 App 的唤醒协议删掉（替换为空），暴露出底层的 http://script.hub 直链
      .replace(/shadowrocket:\/\/install\?module=/gi, '')
      .replace(/quantumult-x:\/\/\/add-resource\?remote-resource=/gi, '')
      .replace(/surge:\/\/\/install-module\?url=/gi, '')
      
      // 4. 安全替换目标参数：不解码直接替换目标格式，兼容编码前和编码后的状态
      .replace(/target(=|%3D)(shadowrocket-module|surge-module|qx-rewrite)/gi, 'target$1stash-override')
      .replace(/type(=|%3D)(shadowrocket-module|surge-module|qx-rewrite)/gi, 'type$1stash-override');

    $done({ body });
} catch (err) {
    // 增加一个防崩溃保险：如果万一再报错，至少把网页放行，不影响正常浏览
    console.log("Script Error: " + err);
    $done({});
}