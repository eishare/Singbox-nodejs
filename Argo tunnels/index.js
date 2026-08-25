#!/usr/bin/env node

// 1. 配置项与环境变量
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";   // 固定隧道完整域名（不包含：cloudflared.exe service install ）
const ARGO_AUTH = process.env.ARGO_AUTH || "";       // 固定隧道Token（），留空使用临时隧道
const ARGO_PORT = process.env.ARGO_PORT || 8001;     // Cloudflare回源端口（临时隧道不修改）
const CFIP = process.env.CFIP || "saas.sin.fan";     // 优选 IP/域名
const CFPORT = process.env.CFPORT || 443;            // 优选端口，默认无需修改

const FILE_PATH = process.env.FILE_PATH || ".tmp";
const SUB_PATH = process.env.SUB_PATH || "sub";
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

// 2. 引入标准内置模块
const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);

// 3. Go 内存与并发限制（极致压制内存占用）
process.env.GODEBUG = "madvdontneed=1";
process.env.GOMAXPROCS = "1";

// 优先读取环境变量 UUID，若无则自动生成
const UUID = process.env.UUID || (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
}));

function alwaysLog(msg) {
  process.stdout.write(msg + "\n");
}

function request(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const client = u.protocol === "https:" ? https : http;
    const reqOptions = {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: options.timeout || 15000,
    };

    const req = client.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } 
        catch (e) { resolve({ status: res.statusCode, data }); }
      });
    });

    req.on("error", (err) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

function downloadFile(urlStr, targetPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const client = u.protocol === "https:" ? https : http;
    const file = fs.createWriteStream(targetPath);

    client.get(urlStr, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location, targetPath).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => {
      fs.unlink(targetPath, () => {});
      reject(err);
    });
  });
}

function generateRandomName() {
  let res = "";
  const chars = "abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < 6; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

let plainNodeLink = null;
let subContent = null;
const webName = generateRandomName();
const botName = generateRandomName();
const webPath = path.join(FILE_PATH, webName);
const botPath = path.join(FILE_PATH, botName);
const subPath = path.join(FILE_PATH, "sub.txt");
const listPath = path.join(FILE_PATH, "list.txt");
const bootLogPath = path.join(FILE_PATH, "boot.log");

if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH, { recursive: true });
}

function generateConfig() {
  const config = {
    log: { access: "/dev/null", error: "/dev/null", loglevel: "none" },
    inbounds: [
      {
        tag: "vless-ws-in",
        port: parseInt(ARGO_PORT),
        listen: "0.0.0.0",
        protocol: "vless",
        settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" },
        streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } },
      }
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }],
  };
  fs.writeFileSync(path.join(FILE_PATH, "config.json"), JSON.stringify(config, null, 2));
}

async function downloadFilesAndRun() {
  const isArm = ["arm", "arm64", "aarch64"].includes(os.arch());
  const baseUrl = isArm ? "https://arm64.ssss.nyc.mn" : "https://amd64.ssss.nyc.mn";

  const files = [
    { filePath: webPath, url: `${baseUrl}/web` },
    { filePath: botPath, url: `${baseUrl}/bot` },
  ];

  for (const file of files) {
    alwaysLog(`Downloading binary: ${path.basename(file.filePath)}`);
    await downloadFile(file.url, file.filePath);
    fs.chmodSync(file.filePath, 0o775);
  }

  alwaysLog(`UUID: ${UUID}`);

  exec(`GOMEMLIMIT=15MiB nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);
  alwaysLog(`${webName} (Xray-VLESS) running...`);

  let argoArgs;
  if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
    argoArgs = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
  } else if (ARGO_AUTH.match(/TunnelSecret/)) {
    argoArgs = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
  } else {
    argoArgs = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${bootLogPath} --loglevel info --url http://localhost:${ARGO_PORT}`;
  }

  exec(`GOMEMLIMIT=25MiB nohup ${botPath} ${argoArgs} >/dev/null 2>&1 &`);
  alwaysLog(`${botName} (Cloudflared) running...`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

function setupArgoConfig() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) return;
  if (ARGO_AUTH.includes("TunnelSecret")) {
    fs.writeFileSync(path.join(FILE_PATH, "tunnel.json"), ARGO_AUTH);
    const tunnelYaml = `
tunnel: ${ARGO_AUTH.split('"')[11]}
credentials-file: ${path.join(FILE_PATH, "tunnel.json")}
protocol: http2
ingress:
  - hostname: ${ARGO_DOMAIN}
    service: http://localhost:${ARGO_PORT}
    originRequest:
      noTLSVerify: true
  - service: http_status:404
`;
    fs.writeFileSync(path.join(FILE_PATH, "tunnel.yml"), tunnelYaml);
  }
}

async function getMetaInfo() {
  try {
    const res = await request("https://api.ip.sb/geoip", { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 3000 });
    if (res.data?.country_code && res.data?.isp) return `${res.data.country_code}-${res.data.isp}`.replace(/\s+/g, "_");
  } catch (e) {}
  return "Argo_VLESS";
}

async function extractDomainsAndGenerate() {
  let domain = ARGO_DOMAIN;
  if (!ARGO_AUTH || !ARGO_DOMAIN) {
    try {
      if (fs.existsSync(bootLogPath)) {
        const lines = fs.readFileSync(bootLogPath, "utf-8").split("\n");
        for (const line of lines) {
          const match = line.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
          if (match) {
            domain = match[1];
            break;
          }
        }
      }
    } catch (err) {}
  }

  if (!domain) {
    alwaysLog("Waiting for Argo Domain...");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return extractDomainsAndGenerate();
  }

  alwaysLog(`Argo Domain: ${domain}`);
  const nodeName = await getMetaInfo();

  plainNodeLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&fp=firefox&type=ws&host=${domain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}`;

  alwaysLog(`\n================== VLESS NODE LINK ==================\n${plainNodeLink}\n=====================================================\n`);

  const base64Sub = Buffer.from(plainNodeLink).toString("base64");
  fs.writeFileSync(subPath, base64Sub);
  fs.writeFileSync(listPath, plainNodeLink, "utf8");
  subContent = base64Sub;

  if (fs.existsSync(bootLogPath)) {
    try { fs.unlinkSync(bootLogPath); } catch (e) {}
  }
}

async function startServer() {
  setupArgoConfig();
  generateConfig();
  await downloadFilesAndRun();
  await extractDomainsAndGenerate();
}

startServer().catch((err) => console.error("Start Error:", err));

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];
  if (urlPath === `/${SUB_PATH}`) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(subContent || "Subscription generating, please refresh later...");
  }
  if (urlPath === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`Argo VLESS Node is running.<br><br>Subscription Path: /${SUB_PATH}`);
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, () => alwaysLog(`HTTP Server is running on port: ${PORT}`));
