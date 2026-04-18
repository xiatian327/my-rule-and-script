
/**
 * OpenList Download Proxy + Web Admin Panel + Stats + Telegram Summary (v16)
 *
 * Required bindings:
 * - DB: D1 database
 * - PANEL_PASSWORD: secret text, admin login password
 * - APP_SECRET: secret text, used for admin cookie signing and token encryption
 *
 * Optional bindings:
 * - TG_BOT_TOKEN: secret text, Telegram bot token
 * - TG_CHAT_ID: plain text variable, Telegram default chat id
 * - TG_WEBHOOK_SECRET: optional secret text, Telegram webhook secret token
 *
 * Optional panel config (saved in D1):
 * - tgPhotoUrl: photo URL used by Telegram sendPhoto
 *
 * Routes:
 * - /admin
 * - /admin/login
 * - /admin/logout
 * - /admin/api/*
 *
 * All non-admin routes are treated as OpenList download proxy paths.
 */

const ADMIN_PREFIX = "/admin";
const COOKIE_NAME = "admin_token";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export default {
  async fetch(request, env, ctx) {
    try {
      await initDb(env);

      const url = new URL(request.url);
      if (url.pathname === "/favicon.ico") {
        return new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=86400" } });
      }
      if (url.pathname === "/" && request.method === "GET") {
        return Response.redirect(`${url.origin}${ADMIN_PREFIX}`, 302);
      }

      if (url.pathname === "/api/tg-webhook" && request.method === "POST") {
        return handleTelegramWebhook(request, env, ctx);
      }

      if (url.pathname.startsWith(ADMIN_PREFIX)) {
        return handleAdmin(request, env, ctx);
      }

      return handleProxy(request, env, ctx);
    } catch (error) {
      console.error("Unhandled error:", error?.stack || error?.message || String(error));
      return jsonResponse(
        { code: 500, message: "internal error", detail: String(error?.message || error) },
        500
      );
    }
  },

  async scheduled(event, env, ctx) {
    try {
      await initDb(env);
      if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return;
      ctx.waitUntil(sendTelegramSummary(env, { force: false, source: "scheduled" }));
    } catch (error) {
      console.error("Scheduled summary failed:", error?.message || error);
    }
  },
};

async function initDb(env) {
  if (env.__dbReady) return;

  await env.DB.prepare("CREATE TABLE IF NOT EXISTS olp_kv_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS olp_proxy_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, path TEXT, method TEXT, status INTEGER, content_length INTEGER, duration_ms INTEGER, upstream_host TEXT, target_url TEXT, client_ip TEXT, range_header TEXT, note TEXT)").run();

  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_olp_proxy_logs_created_at ON olp_proxy_logs(created_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_olp_proxy_logs_path ON olp_proxy_logs(path)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_olp_proxy_logs_upstream_host ON olp_proxy_logs(upstream_host)").run();

  env.__dbReady = true;
}


async function handleAdmin(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.slice(ADMIN_PREFIX.length) || "/";
  const expected = String(env.PANEL_PASSWORD || "").trim();
  if (!expected) return htmlResponse("<h1>请先配置 PANEL_PASSWORD</h1>", 500);

  if (path === "/logout" && request.method === "POST") {
    return new Response(null, {
      status: 204,
      headers: {
        "Set-Cookie": `${COOKIE_NAME}=; Path=/; Secure; SameSite=Lax; Max-Age=0`,
      },
    });
  }

  const providedToken = decodeURIComponent(getCookie(request.headers.get("Cookie") || "", COOKIE_NAME) || "");
  const authed = providedToken === expected;

  if (path === "/" && request.method === "GET") {
    return htmlResponse(renderAdminHtml({ authed }));
  }

  if (!authed) {
    return jsonResponse({ code: 401, message: "未登录" }, 401);
  }

  if (path === "/api/bootstrap" && request.method === "GET") {
    const config = await getConfig(env);
    const logs = await listLogs(env, 50);
    const stats = await getStats(env);
    return jsonResponse({
      code: 200,
      data: {
        config: {
          address: config.address || "",
          workerAddress: config.workerAddress || "",
          disableSign: config.disableSign === "true",
          allowCors: config.allowCors !== "false",
          panelNote: config.panelNote || "",
          hasToken: Boolean(config.token),
          tgPhotoUrl: config.tgPhotoUrl || "",
        },
        logs,
        stats,
        tg: {
          botConfigured: Boolean(env.TG_BOT_TOKEN),
          chatConfigured: Boolean(env.TG_CHAT_ID),
          chatIdMasked: maskChatId(env.TG_CHAT_ID || ""),
        }
      },
    });
  }

  if (path === "/api/config" && request.method === "POST") {
    const body = await readJson(request);
    const address = sanitizeBaseUrl(body?.address || "");
    const workerAddress = sanitizeBaseUrl(body?.workerAddress || "");
    const disableSign = body?.disableSign ? "true" : "false";
    const allowCors = body?.allowCors === false ? "false" : "true";
    const panelNote = String(body?.panelNote || "").slice(0, 1000);
    const tgPhotoUrl = sanitizeUrlKeepPath(body?.tgPhotoUrl || "");
    const token = typeof body?.token === "string" ? body.token.trim() : "";

    if (!address) return jsonResponse({ code: 400, message: "OpenList 地址不能为空" }, 400);
    if (!workerAddress) return jsonResponse({ code: 400, message: "Worker 地址不能为空" }, 400);

    const entries = [
      ["address", address],
      ["workerAddress", workerAddress],
      ["disableSign", disableSign],
      ["allowCors", allowCors],
      ["panelNote", panelNote],
      ["tgPhotoUrl", tgPhotoUrl],
    ];

    for (const [key, value] of entries) {
      await setKv(env, key, value);
    }

    if (token) {
      await setKv(env, "token_enc", await encryptText(env.APP_SECRET, token));
    }

    return jsonResponse({ code: 200, message: "保存成功" });
  }

  if (path === "/api/test" && request.method === "POST") {
    const config = await getConfig(env);
    if (!config.address) return jsonResponse({ code: 400, message: "请先保存配置" }, 400);

    const basic = await fetch(config.address, { method: "GET", redirect: "manual" }).catch(() => null);
    const ok = !!basic;
    return jsonResponse({
      code: ok ? 200 : 500,
      message: ok ? "地址可访问" : "地址不可访问",
      data: {
        address: config.address,
        status: basic?.status || 0,
        hasToken: Boolean(config.token),
      },
    }, ok ? 200 : 500);
  }

  if (path === "/api/logs" && request.method === "GET") {
    return jsonResponse({ code: 200, data: await listLogs(env, 100) });
  }

  if (path === "/api/stats" && request.method === "GET") {
    return jsonResponse({ code: 200, data: await getStats(env) });
  }

  if (path === "/api/clear-logs" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM olp_proxy_logs").run();
    return jsonResponse({ code: 200, message: "已清空日志" });
  }

  if (path === "/api/send-tg-test" && request.method === "POST") {
    if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) {
      return jsonResponse({ code: 400, message: "未配置 TG_BOT_TOKEN 或 TG_CHAT_ID" }, 400);
    }
    await sendTelegramSummary(env, { force: true, source: "manual" });
    return jsonResponse({ code: 200, message: "已尝试发送 TG 测试消息" });
  }

  return jsonResponse({ code: 404, message: "not found" }, 404);
}

