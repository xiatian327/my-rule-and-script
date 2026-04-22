let body = (typeof $response !== "undefined" && $response.body) ? $response.body : "";

if (!body) {
    $done({});
} else {
    // 提取 body 中所有的番号 (加了 g 标志进行全局匹配)
    let idRegGlobal = /([a-zA-Z]{2,6}-\d{3,5})/gi;
    let allMatches = body.match(idRegGlobal);

    if (allMatches && allMatches.length > 0) {
        // 转小写并去重，统计数据包里有多少个不同的番号
        let uniqueCodes = new Set(allMatches.map(c => c.toLowerCase()));
        
        // 核心防误弹逻辑：包含超过 5 个说明是列表页，跳过
        if (uniqueCodes.size > 5) {
            $done({ body });
        } else {
            let code = allMatches[0].toLowerCase();
            
            // --- Stash 10秒防并发锁 ---
            let cacheKey = "javdb_stash_lock_" + code;
            let now = Date.now();
            let lastTime = 0;

            if (typeof $persistentStore !== "undefined") {
                let cacheStr = $persistentStore.read(cacheKey);
                if (cacheStr) lastTime = parseInt(cacheStr);
            }

            if (now - lastTime < 10000) {
                console.log(`\n[JavDB-SenPlayer] ♻️ Stash 防抖拦截: 10秒内重复请求了 ${code.toUpperCase()}`);
                $done({ body });
            } else {
                if (typeof $persistentStore !== "undefined") {
                    $persistentStore.write(now.toString(), cacheKey);
                }
                
                console.log(`\n[JavDB-SenPlayer] 🔍 开始搜索番号: ${code.toUpperCase()}`);
                runJableSearch(code);
            }
        }
    } else {
        $done({ body });
    }
}

// ==========================================
// 1. 请求 Jable 原番号
// ==========================================
function runJableSearch(code) {
    let url = `https://jable.tv/videos/${code}/`;
    $httpClient.get({
        url: url,
        headers: getFakeHeaders()
    }, function(error, response, data) {
        if (!error && response && response.status === 200) {
            handleSuccess(code, url, "Jable");
        } else {
            console.log(`[JavDB-SenPlayer] ⚠️ Jable 未找到，尝试带 -c 后缀...`);
            runJableCSearch(code);
        }
    });
}

// ==========================================
// 2. 请求 Jable 带 -c 后缀
// ==========================================
function runJableCSearch(code) {
    let url = `https://jable.tv/videos/${code}-c/`;
    $httpClient.get({
        url: url,
        headers: getFakeHeaders()
    }, function(error, response, data) {
        if (!error && response && response.status === 200) {
            handleSuccess(code, url, "Jable (-c)");
        } else {
            console.log(`[JavDB-SenPlayer] ⚠️ Jable 均未找到，进入 MissAV...`);
            runMissAVSearch(code);
        }
    });
}

// ==========================================
// 3. 请求 MissAV (主线 missav.ai/cn)
// ==========================================
function runMissAVSearch(code) {
    let url = `https://missav.ai/cn/${code}/`;
    $httpClient.get({
        url: url,
        headers: getFakeHeaders()
    }, function(error, response, data) {
        if (!error && response && response.status === 200) {
            handleSuccess(code, url, "MissAV");
        } else {
            console.log(`[JavDB-SenPlayer] ⚠️ MissAV 主线未找到，尝试 MissAV 备用节点...`);
            runMissAV123Search(code);
        }
    });
}

// ==========================================
// 4. 请求 MissAV 备用线路 (missav123.com)
// ==========================================
function runMissAV123Search(code) {
    // 根据参考脚本，此节点无需 /cn/ 路径
    let url = `https://missav123.com/${code}/`;
    $httpClient.get({
        url: url,
        headers: getFakeHeaders()
    }, function(error, response, data) {
        if (!error && response && response.status === 200) {
            handleSuccess(code, url, "MissAV (备用节点)");
        } else {
            console.log(`[JavDB-SenPlayer] ❌ 所有线路 (Jable & MissAV) 均未找到页面，解析结束。`);
            $done({ body });
        }
    });
}

// ==========================================
// 伪装请求头
// ==========================================
function getFakeHeaders() {
    return {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh-Hans;q=0.9",
        "Connection": "keep-alive"
    };
}

// ==========================================
// 提取成功后的处理函数
// ==========================================
function handleSuccess(code, pageUrl, source) {
    console.log(`\n==================================`);
    console.log(`🎯 [成功获取播放页] 数据源: ${source}`);
    console.log(`🔗 播放链接: ${pageUrl}`);
    console.log(`==================================\n`);
    
    let shortcutUrl = `shortcuts://run-shortcut?name=JavPlay&input=text&text=${encodeURIComponent(pageUrl)}`;
    let title = `▶ 解析成功 (${source}): ${code.toUpperCase()}`;
    let subtitle = `已找到播放网页并记录至日志`;
    let content = `👇 点击弹窗立即跳转网页`;

    if (typeof $environment !== 'undefined' && $environment['stash-version']) {
        $notification.post(title, subtitle, content, { url: shortcutUrl });
    } else {
        $notification.post(title, subtitle, content, shortcutUrl);
    }
    
    $done({ body });
}