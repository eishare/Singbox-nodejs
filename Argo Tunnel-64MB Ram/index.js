#!/usr/bin/env node

const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";            // 固定隧道域名（留空=临时隧道）
const ARGO_AUTH = process.env.ARGO_AUTH || "";                // 固定隧道 Token（留空=临时隧道）

const ARGO_PORT = process.env.ARGO_PORT || 8001;              // Cloudflare 回源端口
const CFIP = process.env.CFIP || "www.visa.com.hk";           // 优选域名/IP
const CFPORT = process.env.CFPORT || 443;                     // 端口
const NAME = process.env.NAME || "Argo_EasyShare";            // 节点名称

const FILE_PATH = process.env.FILE_PATH || ".tmp";

const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");

// 限制 Go 运行时内存与线程，开启高效 GC
process.env.GODEBUG = "madvdontneed=1,cgocheck=0";
process.env.GOGC = "20";
process.env.GOMAXPROCS = "1";

const UUID = process.env.UUID || (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
}));

const log = (msg) => process.stdout.write(msg + "\n");

function downloadFile(urlStr, targetPath) {
  return new Promise((resolve, reject) => {
    const client = urlStr.startsWith("https") ? https : http;
    const req = client.get(urlStr, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        req.destroy();
        return downloadFile(res.headers.location, targetPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        req.destroy();
        return reject(new Error(`HTTP Status ${res.statusCode}`));
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
      try { fs.unlinkSync(targetPath); } catch (e) {}
      reject(err);
    });
  });
}

function extractSingbox(tarPath, targetWebPath) {
  try {
    execSync(`tar -xzf "${tarPath}" -C "${FILE_PATH}" --wildcards "*/sing-box" --strip-components=1 || tar -xzf "${tarPath}" -C "${FILE_PATH}" sing-box`);
    const extractedPath = path.join(FILE_PATH, "sing-box");
    if (fs.existsSync(extractedPath)) {
      if (extractedPath !== targetWebPath) fs.renameSync(extractedPath, targetWebPath);
      return;
    }
  } catch (e) {}
  throw new Error("Failed to extract sing-box");
}

if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

const webPath = path.join(FILE_PATH, "web");
const botPath = path.join(FILE_PATH, "bot");
const bootLogPath = path.join(FILE_PATH, "boot.log");
const configPath = path.join(FILE_PATH, "config.json");

async function main() {
  try {
    if (fs.existsSync("web")) fs.unlinkSync("web");
    if (fs.existsSync("bot")) fs.unlinkSync("bot");
  } catch (e) {}

  try {
    execSync(`pkill -9 -f ${webPath} || true`);
    execSync(`pkill -9 -f ${botPath} || true`);
  } catch (e) {}

  // 核心修复点：剔除 early_data_header_name 强限制，完全对齐 Xray 纯净 WS 监听
  const config = {
    log: { level: "panic" },
    inbounds: [{
      type: "vless",
      tag: "vless-in",
      listen: "127.0.0.1",
      listen_port: parseInt(ARGO_PORT),
      users: [{ uuid: UUID }],
      transport: {
        type: "ws",
        path: "/vless-argo"
      }
    }],
    outbounds: [{ type: "direct", tag: "direct" }]
  };
  fs.writeFileSync(configPath, JSON.stringify(config));

  const isArm = ["arm", "arm64", "aarch64"].includes(os.arch());
  const cloudflaredUrl = isArm
    ? "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    : "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";

  const SINGBOX_VER = "1.11.4";
  const singboxTarUrl = isArm
    ? `https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VER}/sing-box-${SINGBOX_VER}-linux-arm64.tar.gz`
    : `https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VER}/sing-box-${SINGBOX_VER}-linux-amd64.tar.gz`;

  if (!fs.existsSync(webPath)) {
    log("Downloading sing-box...");
    const tempTar = path.join(FILE_PATH, "singbox.tar.gz");
    await downloadFile(singboxTarUrl, tempTar);
    extractSingbox(tempTar, webPath);
    try { fs.unlinkSync(tempTar); } catch (e) {}
  }

  if (!fs.existsSync(botPath)) {
    log("Downloading Cloudflared...");
    await downloadFile(cloudflaredUrl, botPath);
  }

  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);

  log(`UUID: ${UUID}`);

  log("Starting sing-box...");
  const webProc = spawn(webPath, ["run", "-c", configPath], {
    env: Object.assign({}, process.env, { GOMEMLIMIT: "4MiB" }),
    stdio: "inherit"
  });

  await new Promise((r) => setTimeout(r, 1500));

  // 1:1 还原 Xray 版完全一致的 argoArgs
  let argoArgs = [
    "tunnel",
    "--edge-ip-version", "4",
    "--protocol", "http2",
    "--no-autoupdate",
    "--retries", "3"
  ];

  const authTrim = ARGO_AUTH.trim();

  if (authTrim.includes("TunnelSecret")) {
    try {
      const jsonAuth = JSON.parse(authTrim);
      const tunnelId = jsonAuth.TunnelID || jsonAuth.tunnel;
      fs.writeFileSync(path.join(FILE_PATH, "tunnel.json"), JSON.stringify(jsonAuth));

      const tunnelYaml = `tunnel: ${tunnelId}
credentials-file: ${path.join(FILE_PATH, "tunnel.json")}
protocol: http2

ingress:
  - hostname: ${ARGO_DOMAIN}
    service: http://127.0.0.1:${ARGO_PORT}
  - service: http_status:404`;

      fs.writeFileSync(path.join(FILE_PATH, "tunnel.yml"), tunnelYaml);
      argoArgs.push("--config", path.join(FILE_PATH, "tunnel.yml"), "run");
    } catch (err) {
      log(`Error parsing ARGO_AUTH JSON: ${err.message}`);
    }
  } else if (authTrim.length > 30) {
    argoArgs.push("run", "--url", `http://127.0.0.1:${ARGO_PORT}`, "--token", authTrim);
  } else {
    argoArgs.push("--logfile", bootLogPath, "--loglevel", "info", "--url", `http://127.0.0.1:${ARGO_PORT}`);
  }

  log("Starting Cloudflared...");
  const botProc = spawn(botPath, argoArgs, {
    env: Object.assign({}, process.env, { GOMEMLIMIT: "8MiB" }),
    stdio: "inherit"
  });

  webProc.on("error", (err) => log(`sing-box Launch Error: ${err.message}`));
  botProc.on("error", (err) => log(`Cloudflared Launch Error: ${err.message}`));

  webProc.on("exit", (code, signal) => log(`sing-box stopped (code: ${code}, signal: ${signal})`));
  botProc.on("exit", (code, signal) => log(`Cloudflared stopped (code: ${code}, signal: ${signal})`));

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
    const plainNodeLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&fp=chrome&type=ws&host=${domain}&path=%2Fvless-argo#${NAME}`;
    log(`\n================== VLESS NODE LINK ==================\n${plainNodeLink}\n=====================================================\n`);
  } else {
    log("Error: Failed to fetch Argo domain!");
  }

  if (fs.existsSync(bootLogPath)) {
    try { fs.unlinkSync(bootLogPath); } catch (e) {}
  }

  const cleanup = () => {
    try { webProc.kill("SIGKILL"); } catch (e) {}
    try { botProc.kill("SIGKILL"); } catch (e) {}
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  process.stdin.resume();
}

main().catch((err) => {
  console.error("Fatal Main Error:", err);
  process.exit(1);
});
