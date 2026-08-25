#!/usr/bin/env node

const ARGO_DOMAIN = (process.env.ARGO_DOMAIN || "").trim();             // Argo固定隧道域名 留空=临时隧道
const ARGO_AUTH = (process.env.ARGO_AUTH || "").trim();                 // Argo固定隧道Token 留空=临时隧道
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const CFIP = process.env.CFIP || "usa.visa.com";
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || "Argo_VLESS_EasyShare";
const FILE_PATH = process.env.FILE_PATH || ".tmp";

const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

process.env.GODEBUG = "madvdontneed=1";
process.env.GOMAXPROCS = "1";

const UUID = process.env.UUID || (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
}));

const log = (msg) => process.stdout.write(msg + "\n");

function downloadFile(urlStr, targetPath) {
  return new Promise((resolve, reject) => {
    const client = urlStr.startsWith("https") ? https : http;
    const req = client.get(urlStr, (res) => {
      if ([301, 302].includes(res.statusCode)) {
        return downloadFile(res.headers.location, targetPath).then(resolve).catch(reject);
      }
      const file = fs.createWriteStream(targetPath);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    });
    req.on("error", (err) => { fs.unlink(targetPath, () => {}); reject(err); });
  });
}

if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

const webPath = path.join(FILE_PATH, "web");
const botPath = path.join(FILE_PATH, "bot");
const cfgPath = path.join(FILE_PATH, "config.json");

async function main() {
  // 1. 写入极限省内存配置（关闭日志 + 禁用 buffer 缓冲区）
  const config = {
    log: { loglevel: "none" },
    policy: { levels: { "0": { bufferSize: 0 } } },
    inbounds: [{
      port: parseInt(ARGO_PORT), listen: "127.0.0.1", protocol: "vless",
      settings: { clients: [{ id: UUID }], decryption: "none" },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }
    }],
    outbounds: [{ protocol: "freedom" }]
  };
  fs.writeFileSync(cfgPath, JSON.stringify(config));

  // 2. 判断架构并下载
  const isArm = ["arm", "arm64", "aarch64"].includes(os.arch());
  const baseUrl = isArm ? "https://arm64.ssss.nyc.mn" : "https://amd64.ssss.nyc.mn";

  log("Downloading binaries...");
  await downloadFile(`${baseUrl}/web`, webPath);
  await downloadFile(`${baseUrl}/bot`, botPath);
  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);

  // 3. 启动 Xray（限制 12MiB 堆内存）
  exec(`GOMEMLIMIT=12MiB ${webPath} -c ${cfgPath} >/dev/null 2>&1 &`);

  // 4. 精简版 Cloudflared 启动（强制限制 12MiB 堆内存，精简无用判断）
  const argoArgs = ARGO_AUTH.match(/^[A-Z0-9a-z=_-]{120,300}$/)
    ? `--no-autoupdate tunnel --edge-ip-version 4 --protocol http2 run --token ${ARGO_AUTH}`
    : `--no-autoupdate tunnel --edge-ip-version 4 --protocol http2 --url http://127.0.0.1:${ARGO_PORT}`;

  exec(`GOMEMLIMIT=12MiB ${botPath} ${argoArgs} >/dev/null 2>&1 &`);

  // 5. 格式化输出节点
  const plainNodeLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${ARGO_DOMAIN}&fp=firefox&type=ws&host=${ARGO_DOMAIN}&path=/vless-argo#${NAME}`;

  log("\n================== VLESS NODE LINK ==================");
  log(plainNodeLink);
  log("=====================================================\n");

  setInterval(() => {}, 2147483647);
}

main().catch((err) => console.error("Error:", err));
