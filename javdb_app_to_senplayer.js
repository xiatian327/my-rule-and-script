let body = (typeof $response !== "undefined" && $response.body) ? $response.body : "";

if (!body) {
    $done({});
} else {
    // 提取 body 中所有的番号 (加了 g 标志进行全局匹配)
    let idRegGlobal = /([a-zA-Z]{2,6}-\d{3,5})/gi;
    let allMatches = body.match(idRegGlobal);

    if (allMatches && allMatches.length > 0) {
        // 转小写并去重，统计这个数据包里有多少个【不同】的番号
        let uniqueCodes = new Set(allMatches.map(c => c.toLowerCase()));
        
        // 🌟 核心防误弹逻辑 🌟
        // 如果包含超过 5 个不同的番号，说明这绝对是首页的推荐列表或排行榜，直接跳过！
        if (uniqueCodes.size > 5) {
            // console.log(`[JavDB-SenPlayer] 识别为列表页 (包含 ${uniqueCodes.size} 个番号)，跳过执行。`);
            $done({ body });
        } else {
            // 如果是详情页，通常只有当前影片的主番号（偶尔带一两个关联番号）
            // 我们取第一个匹配到的作为目标番号
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
                // 写入锁定时间
                if (typeof $persistentStore !== "undefined") {
                    $persistentStore.write(now.toString(), cacheKey);
                }
                
                console.log(`\n[JavDB-SenPlayer] 🔍 确认进入详情页，开始搜索番号: ${code.toUpperCase()}`);
                runJableSearch(code);
            }
        }
    } else {
        // 没找到番号，直接放行
        $done({ body });
    }
}

// ==========================================
// 独立函数 1：请求 Jable 原番号
// ==========================================
function runJableSearch(code) {
    let jableUrl = `https://jable.tv/videos/${code}/`;
    $httpClient.get({
        url: jableUrl,
        headers: getFakeHeaders()
    }, function(error, response, data) {
        let foundM3u8 = false;
        
        if (!error && response && response.status === 200) {
            let m3u8Reg = /https?:\/\/[^"'\s<>]+\.m3u8/i;
            let m3u8Match = data ? data.match(m3u8Reg) : null;
            if (m3u8Match) {
                foundM3u8 = true;
                handleSuccess(code, m3u8Match[0], "Jable");
            }
        }
        
        if (!foundM3u8) {
            console.log(`[JavDB-SenPlayer] ⚠️ Jable 原番号未找到，尝试带 -c 后缀...`);
            runJableCSearch(code);
        }
    });
}

// ==========================================
// 独立函数 2：请求 Jable -c 后缀
// ==========================================
function runJableCSearch(code) {
    let jableUrlC = `https://jable.tv/videos/${code}-c/`;
    $httpClient.get({
        url: jableUrlC,
        headers: getFakeHeaders()
    }, function(error, response, data) {
        let foundM3u8 = false;
        
        if (!error && response && response.status === 200) {
            let m3u8Reg = /https?:\/\/[^"'\s<>]+\.m3u8/i;
            let m3u8Match = data ? data.match(m3u8Reg) : null;
            if (m3u8Match) {
                foundM3u8 = true;
                handleSuccess(code, m3u8Match[0], "Jable");
            }
        }
        
        if (!foundM3u8) {
            console.log(`[JavDB-SenPlayer] ❌ Jable 原番号及 -c 后缀均未找到，解析结束。`);
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
function handleSuccess(code, m3u8, source) {
    console.log(`\n==================================`);
    console.log(`🎯 [成功获取 M3U8] 数据源: ${source}`);
    console.log(`🔗 播放链接: ${m3u8}`);
    console.log(`==================================\n`);
    
    let shortcutUrl = `shortcuts://run-shortcut?name=JavPlay&input=text&text=${encodeURIComponent(m3u8)}`;
    let title = `▶ 解析成功 (${source}): ${code.toUpperCase()}`;
    let subtitle = `已找到串流链接并记录至日志`;
    let content = `👇 点击弹窗立即拉起 SenPlayer`;

    if (typeof $environment !== 'undefined' && $environment['stash-version']) {
        $notification.post(title, subtitle, content, { url: shortcutUrl });
    } else {
        $notification.post(title, subtitle, content, shortcutUrl);
    }
    
    $done({ body });
}