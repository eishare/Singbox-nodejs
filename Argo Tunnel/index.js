#!/usr/bin/env node

const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";                   // 固定隧道域名（留空=临时隧道）
const ARGO_AUTH = process.env.ARGO_AUTH || "";                       // 固定隧道Token（留空=临时隧道）

const ARGO_PROTOCOL = process.env.ARGO_PROTOCOL || "quic";           // http2或quic（http2=稳定+低占用；quic=响应快+占用略高）
const ARGO_CONNECTIONS = process.env.ARGO_CONNECTIONS || "1";        // 隧道连接数量 建议http2=4，quic=1（多条UDP可能会触发机房QoS）

const ARGO_PORT = process.env.ARGO_PORT || 8001;                     // Cloudflare回源端口，与服务URL末尾端口一致
const CFIP = process.env.CFIP || "www.wto.org";                      // 优选域名/IP
const CFPORT = process.env.CFPORT || 443;                            // 端口
const NAME = process.env.NAME || "Argo_easyshare";              

const FILE_PATH = process.env.FILE_PATH || ".tmp";
const URL_FILE_PATH = process.env.URL_FILE_PATH || "sub.txt"; 

const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");

const iataToCountry = {
  HKG: "HK", TPE: "TW", NRT: "JP", HND: "JP", KIX: "JP", ICN: "KR", SIN: "SG", BKK: "TH",
  KUL: "MY", MNL: "PH", CGK: "ID", HAN: "VN", SGN: "VN", DEL: "IN", BOM: "IN", SYD: "AU", MEL: "AU",
  CDG: "FR", LHR: "GB", FRA: "DE", AMS: "NL", ZRH: "CH", HEL: "FI", MAD: "ES", FCO: "IT",
  LAX: "US", SJC: "US", JFK: "US", SEA: "US", ORD: "US", SFO: "US", DFW: "US", IAD: "US", YVR: "CA", YYZ: "CA"
};

const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

function getLocationInfo(code) {
  const iata = code.substring(0, 3).toUpperCase();
  const countryCode = iataToCountry[iata];
  
  if (countryCode) {
    try {
      const countryName = regionNames.of(countryCode);
      return `${countryName} (${iata})`;
    } catch (e) {}
  }
  return `${iata} 节点`;
}

let containerMem = 0;
try {
  const limitStr = fs.existsSync("/sys/fs/cgroup/memory.max") ? fs.readFileSync("/sys/fs/cgroup/memory.max", "utf-8") : fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf-8");
  containerMem = Math.floor(parseInt(limitStr.trim(), 10) / 1024 / 1024);
} catch (e) {}
const totalMemMB = (containerMem > 0 && containerMem < 10000) ? containerMem : Math.floor(os.totalmem() / 1024 / 1024);

let singboxMemLimit, cloudflaredMemLimit, dynamicGOGC, dynamicProcs;

if (totalMemMB <= 160) {
  singboxMemLimit = "45MiB";
  cloudflaredMemLimit = "80MiB";
  dynamicGOGC = "80";     
  dynamicProcs = "1";     

} else if (totalMemMB < 256) {
  singboxMemLimit = "80MiB";
  cloudflaredMemLimit = "140MiB";
  dynamicGOGC = "100";
  dynamicProcs = "2";

} else if (totalMemMB < 320) {
  singboxMemLimit = "128MiB";
  cloudflaredMemLimit = "220MiB";
  dynamicGOGC = "100";    
  dynamicProcs = "2";     

} else if (totalMemMB < 448) {
  singboxMemLimit = "160MiB";
  cloudflaredMemLimit = "320MiB";
  dynamicGOGC = "100";
  dynamicProcs = "2";

} else if (totalMemMB < 576) {
  singboxMemLimit = "200MiB";
  cloudflaredMemLimit = "400MiB";
  dynamicGOGC = "100";
  dynamicProcs = "2";

} else {
  singboxMemLimit = "384MiB";
  cloudflaredMemLimit = "768MiB";
  dynamicGOGC = "100";    
  dynamicProcs = process.env.GOMAXPROCS || "4"; 
}

const GO_BASE_ENV = {
  ...process.env,
  GODEBUG: "madvdontneed=1,cgocheck=0,netdns=go",
  GOMAXPROCS: process.env.GOMAXPROCS || dynamicProcs,
  GOGC: process.env.GOGC || dynamicGOGC
};

const isFixedTunnelEnv = ARGO_AUTH.trim().length > 30 || ARGO_DOMAIN.trim().length > 0;
const uuidFilePath = path.join(FILE_PATH, "uuid.txt");

let rawUUID = process.env.UUID;

if (isFixedTunnelEnv && !rawUUID && fs.existsSync(uuidFilePath)) {
  try {
    rawUUID = fs.readFileSync(uuidFilePath, "utf-8").trim();
  } catch (e) {}
}

if (!rawUUID) {
  rawUUID = (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  }));

  if (isFixedTunnelEnv) {
    try {
      if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });
      fs.writeFileSync(uuidFilePath, rawUUID, "utf-8");
    } catch (e) {}
  }
}

