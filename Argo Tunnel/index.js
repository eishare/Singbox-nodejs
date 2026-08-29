#!/usr/bin/env node

const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";                // 固定隧道域名（留空=临时隧道）
const ARGO_AUTH = process.env.ARGO_AUTH || "";                    // 固定隧道Token（留空=临时隧道）

const ARGO_PROTOCOL = process.env.ARGO_PROTOCOL || "http2";       // 隧道协议默认 http2（TCP）更稳；quic（UDP）仅作测试用
const ARGO_CONNECTIONS = process.env.ARGO_CONNECTIONS || "4";     // Argo隧道连接数 默认4高性能，（1的占用最低，但抗抖动差)
const ARGO_PORT = process.env.ARGO_PORT || 8001;                  // Cloudflare回源端口
const CFIP = process.env.CFIP || "www.visa.com.hk";               // 优选域名/IP
const CFPORT = process.env.CFPORT || 443;                         // 端口
const NAME = process.env.NAME || "Argo_EasyShare";            

const FILE_PATH = process.env.FILE_PATH || ".tmp";
const URL_FILE_PATH = process.env.URL_FILE_PATH || "sub.txt"; 

const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");

process.env.GODEBUG = "madvdontneed=1,cgocheck=0";
process.env.GOGC = "50"; 
delete process.env.GOMAXPROCS;

const UUID = process.env.UUID || (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
}));

const WS_PATH = `/${UUID}-vless`;

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
        return reject(new Error(`HTTP 状态码异常: ${res.statusCode}`));
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
  throw new Error("提取 sing-box 失败");
}

if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

const webPath = path.join(FILE_PATH, "web");
const botPath = path.join(FILE_PATH, "bot");
const bootLogPath = path.join(FILE_PATH, "boot.log");
const configPath = path.join(FILE_PATH, "config.json");
const argoYamlPath = path.join(FILE_PATH, "argo.yml");

async function main() {
  try {
    if (process.platform !== "win32") {
      execSync(`kill -9 $(pgrep -f ${webPath}) 2>/dev/null || true`);
      execSync(`kill -9 $(pgrep -f ${botPath}) 2>/dev/null || true`);
    }
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
        path: WS_PATH
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
    log("正在下载 sing-box...");
    const tempTar = path.join(FILE_PATH, "singbox.tar.gz");
    await downloadFile(singboxTarUrl, tempTar);
    extractSingbox(tempTar, webPath);
    try { fs.unlinkSync(tempTar); } catch (e) {}
  }

  if (!fs.existsSync(botPath)) {
    log("正在下载 Cloudflared...");
    await downloadFile(cloudflaredUrl, botPath);
  }

  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);

  log("正在启动 sing-box 服务...");
  let webProc = spawn(webPath, ["run", "-c", configPath], {
    env: Object.assign({}, process.env, { GOMEMLIMIT: "30MiB" }),
    stdio: "ignore"
  });

  await new Promise((r) => setTimeout(r, 1500));

  const authTrim = ARGO_AUTH.trim();
  
  const argoYamlContent = `url: http://127.0.0.1:${ARGO_PORT}
protocol: ${ARGO_PROTOCOL.toLowerCase()}
ha-connections: ${ARGO_CONNECTIONS}
logfile: ${bootLogPath}
loglevel: info`;

  fs.writeFileSync(argoYamlPath, argoYamlContent, "utf-8");

  let argoArgs = ["tunnel", "--no-autoupdate", "--config", argoYamlPath, "run"];

  if (authTrim.length > 30) {
    log(`检测到固定 Token，启动固定隧道 [协议:${ARGO_PROTOCOL} | 连接数:${ARGO_CONNECTIONS}]...`);

    argoArgs.push("--token", authTrim);
  } else {
    log(`未检测到有效固定 Auth Token，启动临时隧道 [协议:${ARGO_PROTOCOL} | 连接数:${ARGO_CONNECTIONS}]...`);
  }

  log("正在启动 Cloudflared 隧道...");
  let botProc = spawn(botPath, argoArgs, {
    env: Object.assign({}, process.env, { GOMEMLIMIT: "45MiB" }),
    stdio: "ignore"
  });

  webProc.on("exit", () => process.exit(1));
  botProc.on("exit", () => process.exit(1));

  let domain = ARGO_DOMAIN;
  if (!domain) {
    log("正在获取 Argo 临时域名...");
    for (let i = 0; i < 20; i++) {
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

    const plainNodeLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&fp=chrome&type=ws&host=${domain}&path=${WS_PATH}#${NAME}`;
    log(`\n================== Argo Vless 节点链接 ==================\n${plainNodeLink}\n===================================================\n`);
    
    try {
      fs.writeFileSync(URL_FILE_PATH, plainNodeLink, "utf-8");
      log(`[成功！] 节点链接已保存至 ${URL_FILE_PATH}`);
    } catch (e) {
      log(`[错误！] 保存节点链接失败: ${e.message}`);
    }
  } else {
    log("[错误！] 获取 Argo 临时域名失败！");
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

main().catch(() => {
  process.exit(1);
});
