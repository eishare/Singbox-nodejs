#!/usr/bin/env node

// ==================== 1. 自定义环境变量配置区（保持置顶） ====================
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";            // 固定隧道域名（留空=临时隧道）
const ARGO_AUTH = process.env.ARGO_AUTH || "";                // 固定隧道Token（留空=临时隧道）

const ARGO_PORT = process.env.ARGO_PORT || 8001;              // Cloudflare 回源端口
const CFIP = process.env.CFIP || "www.visa.com.hk";           // 优选域名/IP
const CFPORT = process.env.CFPORT || 443;                     // 端口
const NAME = process.env.NAME || "Argo_EasyShare";            // 节点名称

const FILE_PATH = process.env.FILE_PATH || ".tmp";
const URL_FILE_PATH = process.env.URL_FILE_PATH || "sub.txt"; // 保存节点链接的文件名

// ==================== 2. Node.js 极限内存控制（强行限制 V8 堆上限 8MB） ====================
if (!process.env.NODE_MAX_MEM_SET) {
  const { spawn } = require("child_process");
  const env = Object.assign({}, process.env, { NODE_MAX_MEM_SET: "true" });
  const child = spawn(process.argv[0], ["--max-old-space-size=8", ...process.argv.slice(1)], {
    env,
    stdio: "inherit"
  });
  child.on("exit", (code) => process.exit(code || 0));
  return;
}

// ==================== 3. 核心依赖引入与全局控制 ====================
const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");

// 极致限制 Go 运行时内存与线程，强迫释放 RSS 物理内存给系统
process.env.GODEBUG = "madvdontneed=1,cgocheck=0";
process.env.GOGC = "5"; // 5% 超激进垃圾回收阈值
process.env.GOMAXPROCS = "1";

const UUID = process.env.UUID || (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
}));

const log = (msg) => process.stdout.write(msg + "\n");

// 低内存占用流式下载
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
        return reject(new Error(`HTTP 状态码异常: ${res.statusCode}`));
      }
      // 使用 8KB 极致超小缓冲区，防止下载时挤爆 RAM 触发 OOM
      const file = fs.createWriteStream(targetPath, { highWaterMark: 1024 * 8 });
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
  throw new Error("提取 sing-box 失败");
}

if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

const webPath = path.join(FILE_PATH, "web");
const botPath = path.join(FILE_PATH, "bot");
const bootLogPath = path.join(FILE_PATH, "boot.log");
const configPath = path.join(FILE_PATH, "config.json");

