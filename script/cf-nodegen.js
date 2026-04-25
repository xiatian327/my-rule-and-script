/*
 * Stash 节点生成器 (拦截虚拟 URL)
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

const uuid = "87d65d8f-c91a-4668-b505-daa251079964";
const host = "sapsg.txia363.nyc.mn";
const path = "/vless-argo?ed"; 

function genYamlNode(emoji, name, item) {
    let ip = item.ip.replace(/\[|\]/g, ""); // Clash 格式不带括号
    let nodeName = `${emoji} ${name} | ${item.ping}ms ${item.bw}M`;
    return `  - name: "${nodeName}"
    type: vless
    server: "${ip}"
    port: 443
    uuid: "${uuid}"
    udp: true
    tls: true
    network: ws
    sni: "${host}"
    ws-opts:
      path: "${path}"
      headers:
        Host: "${host}"`;
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