async function handleProxy(request, env, ctx) {
  if (request.method === "OPTIONS") return handleOptions(request);

  const config = await getConfig(env);
  if (!config.address || !config.token) {
    return jsonResponse(
      { code: 500, message: "代理未配置。请先访问 /admin 保存 OpenList 地址与 Token。" },
      500
    );
  }

  const start = Date.now();
  const origin = request.headers.get("Origin") || "*";
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const rangeHeader = request.headers.get("Range") || "";

  if (path === "/" || !path) {
    return Response.redirect(`${url.origin}${ADMIN_PREFIX}`, 302);
  }

  if (config.disableSign !== "true") {
    const sign = url.searchParams.get("sign") || "";
    const verifyResult = await verifySignature(config.token, path, sign);
    if (verifyResult) {
      return jsonResponse({ code: 401, message: verifyResult }, 401, buildCorsHeaders(origin));
    }
  }

  const linkResp = await fetch(`${config.address}/api/fs/link`, {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "Authorization": config.token,
    },
    body: JSON.stringify({ path }),
  });

  const linkData = await safeJson(linkResp);
  if (!linkResp.ok || !linkData || linkData.code !== 200 || !linkData?.data?.url) {
    const response = jsonResponse(
      {
        code: linkResp.status || 500,
        message: "获取 OpenList 下载链接失败",
        detail: linkData || null,
      },
      linkResp.status || 500,
      buildCorsHeaders(origin)
    );

    ctx.waitUntil(logProxyEvent(env, {
      path,
      method: request.method,
      status: response.status,
      contentLength: 0,
      durationMs: Date.now() - start,
      upstreamHost: "",
      targetUrl: "",
      clientIp: maskIp(request.headers.get("cf-connecting-ip") || ""),
      rangeHeader: truncate(rangeHeader, 256),
      note: "fs_link_failed",
    }));

    return response;
  }

  let upstreamUrl = linkData.data.url;
  let upstreamReq = new Request(upstreamUrl, request);

  if (linkData.data.header) {
    for (const key of Object.keys(linkData.data.header)) {
      const values = Array.isArray(linkData.data.header[key]) ? linkData.data.header[key] : [linkData.data.header[key]];
      for (const value of values) upstreamReq.headers.set(key, value);
    }
  }

  let upstreamResp = await fetch(upstreamReq, { redirect: "manual" });
  let redirects = 0;
  while (upstreamResp.status >= 300 && upstreamResp.status < 400 && redirects < 5) {
    const location = upstreamResp.headers.get("location");
    if (!location) break;
    redirects += 1;

    if (location.startsWith((config.workerAddress || url.origin).replace(/\/+$/,"") + "/")) {
      const nextReq = new Request(location, request);
      return handleProxy(nextReq, env, ctx);
    }

    upstreamUrl = new URL(location, upstreamUrl).toString();
    upstreamReq = new Request(upstreamUrl, upstreamReq);
    upstreamResp = await fetch(upstreamReq, { redirect: "manual" });
  }

  const proxied = new Response(upstreamResp.body, upstreamResp);
  proxied.headers.delete("set-cookie");
  proxied.headers.delete("alt-svc");
  proxied.headers.delete("cf-cache-status");
  proxied.headers.delete("cf-ray");
  if (config.allowCors !== "false") {
    for (const [k, v] of Object.entries(buildCorsHeaders(origin))) proxied.headers.set(k, v);
  }

  const contentLength = Number(proxied.headers.get("content-length") || 0);
  const durationMs = Date.now() - start;

  ctx.waitUntil(logProxyEvent(env, {
    path,
    method: request.method,
    status: proxied.status,
    contentLength,
    durationMs,
    upstreamHost: safeHost(upstreamUrl),
    targetUrl: truncate(upstreamUrl, 1200),
    clientIp: maskIp(request.headers.get("cf-connecting-ip") || ""),
    rangeHeader: truncate(rangeHeader, 256),
    note: "",
  }));

  return proxied;
}

function buildCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function handleOptions(request) {
  const origin = request.headers.get("Origin") || "*";
  if (request.headers.get("Origin") !== null && request.headers.get("Access-Control-Request-Method") !== null) {
    return new Response(null, {
      headers: {
        ...buildCorsHeaders(origin),
        "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "",
      },
    });
  }
  return new Response(null, { headers: { Allow: "GET, HEAD, OPTIONS" } });
}

async function getConfig(env) {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM olp_kv_config WHERE key IN (?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    "address", "workerAddress", "disableSign", "allowCors", "panelNote", "token_enc", "tgPhotoUrl"
  ).all();

  const map = {};
  for (const row of rows.results || []) map[row.key] = row.value;

  let token = "";
  if (map.token_enc) {
    try {
      token = await decryptText(env.APP_SECRET, map.token_enc);
    } catch (e) {
      console.error("Decrypt token failed:", e?.message || e);
    }
  }

  return {
    address: map.address || "",
    workerAddress: map.workerAddress || "",
    disableSign: map.disableSign || "false",
    allowCors: map.allowCors || "true",
    panelNote: map.panelNote || "",
    tgPhotoUrl: map.tgPhotoUrl || "",
    token,
  };
}

async function setKv(env, key, value) {
  await env.DB.prepare(`
    INSERT INTO olp_kv_config(key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
  `).bind(key, value).run();
}

async function listLogs(env, limit = 30) {
  const rows = await env.DB.prepare(`
    SELECT
      id,
      created_at,
      datetime(created_at, '+8 hours') AS created_at_cn,
      path,
      method,
      status,
      content_length,
      duration_ms,
      upstream_host,
      client_ip,
      range_header,
      note
    FROM olp_proxy_logs
    ORDER BY id DESC
    LIMIT ?
  `).bind(limit).all();

  return (rows.results || []).map((row) => {
    const durationMs = Number(row.duration_ms || 0);
    return {
      ...row,
      createdAt: row.created_at_cn || row.created_at || "",
      upstreamHost: row.upstream_host || "",
      clientIpMasked: row.client_ip || "",
      contentLengthHuman: formatBytes(row.content_length || 0),
      durationHuman: `${Math.round(durationMs)} ms`,
      content_length_human: formatBytes(row.content_length || 0),
    };
  });
}

async function getStats(env) {
  const [today, day7, day30, latest, topPathRows, topHostRows, hourlyRows] = await Promise.all([
    env.DB.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status BETWEEN 200 AND 399 THEN 1 ELSE 0 END) AS success_requests,
        SUM(COALESCE(content_length, 0)) AS total_bytes,
        AVG(COALESCE(duration_ms, 0)) AS avg_duration_ms,
        SUM(CASE WHEN COALESCE(range_header, '') != '' THEN 1 ELSE 0 END) AS range_requests
      FROM olp_proxy_logs
      WHERE date(created_at, '+8 hours') = date('now', '+8 hours')
    `).first(),

    env.DB.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(COALESCE(content_length, 0)) AS total_bytes
      FROM olp_proxy_logs
      WHERE datetime(created_at, '+8 hours') >= datetime('now', '+8 hours', '-7 days')
    `).first(),

    env.DB.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(COALESCE(content_length, 0)) AS total_bytes
      FROM olp_proxy_logs
      WHERE datetime(created_at, '+8 hours') >= datetime('now', '+8 hours', '-30 days')
    `).first(),

    env.DB.prepare(`
      SELECT
        created_at,
        datetime(created_at, '+8 hours') AS created_at_cn,
        path,
        upstream_host,
        status,
        content_length,
        duration_ms
      FROM olp_proxy_logs
      ORDER BY id DESC
      LIMIT 1
    `).first(),

    env.DB.prepare(`
      SELECT path, COUNT(*) AS c, SUM(COALESCE(content_length,0)) AS bytes
      FROM olp_proxy_logs
      WHERE date(created_at, '+8 hours') = date('now', '+8 hours')
      GROUP BY path
      ORDER BY c DESC, bytes DESC
      LIMIT 5
    `).all(),

    env.DB.prepare(`
      SELECT upstream_host, COUNT(*) AS c, SUM(COALESCE(content_length,0)) AS bytes
      FROM olp_proxy_logs
      WHERE date(created_at, '+8 hours') = date('now', '+8 hours')
      GROUP BY upstream_host
      ORDER BY c DESC, bytes DESC
      LIMIT 5
    `).all(),

    env.DB.prepare(`
      SELECT strftime('%H', datetime(created_at, '+8 hours')) AS hour, COUNT(*) AS c
      FROM olp_proxy_logs
      WHERE date(created_at, '+8 hours') = date('now', '+8 hours')
      GROUP BY hour
      ORDER BY c DESC, hour ASC
      LIMIT 1
    `).first(),
  ]);

  const totalRequests = Number(today?.total_requests || 0);
  const successRequests = Number(today?.success_requests || 0);
  const totalBytes = Number(today?.total_bytes || 0);
  const avgDurationMs = Number(today?.avg_duration_ms || 0);
  const rangeRequests = Number(today?.range_requests || 0);

  const avgDurationRounded = Math.round(avgDurationMs || 0);
  const day7Requests = Number(day7?.total_requests || 0);
  const day7Bytes = Number(day7?.total_bytes || 0);
  const day30Requests = Number(day30?.total_requests || 0);
  const day30Bytes = Number(day30?.total_bytes || 0);

  return {
    today: {
      totalRequests,
      successRequests,
      totalBytes,
      totalBytesHuman: formatBytes(totalBytes),
      successRate: totalRequests ? `${((successRequests / totalRequests) * 100).toFixed(1)}%` : "0%",
      avgDurationMs: avgDurationRounded,
      avgDurationHuman: `${avgDurationRounded} ms`,
      rangeRequests,
      topHour: hourlyRows?.hour ? `${String(hourlyRows.hour).padStart(2, "0")}:00-${String(hourlyRows.hour).padStart(2, "0")}:59` : "暂无",
    },
    day7: {
      totalRequests: day7Requests,
      totalBytes: day7Bytes,
      totalBytesHuman: formatBytes(day7Bytes),
    },
    sevenDays: {
      totalRequests: day7Requests,
      totalBytes: day7Bytes,
      totalBytesHuman: formatBytes(day7Bytes),
    },
    day30: {
      totalRequests: day30Requests,
      totalBytes: day30Bytes,
      totalBytesHuman: formatBytes(day30Bytes),
    },
    thirtyDays: {
      totalRequests: day30Requests,
      totalBytes: day30Bytes,
      totalBytesHuman: formatBytes(day30Bytes),
    },
    latest: latest ? {
      created_at: latest.created_at_cn || latest.created_at,
      createdAt: latest.created_at_cn || latest.created_at,
      path: latest.path,
      upstream_host: latest.upstream_host,
      upstreamHost: latest.upstream_host,
      status: latest.status,
      content_length_human: formatBytes(latest.content_length || 0),
      contentLengthHuman: formatBytes(latest.content_length || 0),
      duration_ms: latest.duration_ms || 0,
      durationHuman: `${Math.round(Number(latest.duration_ms || 0))} ms`,
      clientIpMasked: "",
    } : null,
    topPaths: (topPathRows.results || []).map((r) => ({
      path: r.path,
      count: Number(r.c || 0),
      requests: Number(r.c || 0),
      bytes: Number(r.bytes || 0),
      bytesHuman: formatBytes(r.bytes || 0),
    })),
    topHosts: (topHostRows.results || []).map((r) => ({
      upstream_host: r.upstream_host,
      upstreamHost: r.upstream_host,
      count: Number(r.c || 0),
      requests: Number(r.c || 0),
      bytes: Number(r.bytes || 0),
      bytesHuman: formatBytes(r.bytes || 0),
    })),
  };
}

async function logProxyEvent(env, data) {
  try {
    await env.DB.prepare(`
      INSERT INTO olp_proxy_logs(
        path, method, status, content_length, duration_ms, upstream_host, target_url, client_ip, range_header, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      data.path || "",
      data.method || "",
      Number(data.status || 0),
      Number(data.contentLength || 0),
      Number(data.durationMs || 0),
      data.upstreamHost || "",
      data.targetUrl || "",
      data.clientIp || "",
      data.rangeHeader || "",
      data.note || ""
    ).run();
  } catch (error) {
    console.error("logProxyEvent error:", error?.message || error);
  }
}