async function main() {
  // 清理残留进程
  try {
    execSync(`pkill -9 -f ${webPath} || true`);
    execSync(`pkill -9 -f ${botPath} || true`);
  } catch (e) {}

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

  // 步骤 1: 串行下载 sing-box
  if (!fs.existsSync(webPath)) {
    log("正在下载 sing-box 核心...");
    const tempTar = path.join(FILE_PATH, "singbox.tar.gz");
    await downloadFile(singboxTarUrl, tempTar);
    extractSingbox(tempTar, webPath);
    try { fs.unlinkSync(tempTar); } catch (e) {}
  }

  // 步骤 2: 下载 Cloudflared
  if (!fs.existsSync(botPath)) {
    log("正在下载 Cloudflared 核心...");
    await downloadFile(cloudflaredUrl, botPath);
  }

  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);

  log("正在启动 sing-box 服务...");
  // 限制 sing-box 堆内存上限为 4MiB，强制立即归还 OS
  let webProc = spawn(webPath, ["run", "-c", configPath], {
    env: Object.assign({}, process.env, { 
      GOMEMLIMIT: "4MiB",
      GODEBUG: "madvdontneed=1,cgocheck=0" 
    }),
    stdio: "ignore"
  });

  await new Promise((r) => setTimeout(r, 1500));

  // 极限省内存命令行选项：使用 QUIC 协议 + 限制单连接 (--ha-connections 1)
  let argoArgs = [
    "tunnel",
    "--edge-ip-version", "4",
    "--protocol", "quic",
    "--ha-connections", "1",
    "--no-autoupdate",
    "--retries", "3"
  ];

  const authTrim = ARGO_AUTH.trim();

  // 针对 QUIC 优化心跳参数 (心跳从 10s 放宽至 45s)
  if (authTrim.includes("TunnelSecret")) {
    try {
      const jsonAuth = JSON.parse(authTrim);
      const tunnelId = jsonAuth.TunnelID || jsonAuth.tunnel;
      fs.writeFileSync(path.join(FILE_PATH, "tunnel.json"), JSON.stringify(jsonAuth));

      const tunnelYaml = `tunnel: ${tunnelId}
credentials-file: ${path.join(FILE_PATH, "tunnel.json")}
protocol: quic
ha-connections: 1
heartbeat-interval: 45s
keep-alive-timeout: 90s

ingress:
  - hostname: ${ARGO_DOMAIN}
    service: http://127.0.0.1:${ARGO_PORT}
  - service: http_status:404`;

      fs.writeFileSync(path.join(FILE_PATH, "tunnel.yml"), tunnelYaml);
      argoArgs.push("--config", path.join(FILE_PATH, "tunnel.yml"), "run");
    } catch (err) {}
  } else if (authTrim.length > 30) {
    const tokenYaml = `token: ${authTrim}
protocol: quic
ha-connections: 1
heartbeat-interval: 45s
keep-alive-timeout: 90s
ingress:
  - service: http://127.0.0.1:${ARGO_PORT}`;
    
    fs.writeFileSync(path.join(FILE_PATH, "tunnel.yml"), tokenYaml);
    argoArgs.push("--config", path.join(FILE_PATH, "tunnel.yml"), "run");
  } else {
    const tempYaml = `url: http://127.0.0.1:${ARGO_PORT}
logfile: ${bootLogPath}
loglevel: info
heartbeat-interval: 45s
keep-alive-timeout: 90s`;
    
    fs.writeFileSync(path.join(FILE_PATH, "temp_argo.yml"), tempYaml);
    argoArgs.push("--config", path.join(FILE_PATH, "temp_argo.yml"));
  }

  log("正在启动 Cloudflared 隧道 (QUIC 模式)...");
  // 限制 cloudflared 堆内存上限为 6MiB，强制立即归还 OS
  let botProc = spawn(botPath, argoArgs, {
    env: Object.assign({}, process.env, { 
      GOMEMLIMIT: "6MiB",
      GODEBUG: "madvdontneed=1,cgocheck=0" 
    }),
    stdio: "ignore"
  });

  // 获取临时域名
  let domain = ARGO_DOMAIN;
  if (!domain) {
    log("正在获取 Argo 临时域名...");
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
    log(`\n================== VLESS 节点链接 ==================\n${plainNodeLink}\n===================================================\n`);
    
    try {
      fs.writeFileSync(URL_FILE_PATH, plainNodeLink, "utf-8");
      log(`[成功] 节点链接已保存至 ${URL_FILE_PATH}`);
    } catch (e) {
      log(`[错误] 保存节点链接失败: ${e.message}`);
    }
  } else {
    log("[错误] 获取 Argo 临时域名失败！");
  }

  // 清除二进制文件与日志释放磁盘
  setTimeout(() => {
    try {
      if (fs.existsSync(webPath)) fs.unlinkSync(webPath);
      if (fs.existsSync(botPath)) fs.unlinkSync(botPath);
      if (fs.existsSync(bootLogPath)) fs.unlinkSync(bootLogPath);
      log("二进制文件与临时日志已清除，磁盘空间已释放！");
    } catch (e) {}
  }, 3000);

  // 轻量级 Node.js 本地 HTTP 探针，4分钟唤醒一次
  setInterval(() => {
    http.get(`http://127.0.0.1:${ARGO_PORT}`, (res) => {
      res.resume();
    }).on("error", () => {});
  }, 240000);

  const cleanup = () => {
    try { webProc.kill("SIGKILL"); } catch (e) {}
    try { botProc.kill("SIGKILL"); } catch (e) {}
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  process.stdin.resume();
}

main().catch(() => {
  process.exit(1);
});
