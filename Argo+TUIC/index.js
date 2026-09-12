#!/usr/bin/env node


// ====================== TUIC 设置区 ======================

const TUIC_PORT = process.env.TUIC_PORT || "";                       // TUIC直连端口，填入端口即部署，留空则不部署


// ==================== Argo隧道 设置区 ====================

const ARGO_PORT = process.env.ARGO_PORT || "";                       // Argo回源端口，设为8001或其他端口=启用Argo；留空=不部署

const ARGO_PROTOCOL = process.env.ARGO_PROTOCOL || "quic";           // http2或quic

const ARGO_CONNECTIONS = process.env.ARGO_CONNECTIONS || "1";        // 隧道连接数量

const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";                   // 固定隧道域名（留空=临时隧道）

const ARGO_AUTH = process.env.ARGO_AUTH || "";                       // 固定隧道Token（留空=临时隧道）

const CFIP = process.env.CFIP || "www.wto.org";                      // 优选域名/IP

// ====================== 变量设置完成 ======================



const CFPORT = process.env.CFPORT || 443;                           
const NAME = process.env.NAME || "easyshare";                     
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

// 内存与性能监控及限制分级
let containerMem = 0;
try {
  const limitStr = fs.existsSync("/sys/fs/cgroup/memory.max") ? fs.readFileSync("/sys/fs/cgroup/memory.max", "utf-8") : fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf-8");
  containerMem = Math.floor(parseInt(limitStr.trim(), 10) / 1024 / 1024);
} catch (e) {}
const totalMemMB = (containerMem > 0 && containerMem < 10000) ? containerMem : Math.floor(os.totalmem() / 1024 / 1024);

let singboxMemLimit, cloudflaredMemLimit, dynamicGOGC, dynamicProcs;