async function verifySignature(token, data, sign) {
  if (!sign) return "sign missing";
  const parts = sign.split(":");
  if (!parts[parts.length - 1]) return "expire missing";
  const expire = parseInt(parts[parts.length - 1], 10);
  if (Number.isNaN(expire)) return "expire invalid";
  if (expire < Date.now() / 1000 && expire > 0) return "expire expired";
  const right = await hmacSha256Sign(token, data, expire);
  if (sign !== right) return "sign mismatch";
  return "";
}

async function hmacSha256Sign(secret, data, expire) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const buf = await crypto.subtle.sign(
    { name: "HMAC", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${data}:${expire}`)
  );
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_") + ":" + expire;
}

async function buildSessionCookie(env, payload) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacHex(env.APP_SECRET, body);
  return `${body}.${sig}`;
}

async function isAuthed(request, env) {
  const raw = getCookie(request.headers.get("Cookie") || "", COOKIE_NAME);
  if (!raw || !raw.includes(".")) return false;
  const [body, sig] = raw.split(".");
  const right = await hmacHex(env.APP_SECRET, body);
  if (sig !== right) return false;
  try {
    const payload = JSON.parse(base64UrlDecode(body));
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function encryptText(secret, text) {
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return `${base64UrlFromBytes(iv)}.${base64UrlFromBytes(new Uint8Array(cipher))}`;
}

async function decryptText(secret, packed) {
  const [ivB64, dataB64] = String(packed || "").split(".");
  if (!ivB64 || !dataB64) return "";
  const key = await deriveAesKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64Url(ivB64) },
    key,
    bytesFromBase64Url(dataB64)
  );
  return new TextDecoder().decode(plain);
}

async function deriveAesKey(secret) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function telegramApi(env, method, payload) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const detail = await safeJson(resp);
  return { ok: resp.ok, status: resp.status, detail };
}

function buildTelegramSummaryText(stats, config) {
  const lines = [
    "📦 OpenList 下载代理监控",
    "",
    "✨ 今日下载概览",
    `📥 请求总数：${stats.today.totalRequests} 次`,
    `✅ 成功请求：${stats.today.successRequests} 次（${stats.today.successRate}）`,
    `💾 今日流量：${stats.today.totalBytesHuman}`,
    `📡 Range 请求：${stats.today.rangeRequests} 次`,
    `⏱ 平均耗时：${stats.today.avgDurationMs} ms`,
    `🕒 活跃时段：${stats.today.topHour}`,
    "",
    "🌐 下载入口统计",
    `🗓 近 7 天流量：${stats.day7.totalBytesHuman}`,
    `🧾 近 7 天请求：${stats.day7.totalRequests} 次`,
    `🪐 近 30 天流量：${stats.day30.totalBytesHuman}`,
    `📚 近 30 天请求：${stats.day30.totalRequests} 次`,
  ];

  if (stats.topHosts.length) {
    lines.push("", "🚀 今日上游 TOP 5");
    const icons = ["👑", "🌟", "💠", "🎯", "🪄"];
    stats.topHosts.forEach((item, idx) => {
      lines.push(`${icons[idx] || "•"} ${item.upstream_host || "未知上游"} · ${item.bytesHuman}（${item.count}次）`);
    });
  }

  if (stats.topPaths.length) {
    lines.push("", "🔥 今日下载路径 TOP 5");
    const icons = ["🥇", "🥈", "🥉", "🏅", "🎖️"];
    stats.topPaths.forEach((item, idx) => {
      lines.push(`${icons[idx] || "•"} ${item.path || "/"} · ${item.bytesHuman}（${item.count}次）`);
    });
  }

  if (stats.latest) {
    lines.push("", "🕓 最近一次下载");
    lines.push(`📁 ${stats.latest.path || "/"}`);
    lines.push(`🌍 ${stats.latest.upstream_host || "未知上游"} ｜ ${stats.latest.content_length_human} ｜ ${stats.latest.duration_ms} ms`);
  }

  if (config.panelNote) {
    lines.push("", `📝 备注：${truncate(config.panelNote, 120)}`);
  }

  lines.push("", `🗓 统计时间：${formatCnTime(new Date())}`, "🚀 SystemStatus：Operational");
  return lines.join("\n");
}

function buildTelegramTodayText(stats) {
  const lines = [
    "📦 OpenList 今日简报",
    "",
    `📥 今日请求：${stats.today.totalRequests} 次`,
    `💾 今日流量：${stats.today.totalBytesHuman}`,
    `✅ 成功率：${stats.today.successRate}`,
    `📡 Range 请求：${stats.today.rangeRequests} 次`,
    `⏱ 平均耗时：${stats.today.avgDurationMs} ms`,
    `🕒 活跃时段：${stats.today.topHour}`,
  ];
  if (stats.topPaths.length) {
    lines.push("", "🔥 热门路径");
    stats.topPaths.slice(0, 3).forEach((item, idx) => {
      const icons = ["🥇", "🥈", "🥉"];
      lines.push(`${icons[idx] || "•"} ${item.path || "/"} · ${item.bytesHuman}（${item.count}次）`);
    });
  }
  return lines.join("\n");
}

async function sendTelegramText(env, chatId, text) {
  const result = await telegramApi(env, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
  if (!result.ok) {
    console.error("sendMessage failed:", result.detail || result.status);
    return false;
  }
  return true;
}

async function sendTelegramSummary(env, options = {}) {
  const chatId = options.chatId || env.TG_CHAT_ID;
  if (!env.TG_BOT_TOKEN || !chatId) return false;
  const stats = await getStats(env);
  const config = await getConfig(env);
  const text = buildTelegramSummaryText(stats, config);

  if (config.tgPhotoUrl) {
    const result = await telegramApi(env, "sendPhoto", {
      chat_id: chatId,
      photo: config.tgPhotoUrl,
      caption: text,
    });
    if (result.ok) return true;
    console.error("sendPhoto failed:", result.detail || result.status);
  }

  return sendTelegramText(env, chatId, text);
}

async function sendTelegramToday(env, chatId) {
  if (!env.TG_BOT_TOKEN || !chatId) return false;
  const stats = await getStats(env);
  return sendTelegramText(env, chatId, buildTelegramTodayText(stats));
}

async function sendTelegramTop(env, chatId) {
  if (!env.TG_BOT_TOKEN || !chatId) return false;
  const stats = await getStats(env);
  const lines = [
    "🏆 OpenList TOP 榜单",
    "",
    "🚀 今日上游 TOP 5",
  ];
  if (stats.topHosts.length) {
    const icons = ["👑", "🌟", "💠", "🎯", "🪄"];
    stats.topHosts.forEach((item, idx) => {
      lines.push(`${icons[idx] || "•"} ${item.upstream_host || "未知上游"} · ${item.bytesHuman}（${item.count}次）`);
    });
  } else {
    lines.push("• 暂无上游统计数据");
  }

  lines.push("", "🔥 今日下载路径 TOP 5");
  if (stats.topPaths.length) {
    const icons = ["🥇", "🥈", "🥉", "🏅", "🎖️"];
    stats.topPaths.forEach((item, idx) => {
      lines.push(`${icons[idx] || "•"} ${item.path || "/"} · ${item.bytesHuman}（${item.count}次）`);
    });
  } else {
    lines.push("• 暂无路径统计数据");
  }

  return sendTelegramText(env, chatId, lines.join("\n"));
}

async function sendTelegramLogs(env, chatId) {
  if (!env.TG_BOT_TOKEN || !chatId) return false;
  const logs = await listLogs(env, 5);
  const lines = ["🧾 最近下载日志", ""];
  if (!logs.length) {
    lines.push("• 暂无下载日志");
  } else {
    logs.forEach((item, idx) => {
      lines.push(
        `${idx + 1}. ${item.path || "/"}\n` +
        `🌍 ${item.upstreamHost || "未知上游"} ｜ ${item.contentLengthHuman} ｜ ${item.durationHuman}\n` +
        `🕒 ${item.createdAt || ""} ｜ 状态 ${item.status || 0}`
      );
    });
  }
  return sendTelegramText(env, chatId, lines.join("\n\n"));
}

async function sendTelegramStatus(env, chatId) {
  if (!env.TG_BOT_TOKEN || !chatId) return false;
  const config = await getConfig(env);
  const stats = await getStats(env);
  const lines = [
    "🧩 OpenList Proxy 状态",
    "",
    `🌐 OpenList 地址：${config.address || "未配置"}`,
    `🔗 Worker 地址：${config.workerAddress || "未配置"}`,
    `🔐 签名验证：${config.disableSign === "true" ? "关闭" : "开启"}`,
    `🪄 CORS：${config.allowCors === "true" ? "开启" : "关闭"}`,
    `🤖 TG Bot：${env.TG_BOT_TOKEN ? "已配置" : "未配置"}`,
    `💬 默认 Chat：${env.TG_CHAT_ID ? "已配置" : "未配置"}`,
    `📦 今日请求：${stats.today.totalRequests} 次`,
    `💾 今日流量：${stats.today.totalBytesHuman}`,
    `🚀 SystemStatus：Operational`,
  ];
  return sendTelegramText(env, chatId, lines.join("\n"));
}

async function clearLogsFromTelegram(env, chatId) {
  if (!env.TG_BOT_TOKEN || !chatId) return false;
  if (!env.TG_CHAT_ID || String(chatId) !== String(env.TG_CHAT_ID)) {
    return sendTelegramText(env, chatId, "⛔ 只有默认 TG_CHAT_ID 对应的聊天才能执行 /clearlogs");
  }
  await env.DB.prepare("DELETE FROM olp_proxy_logs").run();
  return sendTelegramText(env, chatId, `🧹 日志已清空\n🕒 ${formatCnTime(new Date())}`);
}

async function handleTelegramWebhook(request, env, ctx) {
  if (!env.TG_BOT_TOKEN) {
    return jsonResponse({ ok: false, message: "TG_BOT_TOKEN 未配置" }, 400);
  }

  const expectedSecret = String(env.TG_WEBHOOK_SECRET || "").trim();
  if (expectedSecret) {
    const providedSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (providedSecret !== expectedSecret) {
      return jsonResponse({ ok: false, message: "forbidden" }, 403);
    }
  }

  const update = await readJson(request);
  const msg = update?.message || update?.edited_message;
  const chatId = msg?.chat?.id;
  const rawText = String(msg?.text || "").trim();
  if (!chatId || !rawText) {
    return jsonResponse({ ok: true, message: "ignored" });
  }

  const cmd = rawText.split(/\s+/)[0].toLowerCase();

  try {
    if (cmd === "/start" || cmd === "/help") {
      await sendTelegramText(env, chatId,
        "👋 OpenList 下载代理 Bot 已在线\n\n可用命令：\n/start - 显示帮助\n/stats - 发送完整统计\n/today - 发送今日简报\n/top - 发送 TOP 榜单\n/logs - 发送最近日志\n/status - 查看当前状态\n/clearlogs - 清空下载日志\n/test - 测试 Bot 是否在线"
      );
    } else if (cmd === "/stats") {
      await sendTelegramSummary(env, { chatId, force: true, source: "webhook" });
    } else if (cmd === "/today") {
      await sendTelegramToday(env, chatId);
    } else if (cmd === "/top") {
      await sendTelegramTop(env, chatId);
    } else if (cmd === "/logs") {
      await sendTelegramLogs(env, chatId);
    } else if (cmd === "/status") {
      await sendTelegramStatus(env, chatId);
    } else if (cmd === "/clearlogs") {
      await clearLogsFromTelegram(env, chatId);
    } else if (cmd === "/test") {
      await sendTelegramText(env, chatId, `✅ Bot 在线\n🕒 ${formatCnTime(new Date())}`);
    } else {
      await sendTelegramText(env, chatId, "不支持的命令。发送 /help 查看可用命令。");
    }
  } catch (error) {
    console.error("tg webhook error:", error?.message || error);
  }

  return jsonResponse({ ok: true });
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

async function safeJson(response) {
  try { return await response.json(); } catch { return null; }
}

function getCookie(cookieHeader, name) {
  return String(cookieHeader || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function sanitizeBaseUrl(value) {
  const v = String(value || "").trim().replace(/\/+$/g, "");
  if (!v) return "";
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function sanitizeUrlKeepPath(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  try {
    return new URL(v).toString();
  } catch {
    return "";
  }
}

function truncate(text, max) {
  const str = String(text || "");
  return str.length > max ? str.slice(0, max) : str;
}

function maskIp(ip) {
  if (!ip) return "";
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return parts.slice(0, 3).join(":") + ":****";
  }
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  return ip;
}

function maskChatId(chatId) {
  const s = String(chatId || "");
  if (!s) return "";
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}****${s.slice(-2)}`;
}

function safeHost(input) {
  try { return new URL(input).host || ""; } catch { return ""; }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let idx = 0;
  while (n >= 1024 && idx < units.length - 1) {
    n /= 1024;
    idx += 1;
  }
  return `${n.toFixed(n >= 100 || idx === 0 ? 0 : n >= 10 ? 1 : 2)} ${units[idx]}`;
}

function formatCnTime(date) {
  const base = date instanceof Date ? date : new Date(date);
  const d = new Date(base.getTime() + 8 * 60 * 60 * 1000);
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function base64UrlEncode(text) {
  return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesFromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}


function renderAdminHtml({ authed }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>OpenList Proxy Panel</title>
<style>
:root{
  --bg:#07111f;
  --bg-2:#0b1730;
  --panel:rgba(9,18,39,.78);
  --panel-2:rgba(12,24,49,.92);
  --panel-3:rgba(14,28,56,.98);
  --line:rgba(128,165,255,.16);
  --line-strong:rgba(128,165,255,.28);
  --text:#f5f8ff;
  --muted:#9eb2d8;
  --soft:#7f93b9;
  --primary:#6ea8ff;
  --primary-2:#8e7dff;
  --good:#28c98b;
  --warn:#f6b94b;
  --danger:#ff6b7d;
  --shadow:0 20px 60px rgba(0,0,0,.38);
  --radius-xl:28px;
  --radius-lg:22px;
  --radius-md:18px;
  --radius-sm:14px;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  color:var(--text);
  font:14px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
  background:
    radial-gradient(circle at top left, rgba(91,144,255,.22), transparent 28%),
    radial-gradient(circle at top right, rgba(140,125,255,.18), transparent 26%),
    linear-gradient(180deg, #040b15 0%, #09111f 30%, #0b1324 100%);
}
body::before,
body::after{
  content:"";
  position:fixed;
  inset:auto;
  width:34vw;
  height:34vw;
  border-radius:999px;
  filter:blur(70px);
  opacity:.18;
  pointer-events:none;
}
body::before{top:-8vw;right:-10vw;background:#3b82f6}
body::after{bottom:-12vw;left:-10vw;background:#7c3aed}
a{color:inherit}
.shell{max-width:1440px;margin:0 auto;padding:28px 22px 40px;position:relative}
.card{
  background:linear-gradient(180deg, rgba(15,27,52,.92), rgba(10,20,40,.9));
  border:1px solid var(--line);
  border-radius:var(--radius-xl);
  box-shadow:var(--shadow);
  backdrop-filter: blur(12px);
}
.hero{
  position:relative;
  overflow:hidden;
  display:grid;
  grid-template-columns:minmax(0,1.4fr) minmax(320px,.8fr);
  gap:18px;
  padding:28px;
  margin-bottom:20px;
}
.hero::before{
  content:"";
  position:absolute;
  inset:-20% auto auto -10%;
  width:320px;
  height:320px;
  border-radius:999px;
  background:radial-gradient(circle, rgba(110,168,255,.22), transparent 65%);
  pointer-events:none;
}
.hero-main{position:relative;z-index:1}
.eyebrow{
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:8px 12px;
  border-radius:999px;
  background:rgba(110,168,255,.1);
  border:1px solid rgba(110,168,255,.2);
  color:#d8e6ff;
  letter-spacing:.04em;
  text-transform:uppercase;
  font-size:12px;
}
.hero h1{margin:16px 0 10px;font-size:34px;line-height:1.1;letter-spacing:-.03em}
.hero-desc{max-width:760px;color:var(--muted);font-size:15px}
.hero-meta,.action-row,.status-row,.metric-grid,.hero-grid,.analytics-grid,.config-grid,.help-grid,.mini-grid,.login-feature-list{display:grid;gap:14px}
.hero-meta{
  grid-template-columns:repeat(2,minmax(0,1fr));
  margin-top:18px;
}
.chip{
  display:flex;
  align-items:center;
  gap:10px;
  min-height:48px;
  padding:12px 14px;
  border-radius:18px;
  border:1px solid var(--line);
  background:rgba(255,255,255,.03);
  color:#dce7ff;
}
.dot{
  width:10px;
  height:10px;
  border-radius:999px;
  box-shadow:0 0 18px currentColor;
  flex:0 0 auto;
}
.dot-good{color:var(--good);background:currentColor}
.dot-info{color:var(--primary);background:currentColor}
.dot-warn{color:var(--warn);background:currentColor}
.hero-actions{
  position:relative;
  z-index:1;
  display:flex;
  flex-direction:column;
  justify-content:space-between;
  gap:14px;
}
.action-box{
  padding:18px;
  border-radius:22px;
  border:1px solid var(--line);
  background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02));
}
.action-box h3{margin:0 0 8px;font-size:15px}
.action-box p{margin:0;color:var(--muted)}
.action-row{
  grid-template-columns:repeat(2,minmax(0,1fr));
}
.btn{
  appearance:none;
  border:none;
  border-radius:18px;
  padding:13px 16px;
  font-weight:700;
  cursor:pointer;
  color:white;
  transition:transform .18s ease, box-shadow .18s ease, opacity .18s ease, border-color .18s ease;
  box-shadow:0 12px 32px rgba(0,0,0,.22);
}
.btn:hover{transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.btn-primary{background:linear-gradient(135deg, #5ea7ff, #4d7cff)}
.btn-secondary{background:linear-gradient(135deg, #6a7fff, #8d62ff)}
.btn-success{background:linear-gradient(135deg, #34d399, #10b981)}
.btn-danger{background:linear-gradient(135deg, #ff8b9b, #ff5d6c)}
.btn-ghost{
  color:#e6eeff;
  background:rgba(255,255,255,.04);
  border:1px solid var(--line);
  box-shadow:none;
}
.hero-grid{
  grid-template-columns:minmax(0,1.2fr) minmax(320px,.8fr);
  margin-bottom:22px;
}
.feature-card,.insight-card,.panel-block,.logs-card,.stack-card,.analytics-card{
  padding:24px;
}
.section-kicker{
  margin-bottom:10px;
  color:#9fbdfd;
  font-size:12px;
  letter-spacing:.08em;
  text-transform:uppercase;
}
.section-head{
  display:flex;
  justify-content:space-between;
  align-items:flex-end;
  gap:14px;
  margin-bottom:16px;
}
.section-head h2,
.stack-card h2,
.panel-block h2,
.logs-card h2,
.feature-card h2{margin:0;font-size:24px;letter-spacing:-.02em}
.section-note{color:var(--muted)}
.codeblock{
  margin-top:12px;
  padding:16px 18px;
  border-radius:18px;
  border:1px solid rgba(110,168,255,.22);
  background:linear-gradient(180deg, rgba(9,22,46,.95), rgba(8,18,38,.95));
  color:#d8ebff;
  font:600 13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
  word-break:break-all;
}
.helper{margin-top:10px;color:var(--muted)}
.mini-grid{
  grid-template-columns:repeat(2,minmax(0,1fr));
  margin-top:18px;
}
.mini-stat{
  min-height:98px;
  padding:16px;
  border-radius:20px;
  background:rgba(255,255,255,.035);
  border:1px solid var(--line);
}
.mini-stat span{display:block;color:var(--muted);font-size:12px}
.mini-stat strong{display:block;margin-top:8px;font-size:20px;line-height:1.25;word-break:break-word}
.status-row{
  grid-template-columns:repeat(2,minmax(0,1fr));
  margin-top:18px;
}
.info-pill{
  padding:12px 14px;
  border-radius:16px;
  border:1px solid var(--line);
  background:rgba(255,255,255,.03);
}
.info-pill b{display:block;margin-top:6px;font-size:15px}
.metric-grid{
  grid-template-columns:repeat(5,minmax(0,1fr));
}
.metric{
  position:relative;
  padding:18px 18px 20px;
  border-radius:22px;
  border:1px solid var(--line);
  background:linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.025));
  overflow:hidden;
}
.metric::after{
  content:"";
  position:absolute;
  inset:auto auto -30px -10px;
  width:120px;
  height:120px;
  border-radius:999px;
  background:radial-gradient(circle, rgba(110,168,255,.18), transparent 70%);
  pointer-events:none;
}
.metric-label{color:var(--muted);font-size:12px}
.metric-value{margin-top:10px;font-size:28px;font-weight:800;letter-spacing:-.03em}
.metric-sub{margin-top:10px;color:#bfd0ef;font-size:12px}
.analytics-grid{
  grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  margin-top:16px;
}
.analytics-card{
  min-height:100%;
  border:1px solid var(--line);
  border-radius:24px;
  background:rgba(255,255,255,.03);
}
.analytics-card h3{margin:0 0 14px;font-size:18px}
.list{display:grid;gap:12px}
.rank-item{
  display:grid;
  grid-template-columns:auto minmax(0,1fr) auto;
  gap:14px;
  align-items:center;
  padding:14px;
  border-radius:18px;
  border:1px solid rgba(255,255,255,.06);
  background:rgba(255,255,255,.03);
}
.rank-no{
  width:34px;
  height:34px;
  border-radius:12px;
  display:grid;
  place-items:center;
  font-weight:800;
  color:#081322;
  background:linear-gradient(135deg,#f8fbff,#93c5fd);
}
.rank-title{
  min-width:0;
  font-weight:700;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.rank-meta{
  color:var(--muted);
  font-size:12px;
}
.rank-side{
  text-align:right;
  color:#dbe7ff;
  white-space:nowrap;
}
.latest-card{
  grid-column:1 / -1;
}
.latest-shell{
  display:grid;
  grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);
  gap:16px;
}
.latest-main,.latest-side{
  padding:18px;
  border-radius:22px;
  border:1px solid var(--line);
  background:rgba(255,255,255,.03);
}
.latest-path{
  font:700 16px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:#e6f0ff;
  word-break:break-all;
}
.status-badge{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:58px;
  padding:6px 10px;
  border-radius:999px;
  font-weight:700;
  font-size:12px;
  border:1px solid transparent;
}
.status-good{background:rgba(40,201,139,.12);color:#9cf0ca;border-color:rgba(40,201,139,.25)}
.status-warn{background:rgba(246,185,75,.12);color:#ffd58a;border-color:rgba(246,185,75,.28)}
.status-bad{background:rgba(255,107,125,.12);color:#ffb0ba;border-color:rgba(255,107,125,.25)}
.meta-line{margin-top:12px;color:var(--muted)}
.meta-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
  margin-top:14px;
}
.meta-box{
  padding:13px 14px;
  border-radius:18px;
  border:1px solid var(--line);
  background:rgba(255,255,255,.03);
}
.meta-box span{display:block;color:var(--muted);font-size:12px}
.meta-box b{display:block;margin-top:6px;font-size:16px}
.config-grid{
  grid-template-columns:minmax(0,1.1fr) minmax(340px,.9fr);
  gap:20px;
  margin:22px 0;
}
.stack{display:grid;gap:16px}
label{
  display:block;
  margin:14px 0 8px;
  color:#ecf3ff;
  font-weight:700;
}
.input-wrap{position:relative}
input,textarea{
  width:100%;
  border-radius:18px;
  border:1px solid var(--line);
  background:rgba(4,13,28,.48);
  color:var(--text);
  padding:14px 16px;
  outline:none;
  transition:border-color .18s ease, box-shadow .18s ease, background .18s ease;
}
input:focus,textarea:focus{
  border-color:rgba(110,168,255,.55);
  box-shadow:0 0 0 4px rgba(110,168,255,.12);
  background:rgba(7,17,36,.7);
}
textarea{min-height:128px;resize:vertical}
.form-actions{
  display:flex;
  flex-wrap:wrap;
  gap:12px;
  margin-top:18px;
}
.switch-list{display:grid;gap:10px;margin-top:14px}
.switch-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:14px 16px;
  border-radius:18px;
  border:1px solid var(--line);
  background:rgba(255,255,255,.03);
}
.switch-row span{display:block}
.switch-row small{display:block;color:var(--muted);margin-top:4px}
.switch-row input{
  width:20px;
  height:20px;
  accent-color:#5ea7ff;
  flex:0 0 auto;
}
.help-grid{
  grid-template-columns:1fr;
}
.check-list{display:grid;gap:10px;margin-top:14px}
.check-item{
  padding:14px 16px;
  border-radius:18px;
  border:1px solid var(--line);
  background:rgba(255,255,255,.03);
  color:#dde8ff;
}
.check-item span{color:var(--muted)}
.logs-card .toolbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  margin-bottom:14px;
}
.logs-actions{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:flex-end;
  gap:10px;
}
.table-shell{
  overflow:auto;
  border:1px solid var(--line);
  border-radius:22px;
  background:rgba(2,9,21,.28);
}
.table{
  width:100%;
  min-width:980px;
  border-collapse:separate;
  border-spacing:0;
}
.table th,.table td{
  padding:14px 14px;
  text-align:left;
  border-bottom:1px solid rgba(255,255,255,.05);
}
.table th{
  position:sticky;
  top:0;
  z-index:1;
  background:rgba(8,17,35,.95);
  color:#b8c7e7;
  font-weight:700;
  backdrop-filter:blur(10px);
}
.table tbody tr:hover td{background:rgba(255,255,255,.025)}
.table tbody tr:last-child td{border-bottom:none}
.log-path{
  display:inline-block;
  max-width:360px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  vertical-align:bottom;
  font:600 12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:#d7e7ff;
}
.muted{color:var(--muted)}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.empty{
  padding:16px;
  color:var(--muted);
  text-align:center;
}
.toast{
  position:fixed;
  right:22px;
  bottom:22px;
  max-width:min(420px, calc(100vw - 32px));
  padding:14px 16px;
  border-radius:18px;
  border:1px solid rgba(110,168,255,.24);
  background:rgba(9,18,39,.92);
  color:#eef4ff;
  box-shadow:0 18px 48px rgba(0,0,0,.34);
  opacity:0;
  transform:translateY(12px);
  pointer-events:none;
  transition:opacity .22s ease, transform .22s ease;
  z-index:99;
}
.toast.show{opacity:1;transform:translateY(0)}
.login-shell{
  min-height:calc(100vh - 68px);
  display:grid;
  place-items:center;
}
.login-card{
  width:min(1080px, 100%);
  display:grid;
  grid-template-columns:minmax(0,1.1fr) minmax(360px,.9fr);
  overflow:hidden;
}
.login-visual,.login-form{
  padding:34px;
}
.login-visual{
  position:relative;
  background:
    radial-gradient(circle at 20% 20%, rgba(110,168,255,.22), transparent 30%),
    radial-gradient(circle at 80% 10%, rgba(142,125,255,.18), transparent 26%),
    linear-gradient(180deg, rgba(13,27,53,.96), rgba(9,18,39,.92));
  border-right:1px solid var(--line);
}
.login-visual h1{margin:18px 0 10px;font-size:36px;line-height:1.1}
.login-visual p{max-width:560px;color:var(--muted)}
.login-feature-list{margin-top:22px}
.login-feature{
  padding:16px 18px;
  border-radius:20px;
  border:1px solid rgba(255,255,255,.07);
  background:rgba(255,255,255,.04);
}
.login-form h2{margin:0 0 8px;font-size:28px}
.login-form p{margin:0;color:var(--muted)}
.login-form .btn{width:100%;margin-top:16px}
.login-note{
  margin-top:16px;
  padding:12px 14px;
  border-radius:16px;
  background:rgba(255,255,255,.03);
  border:1px solid var(--line);
  color:var(--muted);
  font-size:13px;
}
@media (max-width:1180px){
  .metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .hero{grid-template-columns:1fr}
  .hero-grid,.config-grid,.latest-shell,.login-card{grid-template-columns:1fr}
}
@media (max-width:860px){
  .shell{padding:16px 14px 28px}
  .hero,.feature-card,.insight-card,.panel-block,.logs-card,.stack-card,.analytics-card,.login-visual,.login-form{padding:20px}
  .hero-meta,.metric-grid,.analytics-grid,.mini-grid,.status-row,.meta-grid,.action-row{grid-template-columns:1fr}
  .section-head,.logs-card .toolbar{align-items:flex-start;flex-direction:column}
  .logs-actions{width:100%;justify-content:flex-start}
  .log-path{max-width:220px}
}
</style>
</head>
<body>
<div class="shell">
${authed ? `
  <section class="hero card">
    <div class="hero-main">
      <div class="eyebrow"><span class="dot dot-info"></span> OpenList Download Acceleration</div>
      <h1>OpenList 加速下载面板</h1>
      <div class="hero-desc">用于给 OpenList 增加下载代理入口。Worker 会转发 OpenList 返回的真实下载链接，可配合 Cloudflare 自定义域名与优选 IP，改善 OneDrive 等上游文件的下载速度与可达性。</div>
      <div class="hero-meta">
        <div class="chip"><span class="dot dot-good"></span><span>管理入口 <span class="code">/admin</span></span></div>
        <div class="chip"><span class="dot dot-info"></span><span>适用场景：OpenList 下载加速 / OneDrive 外链中转</span></div>
        <div class="chip"><span class="dot dot-warn"></span><span id="tgStatus">Bot：检测中</span></div>
      </div>
    </div>
    <div class="hero-actions">
      <div class="action-box">
        <h3>这个项目能做什么</h3>
        <p>在这里完成 OpenList 地址、Worker 外链地址、Token、签名校验、CORS 和 Telegram 通知配置，并查看代理请求、流量、耗时、热点路径与最近访问日志。</p>
      </div>
      <div class="action-row">
        <button class="btn btn-primary" onclick="scrollToConfig()">先去配置</button>
        <button class="btn btn-success" onclick="sendTgTest()">发送 TG 测试</button>
        <button class="btn btn-danger" onclick="logout()">退出登录</button>
      </div>
    </div>
  </section>

  <section class="config-grid">
    <div class="card panel-block" id="configSection">
      <div class="section-head">
        <div>
          <div class="section-kicker">基础配置</div>
          <h2>先填写这里</h2>
        </div>
        <div class="section-note">保存后会立即更新当前运行配置，配置完成后再把下方代理入口填入 OpenList。</div>
      </div>

      <form id="configForm" onsubmit="saveConfig(event)">
        <label>OpenList 地址</label>
        <div class="input-wrap">
          <input id="address" placeholder="https://pan.example.com" />
        </div>

        <label>Worker 对外地址</label>
        <div class="input-wrap">
          <input id="workerAddress" placeholder="https://proxy.example.com" />
        </div>

        <label>OpenList 管理员 Token</label>
        <div class="input-wrap">
          <input id="token" placeholder="首次保存必须填写" />
        </div>

        <label>TG 顶部图片 URL（可选）</label>
        <div class="input-wrap">
          <input id="tgPhotoUrl" placeholder="https://example.com/banner.jpg" />
        </div>

        <div class="switch-list">
          <label style="margin:0">运行开关</label>
          <div class="switch-row">
            <div>
              <span>关闭签名验证</span>
              <small>默认建议保持开启；关闭后，知道路径的人可直接访问代理下载。</small>
            </div>
            <input id="disableSign" type="checkbox" />
          </div>
          <div class="switch-row">
            <div>
              <span>启用 CORS</span>
              <small>开启后会为下载响应附加跨域头，适合浏览器或前端调用场景。</small>
            </div>
            <input id="allowCors" type="checkbox" checked />
          </div>
        </div>

        <label>备注</label>
        <div class="input-wrap">
          <textarea id="panelNote" placeholder="可记录用途、上游来源、域名说明或其他备注"></textarea>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" type="submit">保存配置</button>
          <button class="btn btn-secondary" type="button" onclick="testConfig()">连通性测试</button>
        </div>
      </form>
    </div>

    <div class="stack">
      <div class="card stack-card">
        <div class="section-kicker">项目用途</div>
        <h2>这是做什么的</h2>
        <div class="check-list">
          <div class="check-item">• 为 OpenList 提供可自定义域名的下载代理入口。</div>
          <div class="check-item">• 借助 Cloudflare Workers 与优选 IP，改善 OneDrive 等上游文件的下载体验。</div>
          <div class="check-item">• 支持签名校验、CORS、访问日志、统计面板和 Telegram 通知。</div>
          <div class="check-item">• 适合自用或中小流量场景下的下载加速与日常管理。</div>
        </div>
      </div>

      <div class="card stack-card">
        <div class="section-kicker">工作原理</div>
        <h2>请求如何流转</h2>
        <div class="check-list">
          <div class="check-item">1. 客户端访问 Worker 对外地址发起下载请求。</div>
          <div class="check-item">2. Worker 向 OpenList 的 <span class="code">/api/fs/link</span> 请求真实下载地址。</div>
          <div class="check-item">3. Worker 按配置完成签名校验、CORS 处理后，再把请求转发到上游下载源。</div>
          <div class="check-item">4. 请求结果会写入 <span class="code">olp_proxy_logs</span>，用于面板统计和 TG 摘要。</div>
        </div>
      </div>
    </div>
  </section>

  <section class="hero-grid">
    <div class="card feature-card">
      <div class="section-kicker">代理入口</div>
      <h2>OpenList 下载代理 URL</h2>
      <div class="helper">完成基础配置后，把下面这个地址填到 OpenList 存储挂载中的“下载代理 URL”。地址末尾不要带斜杠。</div>
      <div class="codeblock" id="proxyUrl">--</div>
      <div class="mini-grid">
        <div class="mini-stat">
          <span>近 7 天请求</span>
          <strong id="summary7d">0 次</strong>
        </div>
        <div class="mini-stat">
          <span>近 30 天流量</span>
          <strong id="summary30d">0 B</strong>
        </div>
        <div class="mini-stat">
          <span>最近一次请求</span>
          <strong id="summaryLatest">暂无</strong>
        </div>
        <div class="mini-stat">
          <span>签名 / CORS</span>
          <strong id="summarySecurity">--</strong>
        </div>
      </div>
    </div>

    <div class="card insight-card">
      <div class="section-kicker">关键能力</div>
      <h2>面板会帮你管理什么</h2>
      <div class="status-row">
        <div class="info-pill">
          <span>OpenList Token</span>
          <b>保存后加密存储</b>
        </div>
        <div class="info-pill">
          <span>代理日志</span>
          <b>D1 表 <span class="code">olp_proxy_logs</span></b>
        </div>
        <div class="info-pill">
          <span>连接测试</span>
          <b>支持立即校验 OpenList 地址</b>
        </div>
        <div class="info-pill">
          <span>TG 通知</span>
          <b>支持测试、定时摘要和命令查询</b>
        </div>
      </div>
    </div>
  </section>

  <section class="card panel-block">
    <div class="section-head">
      <div>
        <div class="section-kicker">运行统计</div>
        <h2>实时下载概览</h2>
      </div>
      <div class="section-note" id="overviewText">等待载入统计数据...</div>
    </div>

    <div class="metric-grid">
      <div class="metric">
        <div class="metric-label">今日请求</div>
        <div class="metric-value" id="kpiRequests">0</div>
        <div class="metric-sub">当天累计代理请求数</div>
      </div>
      <div class="metric">
        <div class="metric-label">今日流量</div>
        <div class="metric-value" id="kpiTraffic">0 B</div>
        <div class="metric-sub">累计透传内容长度</div>
      </div>
      <div class="metric">
        <div class="metric-label">成功率</div>
        <div class="metric-value" id="kpiSuccess">0%</div>
        <div class="metric-sub">状态码 2xx-3xx 视为成功</div>
      </div>
      <div class="metric">
        <div class="metric-label">平均耗时</div>
        <div class="metric-value" id="kpiAvg">0 ms</div>
        <div class="metric-sub">代理链路平均耗时</div>
      </div>
      <div class="metric">
        <div class="metric-label">Range 请求</div>
        <div class="metric-value" id="kpiRange">0</div>
        <div class="metric-sub">断点续传类请求统计</div>
      </div>
    </div>

    <div class="analytics-grid">
      <div class="analytics-card">
        <h3>今日上游 TOP 5</h3>
        <div id="topHosts" class="list"></div>
      </div>
      <div class="analytics-card">
        <h3>今日下载路径 TOP 5</h3>
        <div id="topPaths" class="list"></div>
      </div>
      <div class="analytics-card latest-card">
        <h3>最近一次下载</h3>
        <div id="latestBox"></div>
      </div>
    </div>
  </section>

  <section class="card logs-card">
    <div class="toolbar">
      <div>
        <div class="section-kicker">访问日志</div>
        <h2>最近代理日志</h2>
      </div>
      <div class="logs-actions">
        <span class="chip"><span class="dot dot-info"></span><span id="refreshStatus">自动刷新：10s</span></span>
        <button class="btn btn-secondary" type="button" onclick="manualRefresh()">手动刷新</button>
        <button class="btn btn-ghost" type="button" onclick="clearLogs()">清空日志</button>
      </div>
    </div>
    <div class="table-shell">
      <table class="table">
        <thead>
          <tr>
            <th>时间</th>
            <th>路径</th>
            <th>上游主机</th>
            <th>状态</th>
            <th>大小</th>
            <th>耗时</th>
            <th>访客 IP</th>
          </tr>
        </thead>
        <tbody id="logsBody">
          <tr><td colspan="7" class="muted">加载中...</td></tr>
        </tbody>
      </table>
    </div>
  </section>
` : `
  <section class="login-shell">
    <div class="card login-card">
      <div class="login-visual">
        <div class="eyebrow"><span class="dot dot-info"></span> OpenList Download Acceleration</div>
        <h1>OpenList 下载加速控制台</h1>
        <p>这个项目用于给 OpenList 增加下载代理入口。通过 Cloudflare Workers 转发下载请求，可配合自定义域名与优选 IP，改善 OneDrive 等上游文件的下载速度与可达性。</p>
        <div class="login-feature-list">
          <div class="login-feature">
            <strong>下载加速</strong>
            <div class="muted">把 OpenList 下载链路接入 Cloudflare 边缘网络，适合 OneDrive 等外链场景。</div>
          </div>
          <div class="login-feature">
            <strong>集中配置</strong>
            <div class="muted">统一维护 OpenList 地址、Worker 外链地址、Token、签名开关、CORS 与 TG 参数。</div>
          </div>
          <div class="login-feature">
            <strong>统计与通知</strong>
            <div class="muted">登录后可查看请求量、流量、耗时、热门路径、最近日志，并支持 Telegram 摘要通知。</div>
          </div>
        </div>
      </div>
      <div class="login-form">
        <div class="section-kicker">管理员验证</div>
        <h2>登录控制台</h2>
        <p>输入 <span class="code">PANEL_PASSWORD</span> 进入管理面板。</p>
        <label>面板密码</label>
        <div class="input-wrap">
          <input id="tokenInput" type="password" placeholder="输入 PANEL_PASSWORD" onkeydown="if(event.key==='Enter') login()" />
        </div>
        <button class="btn btn-primary" type="button" onclick="login()">登录</button>
        <div class="login-note">建议结合自定义域名、访问控制规则或其他安全策略一起使用管理入口。</div>
      </div>
    </div>
  </section>
`}

<div id="toast" class="toast"></div>

<script>
let toastTimer = null;

function showToast(msg){
  const el = document.getElementById('toast');
  if (!el) {
    alert(msg || '完成');
    return;
  }
  el.textContent = msg || '完成';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function statusTone(status){
  const n = Number(status || 0);
  if (n >= 200 && n < 300) return 'good';
  if (n >= 300 && n < 400) return 'warn';
  return 'bad';
}

function statusBadge(status){
  const tone = statusTone(status);
  const map = { good: 'status-good', warn: 'status-warn', bad: 'status-bad' };
  return '<span class="status-badge ' + map[tone] + '">' + escapeHtml(String(status ?? '-')) + '</span>';
}

function scrollToConfig(){
  const target = document.getElementById('configSection');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function login(){
  const token = (document.getElementById('tokenInput')?.value || '').trim();
  if(!token) return showToast('请输入面板密码');
  document.cookie = '${COOKIE_NAME}=' + encodeURIComponent(token) + '; path=/; max-age=2592000; SameSite=Lax; Secure';
  window.location.reload();
}

function logout(){
  document.cookie = '${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax; Secure';
  window.location.reload();
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json;charset=UTF-8', ...(options.headers || {}) },
    ...options
  });
  const raw = await res.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch(e) { data = { code: res.status, message: raw || ('HTTP ' + res.status) }; }
  if (!res.ok || (data.code && data.code >= 400)) throw new Error(data.message || ('请求失败: ' + res.status));
  return data;
}

function escapeHtml(s){
  return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function rankNo(idx){
  return String((idx || 0) + 1).padStart(2, '0');
}

function renderSimpleList(elId, items, formatter){
  const el = document.getElementById(elId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = '<div class="empty">暂无数据</div>';
    return;
  }
  el.innerHTML = items.map(formatter).join('');
}

function renderLogs(logs){
  const body = document.getElementById('logsBody');
  if (!body) return;
  if (!logs || !logs.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">暂无日志</td></tr>';
    return;
  }
  body.innerHTML = logs.map(x => \`<tr>
    <td>\${escapeHtml(x.createdAt || '')}</td>
    <td title="\${escapeHtml(x.path || '')}"><span class="log-path">\${escapeHtml(x.path || '')}</span></td>
    <td>\${escapeHtml(x.upstreamHost || '-')}</td>
    <td>\${statusBadge(x.status)}</td>
    <td>\${escapeHtml(x.contentLengthHuman || '0 B')}</td>
    <td>\${escapeHtml(x.durationHuman || '0 ms')}</td>
    <td>\${escapeHtml(x.clientIpMasked || '-')}</td>
  </tr>\`).join('');
}

function renderRankList(elId, items, kind){
  renderSimpleList(elId, items, (x, idx) => {
    const title = kind === 'host' ? (x.upstreamHost || '-') : (x.path || '/');
    const req = x.requests || x.count || 0;
    return \`<div class="rank-item">
      <div class="rank-no">\${rankNo(idx)}</div>
      <div style="min-width:0">
        <div class="rank-title" title="\${escapeHtml(title)}">\${escapeHtml(title)}</div>
        <div class="rank-meta">\${escapeHtml(String(req))} 次请求</div>
      </div>
      <div class="rank-side">\${escapeHtml(x.bytesHuman || '0 B')}</div>
    </div>\`;
  });
}

function renderLatest(latest){
  const latestBox = document.getElementById('latestBox');
  if (!latestBox) return;
  if (!latest) {
    latestBox.innerHTML = '<div class="empty">暂无数据</div>';
    return;
  }
  latestBox.innerHTML = \`<div class="latest-shell">
    <div class="latest-main">
      <div class="latest-path">\${escapeHtml(latest.path || '-')}</div>
      <div class="meta-line">时间：\${escapeHtml(latest.createdAt || '-')} ｜ 上游：\${escapeHtml(latest.upstreamHost || '-')} ｜ 状态：\${statusBadge(latest.status)}</div>
      <div class="meta-grid">
        <div class="meta-box"><span>内容大小</span><b>\${escapeHtml(latest.contentLengthHuman || '0 B')}</b></div>
        <div class="meta-box"><span>耗时</span><b>\${escapeHtml(latest.durationHuman || '0 ms')}</b></div>
        <div class="meta-box"><span>访客来源</span><b>\${escapeHtml(latest.clientIpMasked || '-')}</b></div>
        <div class="meta-box"><span>响应状态</span><b>\${escapeHtml(String(latest.status ?? '-'))}</b></div>
      </div>
    </div>
    <div class="latest-side">
      <div class="section-kicker">Latest snapshot</div>
      <div class="helper">这里展示最新一条已写入 D1 的代理记录，便于快速确认下载链路是否工作正常。</div>
      <div class="check-list" style="margin-top:16px">
        <div class="check-item">路径：<span class="code">\${escapeHtml(latest.path || '-')}</span></div>
        <div class="check-item">上游：<span>\${escapeHtml(latest.upstreamHost || '-')}</span></div>
        <div class="check-item">完成耗时：<span>\${escapeHtml(latest.durationHuman || '0 ms')}</span></div>
      </div>
    </div>
  </div>\`;
}

function fillStats(stats){
  const s = stats || {};
  document.getElementById('kpiRequests').innerText = s.today?.totalRequests ?? 0;
  document.getElementById('kpiTraffic').innerText = s.today?.totalBytesHuman ?? '0 B';
  document.getElementById('kpiSuccess').innerText = s.today?.successRate ?? '0%';
  document.getElementById('kpiAvg').innerText = s.today?.avgDurationHuman ?? '0 ms';
  document.getElementById('kpiRange').innerText = s.today?.rangeRequests ?? 0;

  const weekReq = s.sevenDays?.totalRequests || 0;
  const weekBytes = s.sevenDays?.totalBytesHuman || '0 B';
  const monthBytes = s.thirtyDays?.totalBytesHuman || '0 B';
  const topHour = s.today?.topHour || '暂无';
  document.getElementById('overviewText').innerText =
    '今日成功率 ' + (s.today?.successRate || '0%') + ' · 近 7 天 ' + weekReq + ' 次请求 / ' + weekBytes + ' · 活跃时段 ' + topHour;

  const summary7d = document.getElementById('summary7d');
  const summary30d = document.getElementById('summary30d');
  const summaryLatest = document.getElementById('summaryLatest');
  if (summary7d) summary7d.innerText = weekReq + ' 次';
  if (summary30d) summary30d.innerText = monthBytes;
  if (summaryLatest) summaryLatest.innerText = s.latest?.createdAt || '暂无';

  renderRankList('topHosts', s.topHosts || [], 'host');
  renderRankList('topPaths', s.topPaths || [], 'path');
  renderLatest(s.latest);
}

function fillConfig(data){
  const c = data.config || {};
  document.getElementById('address').value = c.address || '';
  document.getElementById('workerAddress').value = c.workerAddress || location.origin;
  document.getElementById('disableSign').checked = !!c.disableSign;
  document.getElementById('allowCors').checked = c.allowCors !== false;
  document.getElementById('panelNote').value = c.panelNote || '';
  document.getElementById('tgPhotoUrl').value = c.tgPhotoUrl || '';
  document.getElementById('token').placeholder = c.hasToken ? '已保存。留空则保持不变。' : '请输入 OpenList 管理员 Token';

  const proxyUrl = (c.workerAddress || location.origin || '').replace(/\\/+$/,'');
  const proxyEl = document.getElementById('proxyUrl');
  if (proxyEl) proxyEl.innerText = proxyUrl;

  const tgText = 'Bot：' + (data.tg?.botConfigured ? '已配置' : '未配置') + ' ｜ Chat：' + (data.tg?.chatConfigured ? (data.tg?.chatIdMasked || '已配置') : '未配置');
  const tgStatus = document.getElementById('tgStatus');
  if (tgStatus) tgStatus.innerText = tgText;

  const summarySecurity = document.getElementById('summarySecurity');
  if (summarySecurity) summarySecurity.innerText = (c.disableSign ? '签名关闭' : '签名开启') + ' / ' + (c.allowCors === false ? 'CORS 关闭' : 'CORS 开启');
}

let liveRefreshTimer = null;
let liveRefreshInFlight = false;
let lastRefreshAt = 0;
const LIVE_REFRESH_MS = 10000;

function updateRefreshStatus(text){
  const el = document.getElementById('refreshStatus');
  if (el) el.innerText = text;
}

async function refreshLiveData(silent = true){
  if (liveRefreshInFlight) return;
  if (document.hidden) return;
  liveRefreshInFlight = true;
  try{
    const res = await api('/admin/api/bootstrap');
    fillConfig(res.data || {});
    fillStats((res.data || {}).stats || {});
    renderLogs((res.data || {}).logs || []);
    lastRefreshAt = Date.now();
    updateRefreshStatus('自动刷新：10s · 刚刚更新');
  }catch(e){
    updateRefreshStatus('自动刷新：10s · 更新失败');
    if (!silent) showToast(e.message || '刷新失败');
  }finally{
    liveRefreshInFlight = false;
  }
}

function startLiveRefresh(){
  stopLiveRefresh();
  updateRefreshStatus('自动刷新：10s');
  liveRefreshTimer = setInterval(() => {
    refreshLiveData(true);
  }, LIVE_REFRESH_MS);
}

function stopLiveRefresh(){
  if (liveRefreshTimer) {
    clearInterval(liveRefreshTimer);
    liveRefreshTimer = null;
  }
}

async function manualRefresh(){
  updateRefreshStatus('自动刷新：10s · 手动刷新中...');
  await refreshLiveData(false);
}

async function boot(){
  const res = await api('/admin/api/bootstrap');
  fillConfig(res.data || {});
  fillStats((res.data || {}).stats || {});
  renderLogs((res.data || {}).logs || []);
  lastRefreshAt = Date.now();
  startLiveRefresh();
}

async function saveConfig(ev){
  if (ev && ev.preventDefault) ev.preventDefault();
  const payload = {
    address: document.getElementById('address').value.trim(),
    workerAddress: document.getElementById('workerAddress').value.trim(),
    token: document.getElementById('token').value.trim(),
    disableSign: document.getElementById('disableSign').checked,
    allowCors: document.getElementById('allowCors').checked,
    panelNote: document.getElementById('panelNote').value,
    tgPhotoUrl: document.getElementById('tgPhotoUrl').value.trim()
  };
  const res = await api('/admin/api/config', { method:'POST', body: JSON.stringify(payload) });
  showToast(res.message || '已保存');
  document.getElementById('token').value = '';
  await boot();
  return false;
}

async function testConfig(){
  const res = await api('/admin/api/test', { method:'POST', body:'{}' });
  showToast((res.message || '测试完成') + ' · 状态码: ' + (res.data?.status || 0));
}

async function clearLogs(){
  if (!confirm('确认清空日志？')) return;
  const res = await api('/admin/api/clear-logs', { method:'POST', body:'{}' });
  showToast(res.message || '已清空');
  await boot();
}

async function sendTgTest(){
  const res = await api('/admin/api/send-tg-test', { method:'POST', body:'{}' });
  showToast(res.message || '已发送');
}

${authed ? "window.addEventListener('DOMContentLoaded', () => { boot().catch(e => showToast(e.message)); }); window.addEventListener('visibilitychange', () => { if (document.hidden) { stopLiveRefresh(); } else { refreshLiveData(true); startLiveRefresh(); } });" : ""}
</script>
</body>
</html>`;
}

