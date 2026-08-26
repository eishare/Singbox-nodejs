#!/usr/bin/env node

const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";            // 固定隧道域名（留空=临时隧道）
const ARGO_AUTH = process.env.ARGO_AUTH || "";                // 固定隧道Token（留空=临时隧道）

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
const { spawn, execSync } = require("child_process");

// 限制 Go 运行时内存与线程
process.env.GODEBUG = "madvdontneed=1,cgocheck=0";
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
      try { fs.unlinkSync(targetPath); } catch (e) {}
      reject(err);
    });
  });
}

// 确保所有临时文件都严格保存在 FILE_PATH (.tmp) 目录下
if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

const webPath = path.join(FILE_PATH, "web");
const botPath = path.join(FILE_PATH, "bot");
const bootLogPath = path.join(FILE_PATH, "boot.log");
const configPath = path.join(FILE_PATH, "config.json");

async function main() {
  // 0. 清理可能遗留在根目录的旧文件，保持根目录整洁
  try {
    if (fs.existsSync("web")) fs.unlinkSync("web");
    if (fs.existsSync("bot")) fs.unlinkSync("bot");
  } catch (e) {}

  // 1. 尝试清理遗留进程
  try {
    execSync(`pkill -9 -f ${webPath} || true`);
    execSync(`pkill -9 -f ${botPath} || true`);
  } catch (e) {}

  // 2. 写入 Xray 配置到 .tmp 文件夹
  const config = {
    log: { access: "/dev/null", error: "/dev/null", loglevel: "none" },
    inbounds: [{
      port: parseInt(ARGO_PORT), listen: "127.0.0.1", protocol: "vless",
      settings: { clients: [{ id: UUID }], decryption: "none" },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }
    }],
    outbounds: [{ protocol: "freedom" }]
  };
  fs.writeFileSync(configPath, JSON.stringify(config));

  // 3. 下载二进制文件到 .tmp 文件夹内部
  const isArm = ["arm", "arm64", "aarch64"].includes(os.arch());
  const baseUrl = isArm ? "https://arm64.ssss.nyc.mn" : "https://amd64.ssss.nyc.mn";

  log("Downloading binaries into .tmp...");
  await downloadFile(`${baseUrl}/web`, webPath);
  await downloadFile(`${baseUrl}/bot`, botPath);
  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);

  log(`UUID: ${UUID}`);

  // 4. 启动 Xray 进程
  log("Starting Xray...");
  const webProc = spawn(webPath, ["-c", configPath], {
    env: Object.assign({}, process.env, { GOMEMLIMIT: "6MiB" }),
    stdio: "ignore"
  });

  await new Promise((r) => setTimeout(r, 1500));

  // 5. 组装 Cloudflared 参数 (http2)
  let argoArgs = [
    "tunnel",
    "--edge-ip-version", "4",
    "--protocol", "http2",
    "--no-autoupdate",
    "--retries", "3"
  ];
  
  if (ARGO_AUTH.match(/^[A-Z0-9a-z=_-]{120,250}$/)) {
    argoArgs.push("run", "--url", `http://127.0.0.1:${ARGO_PORT}`, "--token", ARGO_AUTH);
  } else if (ARGO_AUTH.includes("TunnelSecret")) {
    try {
      const jsonAuth = JSON.parse(ARGO_AUTH);
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
  } else {
    argoArgs.push("--logfile", bootLogPath, "--loglevel", "info", "--url", `http://127.0.0.1:${ARGO_PORT}`);
  }

  // 启动 Cloudflared 进程
  log("Starting Cloudflared (http2)...");
  const botProc = spawn(botPath, argoArgs, {
    env: Object.assign({}, process.env, { GOMEMLIMIT: "10MiB" }),
    stdio: "ignore"
  });

  webProc.on("error", (err) => log(`Xray Launch Error: ${err.message}`));
  botProc.on("error", (err) => log(`Cloudflared Launch Error: ${err.message}`));

  webProc.on("exit", (code, signal) => log(`Xray stopped (code: ${code}, signal: ${signal})`));
  botProc.on("exit", (code, signal) => log(`Cloudflared stopped (code: ${code}, signal: ${signal})`));

  // 6. 获取隧道域名并打印节点
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

  // 清理临时日志文件
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
