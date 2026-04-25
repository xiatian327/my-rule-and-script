/*
 * Stash 节点生成器 (修复 YAML 缩进与 VLESS 标准格式)
 */
function getData(key) {
    let val = $persistentStore.read(key);
    if (!val) return null;
    try { return JSON.parse(val); } catch(e) { return { ip: val, ping: "0", bw: "0" }; }
}

let def = { ip: "cf.zhetengsha.eu.org", ping: "0", bw: "0" };
let d_cm = getData("CF_DATA_CM") || def;
let d_ct = getData("CF_DATA_CT") || def;
let d_cu = getData("CF_DATA_CU") || def;
let d_v6 = getData("CF_DATA_V6") || def;

const uuid = "22bffd38-d02a-4716-8397-a1bf82a0f1fc";
const host = "edkk.king8888.nyc.mn";
const path = "/"; 

function genYamlNode(emoji, name, item) {
    let ip = item.ip.replace(/\[|\]/g, ""); // 移除 IPv6 可能带的括号
    let nodeName = `${emoji} ${name} | ${item.ping}ms ${item.bw}M`;
    
    // 采用数组逐行拼接，彻底避免 JS 模板字符串引起的 YAML 缩进错乱
    let yamlLines = [
        `  - name: "${nodeName}"`,
        `    type: vless`,
        `    server: "${ip}"`,
        `    port: 443`,
        `    uuid: "${uuid}"`,
        `    cipher: none`,
        `    alterId: 0`,
        `    flow: ""`,
        `    network: ws`,
        `    tls: true`,
        `    sni: "${host}"`,
        `    servername: "${host}"`,
        `    skip-cert-verify: true`,
        `    ws-opts:`,
        `      path: "${path}"`,
        `      headers:`,
        `        Host: "${host}"`
    ];
    return yamlLines.join("\n");
}

let body = "proxies:\n" + [
    genYamlNode("📱", "移动", d_cm),
    genYamlNode("🌐", "电信", d_ct),
    genYamlNode("📶", "联通", d_cu),
    genYamlNode("🦕", "IPv6", d_v6)
].join("\n");

$done({
    status: 200,
    headers: { "Content-Type": "text/yaml; charset=utf-8" },
    body: body
});