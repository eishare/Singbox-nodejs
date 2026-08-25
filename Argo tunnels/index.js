#!/usr/bin/env node

const ARGO_DOMAIN = (process.env.ARGO_DOMAIN || "l.isshare.dpdns.org").trim();            // 固定隧道域名（留空=临时）
const ARGO_AUTH = (process.env.ARGO_AUTH || "eyJhIjoiNTZjZGYzNDgxZDMzMWNjMzdiYmFlNDQ4NTM2MmYxMGEiLCJ0IjoiMTIxZGUyNWEtMTJiOS00MWU1LTgzNWMtYzdkZDBhN2QwOGI2IiwicyI6IllUTXhZbU01T1dVdE9USTBZeTAwWldFMExUbGhaV0V0TWpsaU5XUXlPRGRrWlROayJ9").trim();                // 固定隧道Token（留空=临时）

const ARGO_PORT = process.env.ARGO_PORT || 8001;               // Cloudflare回源内部端口（请保持与Cloudflare后台设置一致）
const CFIP = process.env.CFIP || "saas.sin.fan";              // 优选域名/IP
const CFPORT = process.env.CFPORT || 443;                      // 端口
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
  // 1. 写入最小化 Xray 配置（监听 0.0.0.0 避免翼龙面板容器内部 127.0.0.1 隔离）
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

  log("Downloading Xray & Cloudflared binaries...");
  await downloadFile(`${baseUrl}/web`, webPath);
  await downloadFile(`${baseUrl}/bot`, botPath);
  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);

  log(`UUID: ${UUID}`);

  // 3. 启动 Xray 进程，增加日志输出以便检测错误
  const xrayLogPath = path.join(FILE_PATH, "xray_err.log");
  exec(`GOMEMLIMIT=12MiB ${webPath} -c ${FILE_PATH}/config.json > ${xrayLogPath} 2>&1 &`);

  // 4. 组装 Cloudflared 启动参数（强制 --protocol http2 针对翼龙面板优化）
  let argoArgs = `--no-autoupdate `;
  if (ARGO_AUTH.match(/^[A-Z0-9a-z=_-]{120,300}$/)) {
    argoArgs += `tunnel --edge-ip-version 4 --protocol http2 run --token ${ARGO_AUTH}`;
  } else if (ARGO_AUTH.includes("TunnelSecret")) {
    fs.writeFileSync(path.join(FILE_PATH, "tunnel.json"), ARGO_AUTH);
    const tunnelYaml = `tunnel: ${ARGO_AUTH.split('"')[11]}\ncredentials-file: ${path.join(FILE_PATH, "tunnel.json")}\ningress:\n  - hostname: ${ARGO_DOMAIN}\n    service: http://127.0.0.1:${ARGO_PORT}\n  - service: http_status:404`;
    fs.writeFileSync(path.join(FILE_PATH, "tunnel.yml"), tunnelYaml);
    argoArgs += `tunnel --config ${FILE_PATH}/tunnel.yml run`;
  } else {
    argoArgs += `tunnel --edge-ip-version 4 --protocol http2 --logfile ${bootLogPath} --loglevel info --url http://127.0.0.1:${ARGO_PORT}`;
  }

  // 启动 Argo 进程并将日志重定向到文件以便排查
  const argoLogPath = path.join(FILE_PATH, "argo_err.log");
  exec(`GOMEMLIMIT=20MiB ${botPath} ${argoArgs} > ${argoLogPath} 2>&1 &`);
  log("Processes started.");

  // 检查并打印 Xray & Cloudflared 启动状态
  setTimeout(() => {
    if (fs.existsSync(xrayLogPath)) {
      const xrayErr = fs.readFileSync(xrayLogPath, "utf-8").trim();
      if (xrayErr) log(`\n=== Xray Status/Error ===\n${xrayErr}\n=========================\n`);
    }
    if (fs.existsSync(argoLogPath)) {
      log("\n=== Cloudflared Tunnel Log ===");
      log(fs.readFileSync(argoLogPath, "utf-8").trim());
      log("==============================\n");
    }
  }, 4000);

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
    const plainNodeLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&fp=firefox&type=ws&host=${domain}&path=/vless-argo#${NAME}`;
    log(`================== VLESS NODE LINK ==================\n${plainNodeLink}\n=====================================================\n`);
  } else {
    log("Error: Failed to fetch Argo domain!");
  }

  // 保持 Node.js 进程在前台挂起
  setInterval(() => {}, 2147483647);
}

main().catch((err) => console.error("Error:", err));
