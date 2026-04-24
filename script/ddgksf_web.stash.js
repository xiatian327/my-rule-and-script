try {
    let body = $response.body
        .replace(/Lock\s*=\s*\d/g, 'Lock=3')
        .replace(/<\/i>\s*(QuantumultX|Shadowrocket|Surge|qx)/gi, '</i> Stash');

    let injectJS = `
    <script>
        document.addEventListener('click', function(e) {
            let btn = e.target.closest('a');
            if (btn && btn.href) {
                let oldHref = btn.href;
                if (oldHref.includes('shadowrocket://') || oldHref.includes('quantumult-x://') || oldHref.includes('surge://')) {
                    e.preventDefault();
                    
                    let raw = oldHref.replace(/^(shadowrocket:\\/\\/install\\?module=|surge:\\/\\/\\/install-module\\?url=|quantumult-x:\\/\\/\\/add-resource\\?remote-resource=)/i, '');
                    let clean = decodeURIComponent(raw);
                    
                    // 1. 【认错修复】坚决使用 http://，绝不升级 https，防止 SSL 证书报错导致 -1
                    clean = clean.replace(/^https:\\/\\/script\\.hub/i, 'http://script.hub');
                    
                    // 2. 使用你提供的标准参数：target=stash-stoverride
                    clean = clean.replace(/target=[^&]+/gi, 'target=stash-stoverride');
                    
                    // 3. 将文件后缀改为标准的 .stoverride
                    clean = clean.replace(/\\.([a-zA-Z0-9]+)(\\?)/i, '.stoverride$2');
                    
                    // 4. 重新使用 Stash 的一键导入协议，并进行严格的 URL 编码！
                    let finalUrl = 'stash://install-override?url=' + encodeURIComponent(clean);
                    window.location.href = finalUrl;
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
