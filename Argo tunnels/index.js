#!/usr/bin/env node

const ARGO_DOMAIN = (process.env.ARGO_DOMAIN || "").trim();               // 填入完整固定隧道域名 或留空=临时隧道
const ARGO_AUTH = (process.env.ARGO_AUTH || "").trim();                   // 填入固定隧道Token 或留空=临时隧道
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

// 限制 Go 运行时内存分配（适合翼龙面板小内存容器）
process.env.GODEBUG = "madvdontneed=1";
process.env.GOMAXPROCS = "1";

const UUID = process.env.UUID || (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
}));

const log = (msg) => process.stdout.write(msg + "\n");

// 极简流式下载
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
    req.on("error", (err) => {
      fs.unlink(targetPath, () => {});
      reject(err);
    });
  });
}

const webPath = path.join(FILE_PATH, "web");
const botPath = path.join(FILE_PATH, "bot");

if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

async function main() {
  // 1. 写入精简版 Xray 配置
  const config = {
    log: { access: "/dev/null", error: "/dev/null", loglevel: "none" },
    inbounds: [{
      port: parseInt(ARGO_PORT), listen: "0.0.0.0", protocol: "vless",
      settings: { clients: [{ id: UUID }], decryption: "none" },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }
    }],
    outbounds: [{ protocol: "freedom" }]
  };
  fs.writeFileSync(path.join(FILE_PATH, "config.json"), JSON.stringify(config));

  // 2. 判断系统架构并下载二进制
  const isArm = ["arm", "arm64", "aarch64"].includes(os.arch());
  const baseUrl = isArm ? "https://arm64.ssss.nyc.mn" : "https://amd64.ssss.nyc.mn";

  log("Downloading binaries...");
  await downloadFile(`${baseUrl}/web`, webPath);
  await downloadFile(`${baseUrl}/bot`, botPath);
  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);

  // 3. 后台启动 Xray
  exec(`GOMEMLIMIT=12MiB ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);

  // 4. 后台启动 Cloudflared 隧道
  let argoArgs = `--no-autoupdate `;
  if (ARGO_AUTH.match(/^[A-Z0-9a-z=_-]{120,300}$/)) {
    argoArgs += `tunnel --edge-ip-version 4 --protocol http2 run --token ${ARGO_AUTH}`;
  } else if (ARGO_AUTH.includes("TunnelSecret")) {
    fs.writeFileSync(path.join(FILE_PATH, "tunnel.json"), ARGO_AUTH);
    const tunnelYaml = `tunnel: ${ARGO_AUTH.split('"')[11]}\ncredentials-file: ${path.join(FILE_PATH, "tunnel.json")}\ningress:\n  - hostname: ${ARGO_DOMAIN}\n    service: http://127.0.0.1:${ARGO_PORT}\n  - service: http_status:404`;
    fs.writeFileSync(path.join(FILE_PATH, "tunnel.yml"), tunnelYaml);
    argoArgs += `tunnel --config ${FILE_PATH}/tunnel.yml run`;
  } else {
    argoArgs += `tunnel --edge-ip-version 4 --protocol http2 --url http://127.0.0.1:${ARGO_PORT}`;
  }

  exec(`GOMEMLIMIT=20MiB ${botPath} ${argoArgs} >/dev/null 2>&1 &`);

  // 5. 输出精简节点链接
  const domain = ARGO_DOMAIN || "l.isshare.dpdns.org";
  const plainNodeLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&fp=firefox&type=ws&host=${domain}&path=/vless-argo#${NAME}`;

  log("\n================== VLESS NODE LINK ==================");
  log(plainNodeLink);
  log("=====================================================\n");

  // 保持进程常驻
  setInterval(() => {}, 2147483647);
}

main().catch((err) => console.error("Error:", err));
