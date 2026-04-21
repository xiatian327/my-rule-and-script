// 2026/04/16
/*
@Name：PingMe 自动化签到+视频奖励 (Stash async 重构版)
*/

const scriptName = 'PingMe';
const ckKey = 'pingme_capture_v3';
const SECRET = '0fOiukQq7jXZV2GRi9LGlO';
const MAX_VIDEO = 5;
const VIDEO_DELAY = 8000;

// ================= 1. MD5 及工具函数 (保持不变) =================
function MD5(string) {
  function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
  function AddUnsigned(lX, lY) {
    const lX4 = lX & 0x40000000, lY4 = lY & 0x40000000, lX8 = lX & 0x80000000, lY8 = lY & 0x80000000;
    const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) return (lResult & 0x40000000) ? (lResult ^ 0xC0000000 ^ lX8 ^ lY8) : (lResult ^ 0x40000000 ^ lX8 ^ lY8);
    return lResult ^ lX8 ^ lY8;
  }
  function F(x, y, z) { return (x & y) | ((~x) & z); }
  function G(x, y, z) { return (x & z) | (y & (~z)); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | (~z)); }
  function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function ConvertToWordArray(str) {
    const lMessageLength = str.length;
    const lNumberOfWords_temp1 = lMessageLength + 8;
    const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    const lWordArray = Array(lNumberOfWords - 1).fill(0);
    let lBytePosition = 0, lByteCount = 0;
    while (lByteCount < lMessageLength) {
      const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] |= str.charCodeAt(lByteCount) << lBytePosition;
      lByteCount++;
    }
    const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] |= 0x80 << lBytePosition;
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function WordToHex(lValue) {
    let WordToHexValue = '';
    for (let lCount = 0; lCount <= 3; lCount++) {
      const lByte = (lValue >>> (lCount * 8)) & 255;
      const WordToHexValue_temp = '0' + lByte.toString(16);
      WordToHexValue += WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
    }
    return WordToHexValue;
  }
  const x = ConvertToWordArray(string);
  let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22, S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23, S41 = 6, S42 = 10, S43 = 15, S44 = 21;
  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = FF(a,b,c,d,x[k+0],S11,0xD76AA478); d = FF(d,a,b,c,x[k+1],S12,0xE8C7B756); c = FF(c,d,a,b,x[k+2],S13,0x242070DB); b = FF(b,c,d,a,x[k+3],S14,0xC1BDCEEE);
    a = FF(a,b,c,d,x[k+4],S11,0xF57C0FAF); d = FF(d,a,b,c,x[k+5],S12,0x4787C62A); c = FF(c,d,a,b,x[k+6],S13,0xA8304613); b = FF(b,c,d,a,x[k+7],S14,0xFD469501);
    a = FF(a,b,c,d,x[k+8],S11,0x698098D8); d = FF(d,a,b,c,x[k+9],S12,0x8B44F7AF); c = FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1); b = FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
    a = FF(a,b,c,d,x[k+12],S11,0x6B901122); d = FF(d,a,b,c,x[k+13],S12,0xFD987193); c = FF(c,d,a,b,x[k+14],S13,0xA679438E); b = FF(b,c,d,a,x[k+15],S14,0x49B40821);
    a = GG(a,b,c,d,x[k+1],S21,0xF61E2562); d = GG(d,a,b,c,x[k+6],S22,0xC040B340); c = GG(c,d,a,b,x[k+11],S23,0x265E5A51); b = GG(b,c,d,a,x[k+0],S24,0xE9B6C7AA);
    a = GG(a,b,c,d,x[k+5],S21,0xD62F105D); d = GG(d,a,b,c,x[k+10],S22,0x02441453); c = GG(c,d,a,b,x[k+15],S23,0xD8A1E681); b = GG(b,c,d,a,x[k+4],S24,0xE7D3FBC8);
    a = GG(a,b,c,d,x[k+9],S21,0x21E1CDE6); d = GG(d,a,b,c,x[k+14],S22,0xC33707D6); c = GG(c,d,a,b,x[k+3],S23,0xF4D50D87); b = GG(b,c,d,a,x[k+8],S24,0x455A14ED);
    a = GG(a,b,c,d,x[k+13],S21,0xA9E3E905); d = GG(d,a,b,c,x[k+2],S22,0xFCEFA3F8); c = GG(c,d,a,b,x[k+7],S23,0x676F02D9); b = GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
    a = HH(a,b,c,d,x[k+5],S31,0xFFFA3942); d = HH(d,a,b,c,x[k+8],S32,0x8771F681); c = HH(c,d,a,b,x[k+11],S33,0x6D9D6122); b = HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
    a = HH(a,b,c,d,x[k+1],S31,0xA4BEEA44); d = HH(d,a,b,c,x[k+4],S32,0x4BDECFA9); c = HH(c,d,a,b,x[k+7],S33,0xF6BB4B60); b = HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
    a = HH(a,b,c,d,x[k+13],S31,0x289B7EC6); d = HH(d,a,b,c,x[k+0],S32,0xEAA127FA); c = HH(c,d,a,b,x[k+3],S33,0xD4EF3085); b = HH(b,c,d,a,x[k+6],S34,0x04881D05);
    a = HH(a,b,c,d,x[k+9],S31,0xD9D4D039); d = HH(d,a,b,c,x[k+12],S32,0xE6DB99E5); c = HH(c,d,a,b,x[k+15],S33,0x1FA27CF8); b = HH(b,c,d,a,x[k+2],S34,0xC4AC5665);
    a = II(a,b,c,d,x[k+0],S41,0xF4292244); d = II(d,a,b,c,x[k+7],S42,0x432AFF97); c = II(c,d,a,b,x[k+14],S43,0xAB9423A7); b = II(b,c,d,a,x[k+5],S44,0xFC93A039);
    a = II(a,b,c,d,x[k+12],S41,0x655B59C3); d = II(d,a,b,c,x[k+3],S42,0x8F0CCC92); c = II(c,d,a,b,x[k+10],S43,0xFFEFF47D); b = II(b,c,d,a,x[k+1],S44,0x85845DD1);
    a = II(a,b,c,d,x[k+8],S41,0x6FA87E4F); d = II(d,a,b,c,x[k+15],S42,0xFE2CE6E0); c = II(c,d,a,b,x[k+6],S43,0xA3014314); b = II(b,c,d,a,x[k+13],S44,0x4E0811A1);
    a = II(a,b,c,d,x[k+4],S41,0xF7537E82); d = II(d,a,b,c,x[k+11],S42,0xBD3AF235); c = II(c,d,a,b,x[k+2],S43,0x2AD7D2BB); b = II(b,c,d,a,x[k+9],S44,0xEB86D391);
    a = AddUnsigned(a,AA); b = AddUnsigned(b,BB); c = AddUnsigned(c,CC); d = AddUnsigned(d,DD);
  }
  return (WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d)).toLowerCase();
}

