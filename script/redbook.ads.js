/**
 * 小红书去广告/去水印脚本 (推导版)
 * 适配路径: tabfeed, homefeed, search, splash, save_video 等
 */

// 1. 获取原始响应体并转为 JSON 对象
let obj = JSON.parse($response.body);
let url = $request.url;

if (!obj || !obj.data) {
    $done({}); // 如果没有数据，直接返回
}

// --- 逻辑分发 ---

// 2. 处理首页信息流和搜索结果中的广告 (homefeed, tabfeed, search)
if (url.includes("/api/sns/v1/homefeed") || 
    url.includes("/api/sns/v1/note/tabfeed") || 
    url.includes("/api/sns/v1/search/notes")) {
    
    if (Array.isArray(obj.data)) {
        // 过滤包含广告标识的卡片
        obj.data = obj.data.filter(item => {
            return !item.is_ads && !item.ads_info && !item.ads_type;
        });
    } else if (obj.data.items) {
        // 针对部分搜索接口的 items 结构
        obj.data.items = obj.data.items.filter(item => {
            return !item.is_ads && !item.ads_info;
        });
    }
}

// 3. 处理开屏配置和系统配置 (splash_config, config)
if (url.includes("/system_service/splash_config") || url.includes("/system_service/config")) {
    if (obj.data.ads_groups) obj.data.ads_groups = []; // 清空广告组
    if (obj.data.splash) {
        obj.data.splash.timeout = 0; // 启动页超时设为0
        obj.data.splash.ads_list = []; // 清空启动广告列表
    }
}

// 4. 处理无水印下载权限 (video/save, live_photo/save)
if (url.includes("/note/video/save") || url.includes("/note/live_photo/save")) {
    // 强制开启下载权限，有些版本通过修改 can_download 或 watermark 字段
    if (obj.data.video_info) {
        obj.data.video_info.watermark = false; // 关闭视频水印标识
    }
    obj.data.can_download = true; // 开启允许下载
}

// 5. 处理搜索栏的热搜和提示词 (search/hot_list, search/hint)
if (url.includes("/search/hot_list") || url.includes("/search/trending")) {
    if (obj.data.items) {
        // 过滤掉带“广告”标签的热搜
        obj.data.items = obj.data.items.filter(item => !item.is_ads);
    }
}

// 6. 处理首页分类标签 (homefeed/categories)
if (url.includes("/homefeed/categories")) {
    if (obj.data.categories) {
        // 过滤掉“购物”、“周边”等推广类目
        obj.data.categories = obj.data.categories.filter(cat => 
            cat.name !== "购物" && cat.name !== "直播"
        );
    }
}

// --- 结束并返回修改后的数据 ---
$done({ body: JSON.stringify(obj) });