try {
    let body = $response.body
        // 1. 解锁网页并改名
        .replace(/Lock\s*=\s*\d/g, 'Lock=3')
        .replace(/<\/i>\s*(QuantumultX|Shadowrocket|Surge|qx)/gi, '</i> Stash');

    // 2. 注入隐形脚本：拦截点击，交给 Safari 处理
    let injectJS = `
    <script>
        document.addEventListener('click', function(e) {
            let btn = e.target.closest('a');
            if (btn && btn.href) {
                let oldHref = btn.href;
                if (oldHref.includes('shadowrocket://') || oldHref.includes('quantumult-x://') || oldHref.includes('surge://')) {
                    e.preventDefault(); // 拦截跳转
                    
                    // 剥离外壳
                    let raw = oldHref.replace(/^(shadowrocket:\\/\\/install\\?module=|surge:\\/\\/\\/install-module\\?url=|quantumult-x:\\/\\/\\/add-resource\\?remote-resource=)/i, '');
                    
                    // 还原直链并修改为 stash 格式
                    let clean = decodeURIComponent(raw);
                    clean = clean.replace(/http:\\/\\/script\\.hub/gi, 'https://script.hub');
                    clean = clean.replace(/(target|type)=(shadowrocket-module|surge-module|qx-rewrite)/gi, '$1=stash-override');
                    
                    // 【关键改变】不唤醒 Stash，直接让 Safari 打开这个链接！
                    // Safari 的流量经过代理，会被 MITM 瞬间截获并转换为文件
                    window.location.href = clean;
                }
            }
        }, true);
    </script>
    `;

    body = body + injectJS;
    $done({ body });

} catch (err) {
    $done({});
}