function getUTCSignDate() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}

function parseRawQuery(url) {
  const query = (url.split('?')[1] || '').split('#')[0];
  const rawMap = {};
  query.split('&').forEach(pair => {
    if (!pair) return;
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    rawMap[pair.slice(0, idx)] = pair.slice(idx + 1);
  });
  return rawMap;
}

function buildSignedParamsRaw(captureObj) {
  const params = {};
  Object.keys(captureObj.paramsRaw || {}).forEach(k => {
    if (k !== 'sign' && k !== 'signDate') params[k] = captureObj.paramsRaw[k];
  });
  params.signDate = getUTCSignDate();
  const signBase = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  params.sign = MD5(signBase + SECRET);
  return params;
}

function buildUrl(path, captureObj) {
  const params = buildSignedParamsRaw(captureObj);
  const qs = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  return `https://api.pingmeapp.net/app/${path}?${qs}`;
}

function buildHeaders(captureObj) {
  const headers = {};
  Object.keys(captureObj.headers || {}).forEach(k => headers[k] = captureObj.headers[k]);
  delete headers['Content-Length']; delete headers['content-length'];
  delete headers[':authority']; delete headers[':method']; delete headers[':path']; delete headers[':scheme'];
  headers['Host'] = 'api.pingmeapp.net';
  headers['Accept'] = headers['Accept'] || 'application/json';
  return headers;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ================= 2. 核心异步执行逻辑 =================
(async function() {
    // [模式A] 抓包模式：如果是通过请求进来的
    if (typeof $request !== 'undefined' && $request && $request.url) {
        let reqCapture = {
            url: $request.url,
            paramsRaw: parseRawQuery($request.url),
            headers: $request.headers || {}
        };
        $persistentStore.write(JSON.stringify(reqCapture), ckKey);
        
        if (typeof $notification !== 'undefined') {
            $notification.post(scriptName, "✅ 参数抓取成功", "已保存请求头+参数\n请前往首页运行磁贴");
        }
        console.log(`【${scriptName}】抓取成功:\n${JSON.stringify(reqCapture, null, 2)}`);
        $done({});
        return;
    }

    // [模式B] 任务模式：磁贴点击或 Cron 触发
    let raw = $persistentStore.read(ckKey);
    if (!raw) {
        $done({ title: "PingMe 签到", content: "⚠️ 暂无数据，请打开App抓取", icon: "exclamationmark.triangle", backgroundColor: "#FF9500" });
        return;
    }

    let captureObj;
    try { 
        captureObj = JSON.parse(raw); 
    } catch (e) {
        $done({ title: "PingMe 签到", content: "⚠️ 参数损坏，请重新抓取", icon: "xmark.octagon", backgroundColor: "#FF3B30" });
        return;
    }

    let headers = buildHeaders(captureObj);
    let msgs = [];
    let finalBalance = "?";
    let checkInStatus = "获取中";
    let videoEarned = 0;

    // 网络请求封装器
    function fetchApi(path) {
        return new Promise((resolve, reject) => {
            $httpClient.get({
                url: buildUrl(path, captureObj),
                headers: headers
            }, (error, response, data) => {
                if (error) reject(error);
                else resolve(data);
            });
        });
    }

    // ==== 核心业务流水线 ====
    try {
        // 1. 查询初始余额
        let res1 = await fetchApi('queryBalanceAndBonus');
        let d1 = JSON.parse(res1);
        if (d1.retcode === 0) msgs.push(`💰 初始：${d1.result.balance} Coins`);
        else msgs.push(`⚠️ 查询：${d1.retmsg}`);

        // 2. 每日签到
        let res2 = await fetchApi('checkIn');
        let d2 = JSON.parse(res2);
        if (d2.retcode === 0) {
            let hint = (d2.result?.bonusHint || d2.retmsg || '').replace(/\n/g, ' ');
            msgs.push(`✅ 签到：${hint}`);
            checkInStatus = "成功";
        } else {
            msgs.push(`⚠️ 签到：${d2.retmsg}`);
            checkInStatus = "重复或失败";
        }

        // 3. 循环看视频任务
        for (let i = 1; i <= MAX_VIDEO; i++) {
            await sleep(i === 1 ? 1500 : VIDEO_DELAY); // 第一个等短点，后续严格遵守延迟
            try {
                let vRes = await fetchApi('videoBonus');
                let vD = JSON.parse(vRes);
                if (vD.retcode === 0) {
                    msgs.push(`🎬 视频${i}：+${vD.result?.bonus || '?'} Coins`);
                    videoEarned++;
                } else {
                    msgs.push(`⏸ 视频${i}：${vD.retmsg}`);
                    // 遇到上限提前退出循环
                    break;
                }
            } catch (err) {
                msgs.push(`❌ 视频${i}：请求异常`);
            }
        }

        // 4. 查询最新余额
        let res3 = await fetchApi('queryBalanceAndBonus');
        let d3 = JSON.parse(res3);
        if (d3.retcode === 0) {
            finalBalance = d3.result.balance;
            msgs.push(`💰 最新：${d3.result.balance} Coins`);
        }

        // 5. 格式化输出 (给面板与日志使用)
        let logText = `======== PingMe 签到结果 ========\n${msgs.join("\n")}\n=================================`;
        console.log(logText);

        if (typeof $notification !== 'undefined') {
            $notification.post(`${scriptName} 🎉 运行结束`, `余额: ${finalBalance} Coins`, msgs.join('\n'));
        }

        let tileText = `签到: ${checkInStatus}\n`;
        if(videoEarned > 0) tileText += `视频: ${videoEarned}次奖励\n`;
        tileText += `余额: ${finalBalance}`;

        // 完美结束，涂抹绿色！
        $done({
            title: "PingMe 签到", 
            content: tileText.trim(),
            icon: "gift.fill",
            backgroundColor: "#34C759" 
        });

    } catch (fatalError) {
        // 全局致命错误捕获
        let errMsg = "执行发生异常: " + String(fatalError);
        console.log(`${scriptName} ❌ 崩溃:\n` + errMsg);
        
        if (typeof $notification !== 'undefined') {
            $notification.post(`${scriptName} ❌ 失败`, "", errMsg);
        }
        
        // 异常结束，涂抹红色！
        $done({ 
            title: "PingMe 签到", 
            content: "网络连接超时或中断", 
            icon: "xmark.octagon", 
            backgroundColor: "#FF3B30" 
        });
    }
})();
