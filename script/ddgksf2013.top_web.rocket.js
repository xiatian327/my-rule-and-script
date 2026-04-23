try {
    let body = $response.body
        // 1. 纯文本修改：解锁网页并把名字改为 Stash（极其安全，绝对不崩溃）
        .replace(/Lock\s*=\s*\d/g, 'Lock=3')
        .replace(/<\/i>\s*(QuantumultX|Shadowrocket|Surge|qx)/gi, '</i> Stash');

    // 2. 注入隐形前端脚本：让 Safari 在你点击的瞬间完成完美的 URL 编码
    let injectJS = `
    <script>
        document.addEventListener('click', function(e) {
            let btn = e.target.closest('a');
            if (btn && btn.href) {
                let oldHref = btn.href;
                // 侦测到点击了小火箭或QX的链接
                if (oldHref.includes('shadowrocket://') || oldHref.includes('quantumult-x://') || oldHref.includes('surge://')) {
                    e.preventDefault(); // 拦截原本的跳转
                    
                    // 提取最核心的直链
                    let raw = oldHref.replace(/^(shadowrocket:\\/\\/install\\?module=|surge:\\/\\/\\/install-module\\?url=|quantumult-x:\\/\\/\\/add-resource\\?remote-resource=)/i, '');
                    
                    // 统一解开乱码，替换目标为 stash，并升级为 https
                    let clean = decodeURIComponent(raw);
                    clean = clean.replace(/http:\\/\\/script\\.hub/gi, 'https://script.hub');
                    clean = clean.replace(/(target|type)=(shadowrocket-module|surge-module|qx-rewrite)/gi, '$1=stash-override');
                    
                    // 交给 Safari 执行最严格的终极编码，完美唤醒 Stash，彻底消灭 -1 报错！
                    window.location.href = 'stash://install-override?url=' + encodeURIComponent(clean);
                }
            }
        }, true);
    </script>
    `;

    // 将脚本追加到网页末尾
    body = body + injectJS;
    $done({ body });

} catch (err) {
    // 终极保险：遇到任何意外直接放行网页，不影响浏览
    $done({});
}