if (totalMemMB <= 160) {
  singboxMemLimit = "38MiB";
  cloudflaredMemLimit = "65MiB";
  dynamicGOGC = "180";     
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

function getPublicIP() {
  try {
    return execSync("curl -s --max-time 2 ipv4.ip.sb || curl -s --max-time 1 api.ipify.org", { encoding: "utf-8" }).trim();
  } catch (e) {
    return "IP_ERROR";
  }
}

function generateCertificates(keyPath, certPath) {
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return;
  try {
    execSync(`openssl ecparam -genkey -name prime256v1 -out "${keyPath}" 2>/dev/null && openssl req -new -x509 -days 3650 -key "${keyPath}" -out "${certPath}" -subj "/CN=bing.com" 2>/dev/null`);
    fs.chmodSync(keyPath, 0o600);
  } catch (e) {
    const defaultKey = `-----BEGIN EC PARAMETERS-----\nBgqghkjOPQQBw==\n-----END EC PARAMETERS-----\n-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIM4792SEtPqIt1ywqTd/0bYidBqpYV/+siNnfBYsdUYsAoGCCqGSM49\nAwEHoUQDQgAE1kHafPj07rJG+HboH2ekAI4r+e6TL38GWASAnngZreoQDF16ARa\n/TsyLyFoPkhTxSbehH/OBEjHtSZGaDhMqQ==\n-----END EC PRIVATE KEY-----`;
    const defaultCert = `-----BEGIN CERTIFICATE-----\nMIIBejCCASGgAwIBAgIUFWeQL3556PNJLp/veCFxGNj9crkwCgYIKoZIzj0EAwIw\nEzERMA8GA1UEAwwIYmluZy5jb20wHhcNMjUwMTAxMDEwMTAwWhcNMzUwMTAxMDEw\nMTAwWjATMREwDwYDVQQDDAhiaW5nLmNvbTBNBgqgGzM9AgEGCCqGSM49AwEHA0IA\nBNZB2nz49O6yRvh26B9npACOK/nuky9/BlgEgDZ54Ga3qEAxdeWv07Mi8h\nd5IR8Um3oR/zQRIx7UmRmg4TKmjUzBRMB0GA1UdDgQWBQTV1cFID7UISE7PLTBR\nBfGbgrkMNzAfBgNVHSMEGDAWgBTV1cFID7UISE7PLTBRBfGbgrkMNzAPBgNVHRMB\nAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIARDAJvg0vd/ytrQVvEcSm6XTlB+\neQ6OFb9LbLYL9Zi+AiffoMbi4y/0YUQlTtz7as9S8/lciBF5VCUoVIKS+vX2g==\n-----END CERTIFICATE-----`;
    fs.writeFileSync(keyPath, defaultKey);
    fs.writeFileSync(certPath, defaultCert);
    fs.chmodSync(keyPath, 0o600);
  }
}

if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

const webPath = path.join(FILE_PATH, "web");
const botPath = path.join(FILE_PATH, "bot");
const bootLogPath = path.join(FILE_PATH, "boot.log");
const configPath = path.join(FILE_PATH, "config.json");
const certPath = path.join(FILE_PATH, "cert.pem");
const keyPath = path.join(FILE_PATH, "private.key");

async function main() {
  const enableArgo = Boolean(ARGO_PORT && String(ARGO_PORT).trim() !== "" && String(ARGO_PORT).trim() !== "0");
  const enableTuic = Boolean(TUIC_PORT && String(TUIC_PORT).trim() !== "" && String(TUIC_PORT).trim() !== "0");

  if (!enableArgo && !enableTuic) {
    log("[退出] 未检测到有效的 ARGO_PORT 或 TUIC_PORT 配置，放弃部署并退出。");
    process.exit(0);
  }

  try { execSync("pkill -9 -f sing-box", { stdio: "ignore" }); } catch (e) {}
  try { execSync("pkill -9 -f cloudflared", { stdio: "ignore" }); } catch (e) {}
  try { execSync("rm -rf /tmp/*", { stdio: "ignore" }); } catch (e) {}
  try { execSync("sleep 1"); } catch (e) {}
  log("[环境重置] 历史进程与临时文件已清理");

  if (fs.existsSync(bootLogPath)) {
    try { fs.unlinkSync(bootLogPath); } catch (e) {}
  }

  const inbounds = [];

  // 1. 如果配置了 Argo 端口，添加 VLESS-WS inbound
  if (enableArgo) {
    inbounds.push({
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
    });
  }

  // 2. 如果配置了 TUIC 端口，生成证书并添加 TUIC inbound
  if (enableTuic) {
    generateCertificates(keyPath, certPath);
    inbounds.push({
      type: "tuic",
      tag: "tuic-in",
      listen: "::",
      listen_port: parseInt(TUIC_PORT),
      users: [{ uuid: UUID, password: "admin" }],
      congestion_control: "bbr",
      tls: {
        enabled: true,
        alpn: ["h3"],
        certificate_path: certPath,
        key_path: keyPath
      }
    });
  }

  const config = {
    log: { level: "panic" },
    inbounds: inbounds,
    outbounds: [{ 
      type: "direct", 
      tag: "direct",
      udp_fragment: true
    }]
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const isArm = ["arm", "arm64", "aarch64"].includes(os.arch());
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
  fs.chmodSync(webPath, 0o775);

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

  // 定义保存和显示节点信息的函数
  let argoNodeLink = "";
  let tuicNodeLink = "";

  const updateSubFile = () => {
    const links = [argoNodeLink, tuicNodeLink].filter(Boolean).join("\n");
    if (!links) return;
    
    log(`\n================== 节点链接列表 ==================\n${links}\n===================================================\n`);
    try {
      const base64Sub = Buffer.from(links).toString("base64");
      fs.writeFileSync(URL_FILE_PATH, base64Sub, "utf-8");
      log(`[成功！] 订阅 (Base64) 已保存至 ${URL_FILE_PATH}`);
    } catch (e) {
      log(`[错误！] 保存节点订阅失败: ${e.message}`);
    }
  };

  if (enableTuic) {
    const ip = getPublicIP();
    tuicNodeLink = `tuic://${UUID}:admin@${ip}:${TUIC_PORT}?sni=www.bing.com&alpn=h3&congestion_control=bbr&allowInsecure=1#tuic_${NAME}`;
    updateSubFile();
  }

  // 如果没有开启 Argo 隧道，处理完毕后保持进程挂起
  if (!enableArgo) {
    webProc.on("exit", (code) => {
      log(`[警告] sing-box 进程退出，退出码: ${code}`);
    });
    const cleanup = () => {
      try { webProc.kill("SIGKILL"); } catch (e) {}
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    process.stdin.resume();
    return;
  }

  // 如果开启了 Argo 隧道，继续启动 Cloudflared
  const cloudflaredUrl = isArm
    ? "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    : "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";

  if (!fs.existsSync(botPath)) {
    log("正在下载 Cloudflared...");
    await downloadFile(cloudflaredUrl, botPath);
  }
  fs.chmodSync(botPath, 0o775);

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

  let hasOutputArgoLink = false;

  const setArgoLink = (domain) => {
    const encodedPath = encodeURIComponent(WS_PATH);
    argoNodeLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&fp=chrome&type=ws&host=${domain}&path=${encodedPath}#argo_${NAME}`;
    updateSubFile();
  };

  if (isFixedTunnel && ARGO_DOMAIN.trim()) {
    setArgoLink(ARGO_DOMAIN.trim());
    hasOutputArgoLink = true;
  }

  botProc.stderr.on("data", (data) => {
    const msg = data.toString();

    if (!isFixedTunnel && !hasOutputArgoLink) {
      const domainMatch = msg.match(/https:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/);
      if (domainMatch && domainMatch[1]) {
        setArgoLink(domainMatch[1]);
        hasOutputArgoLink = true;
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
