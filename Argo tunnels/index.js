#!/usr/bin/env node

const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";            // 固定隧道域名（留空=临时）
const ARGO_AUTH = process.env.ARGO_AUTH || "";                // 固定隧道Token（留空=临时）

const ARGO_PORT = process.env.ARGO_PORT || 8001;              // Cloudflare回源端口
const CFIP = process.env.CFIP || "saas.sin.fan";              // 优选域名/IP
const CFPORT = process.env.CFPORT || 443;                     // 端口
const NAME = process.env.NAME || "Argo_VLESS_EasyShare";      // 节点名称

const FILE_PATH = process.env.FILE_PATH || ".tmp";

const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

// 限制 Go 运行时内存分配
process.env.GODEBUG = "madvdontneed=1";
process.env.GOMAXPROCS = "1";

const UUID = process.env.UUID || (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
}));

const log = (msg) => process.stdout.write(msg + "\n");

// 流式下载文件
function downloadFile(urlStr, targetPath) {
  return new Promise((resolve, reject) => {
    const client = urlStr.startsWith("https") ? https : http;
    const req = client.get(urlStr, (res) => {
      if ([301, 302].includes(res.statusCode)) {
        req.destroy();
        return downloadFile(res.headers.location, targetPath).then(resolve).catch(reject);
      }
      const file = fs.createWriteStream(targetPath);
      res.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          req.destroy();
          resolve();
        });
      });
    });
    req.on("error", (err) => {
      req.destroy();
      fs.unlink(targetPath, () => {});
      reject(err);
    });
  });
}

const webPath = path.join(FILE_PATH, "web");
const botPath = path.join(FILE_PATH, "bot");
const bootLogPath = path.join(FILE_PATH, "boot.log");

if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

async function main() {
  // 1. 写入最小化 Xray 配置
  const config = {
    log: { access: "/dev/null", error: "/dev/null", loglevel: "none" },
    inbounds: [{
      port: parseInt(ARGO_PORT), listen: "127.0.0.1", protocol: "vless",
      settings: { clients: [{ id: UUID }], decryption: "none" },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }
    }],
    outbounds: [{ protocol: "freedom" }]
  };
  fs.writeFileSync(path.join(FILE_PATH, "config.json"), JSON.stringify(config));

  // 2. 判断系统架构并下载二进制
  const isArm = ["arm", "arm64", "aarch64"].includes(os.arch());
  const baseUrl = isArm ? "https://arm64.ssss.nyc.mn" : "https://amd64.ssss.nyc.mn";

  log("Downloading Xray & Cloudflared binaries...");
  await downloadFile(`${baseUrl}/web`, webPath);
  await downloadFile(`${baseUrl}/bot`, botPath);
  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);

  log(`UUID: ${UUID}`);

  // 3. 启动 Xray 进程
  exec(`GOMEMLIMIT=12MiB nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);

  // 4. 组装 Cloudflared 启动参数
  let argoArgs = `--edge-ip-version 4 --protocol http2 --no-autoupdate `;
  if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
    argoArgs += `run --token ${ARGO_AUTH}`;
  } else if (ARGO_AUTH.includes("TunnelSecret")) {
    fs.writeFileSync(path.join(FILE_PATH, "tunnel.json"), ARGO_AUTH);
    const tunnelYaml = `tunnel: ${ARGO_AUTH.split('"')[11]}\ncredentials-file: ${path.join(FILE_PATH, "tunnel.json")}\ningress:\n  - hostname: ${ARGO_DOMAIN}\n    service: http://127.0.0.1:${ARGO_PORT}\n  - service: http_status:404`;
    fs.writeFileSync(path.join(FILE_PATH, "tunnel.yml"), tunnelYaml);
    argoArgs += `--config ${FILE_PATH}/tunnel.yml run`;
  } else {
    argoArgs += `--logfile ${bootLogPath} --loglevel info --url http://127.0.0.1:${ARGO_PORT}`;
  }

  // 启动 Argo 进程
  exec(`GOMEMLIMIT=20MiB nohup ${botPath} tunnel ${argoArgs} >/dev/null 2>&1 &`);
  log("Processes started.");

  // 5. 获取隧道域名并打印节点
  let domain = ARGO_DOMAIN;
  if (!domain) {
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (fs.existsSync(bootLogPath)) {
        const logText = fs.readFileSync(bootLogPath, "utf-8");
        const match = logText.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
        if (match) {
          domain = match[1];
          break;
        }
      }
    }
  }

  if (domain) {
    const plainNodeLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&fp=firefox&type=ws&host=${domain}&path=%2Fvless-argo%3Fed%3D2560#${NAME}`;
    log(`\n================== VLESS NODE LINK ==================\n${plainNodeLink}\n=====================================================\n`);
  } else {
    log("Error: Failed to fetch Argo domain!");
  }

  // 清理临时日志
  if (fs.existsSync(bootLogPath)) {
    try { fs.unlinkSync(bootLogPath); } catch (e) {}
  }

  // 关键修复：保持 Node.js 进程在前台挂起，防止翼龙面板判定进程结束而无限重启
  setInterval(() => {}, 2147483647);
}

main().catch((err) => console.error("Error:", err));