const UUID = rawUUID.toLowerCase();
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

function saveAndOutputNodeLink(domain) {
  const encodedPath = encodeURIComponent(WS_PATH);
  const plainNodeLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&fp=chrome&type=ws&host=${domain}&path=${encodedPath}#${NAME}`;
  log(`\n================== Argo Vless 节点链接 ==================\n${plainNodeLink}\n===================================================\n`);

  try {
    fs.writeFileSync(URL_FILE_PATH, plainNodeLink, "utf-8");
    log(`[成功！] 节点链接已保存至 ${URL_FILE_PATH}`);
  } catch (e) {
    log(`[错误！] 保存节点链接失败: ${e.message}`);
  }
}

if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

const webPath = path.join(FILE_PATH, "web");
const botPath = path.join(FILE_PATH, "bot");
const bootLogPath = path.join(FILE_PATH, "boot.log");
const configPath = path.join(FILE_PATH, "config.json");

async function main() {
  try { execSync("pkill -9 -f sing-box", { stdio: "ignore" }); } catch (e) {}
  try { execSync("pkill -9 -f cloudflared", { stdio: "ignore" }); } catch (e) {}
  try { execSync("rm -rf /tmp/*", { stdio: "ignore" }); } catch (e) {}
  try { execSync("sleep 1"); } catch (e) {}
  log("[环境重置] 历史进程与临时文件已清理");

  if (fs.existsSync(bootLogPath)) {
    try { fs.unlinkSync(bootLogPath); } catch (e) {}
  }

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
        path: WS_PATH,
        max_early_data: 4096,
        early_data_header_name: "Sec-WebSocket-Protocol"
      }
    }],
    outbounds: [{ 
      type: "direct", 
      tag: "direct",
      udp_fragment: true
    }],
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

  log(`正在启动 sing-box 服务...`);
  let webProc = spawn(webPath, ["run", "-c", configPath], {
    env: Object.assign({}, GO_BASE_ENV, { GOMEMLIMIT: singboxMemLimit }), 
    stdio: ["ignore", "ignore", "pipe"],
    detached: true
  });

  webProc.stderr.on("data", (data) => {
    log(`[sing-box 报错]: ${data.toString().trim()}`);
  });

  await new Promise((r) => setTimeout(r, 1000));

  const authTrim = ARGO_AUTH.trim();
  const isFixedTunnel = authTrim.length > 30;

  let argoArgs = [
    "tunnel",
    "--no-autoupdate",
    "--protocol", ARGO_PROTOCOL.toLowerCase(),
    "--ha-connections", String(ARGO_CONNECTIONS),
    "--loglevel", "info"
  ];

  if (isFixedTunnel) {
    log(`检测到 Token，启动固定隧道 [协议:${ARGO_PROTOCOL} | 连接数:${ARGO_CONNECTIONS}]...`);
    argoArgs.push("run", "--token", authTrim);
  } else {
    log(`未检测到 Token，启动临时隧道...`);
    argoArgs.push("--url", `http://127.0.0.1:${ARGO_PORT}`);
  }

  log(`正在启动 Cloudflared 隧道...`);
  let botProc = spawn(botPath, argoArgs, {
    env: Object.assign({}, GO_BASE_ENV, { GOMEMLIMIT: cloudflaredMemLimit }), 
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });

  let hasOutputLink = false;

  if (isFixedTunnel) {
    const domain = ARGO_DOMAIN.trim();
    if (domain) {
      saveAndOutputNodeLink(domain);
      hasOutputLink = true;
    }
  }

  botProc.stderr.on("data", (data) => {
    const msg = data.toString();

    if (!isFixedTunnel && !hasOutputLink) {
      const domainMatch = msg.match(/https:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/);
      if (domainMatch && domainMatch[1]) {
        const tempDomain = domainMatch[1];
        saveAndOutputNodeLink(tempDomain);
        hasOutputLink = true;
      }
    }

    const regMatch = msg.match(/Registered tunnel connection.*location=([a-z0-9]+).*protocol=([a-z0-9]+)/i);
    if (regMatch) {
      const rawLocation = regMatch[1];
      const proto = regMatch[2].toUpperCase();
      const locationText = getLocationInfo(rawLocation);
      log(`[Cloudflare CDN] 节点连通 ➔ 地区: ${locationText} | 协议: ${proto}`);
      return;
    }

    if (msg.includes("ERR") || msg.includes("CRIT")) {
      log(`[Cloudflared 异常]: ${msg.trim()}`);
    }
  });

  webProc.on("exit", (code) => {
    log(`[警告] sing-box 进程退出，退出码: ${code}`);
  });
  botProc.on("exit", (code) => {
    log(`[警告] Cloudflared 进程退出，退出码: ${code}`);
  });

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
  console.error(`[致命错误] 主流程运行报错: ${err.message}`);
  process.exit(1);
});
