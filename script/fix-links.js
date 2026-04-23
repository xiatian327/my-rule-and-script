try {
    let body = $response.body;
    
    // 暴力替换 ddgksf2013.top/scripts/ 为真实的 GitHub raw 直链
    // 这样 Stash 拿到配置文件时，直接去真实的地址下载，完美避开重定向失败！
    body = body.replace(/https?:\/\/ddgksf2013\.top\/scripts\//gi, 'https://raw.githubusercontent.com/ddgksf2013/Scripts/master/');
    
    // （预留位置）如果你以后发现还有其他博主的链接也有重定向问题，可以直接在这里继续往下复制加 .replace
    // body = body.replace(/旧的重定向域名/gi, '真实直链域名');

    $done({ body });
} catch (err) {
    console.log("Fix Links Error: " + err);
    $done({});
}
