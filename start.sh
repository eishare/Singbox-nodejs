#!/bin/bash
set -e

# ================== 端口设置 ==================
export TUIC_PORT=${TUIC_PORT:-""}
export HY2_PORT=${HY2_PORT:-""}
export REALITY_PORT=${REALITY_PORT:-""}

# ================== 强制切换到脚本所在目录 ==================
cd "$(dirname "$0")"

# ================== 环境变量 & 绝对路径 ==================
export FILE_PATH="${PWD}/.npm"
export DATA_PATH="${PWD}/singbox_data"
mkdir -p "$FILE_PATH" "$DATA_PATH"
export XDG_DATA_HOME="/tmp/.singbox_data"
export XDG_CACHE_HOME="/tmp/.singbox_cache"
export TMPDIR="/tmp"
rm -rf "${FILE_PATH}"/sb_* ~/.npm/_logs/* ./npm-debug.log* "${DATA_PATH}"/* /tmp/.singbox_* 2>/dev/null || true

# ================== UUID 固定保存（核心逻辑）==================
UUID_FILE="${FILE_PATH}/uuid.txt"
if [ -f "$UUID_FILE" ]; then
  UUID=$(cat "$UUID_FILE")
  echo -e "\e[1;33m[UUID] 复用固定 UUID: $UUID\e[0m"
else
  UUID=$(cat /proc/sys/kernel/random/uuid)
  echo "$UUID" > "$UUID_FILE"
  chmod 600 "$UUID_FILE"
  echo -e "\e[1;32m[UUID] 首次生成并永久保存: $UUID\e[0m"
fi

# ================== 创建目录 ==================
[ ! -d "${FILE_PATH}" ] && mkdir -p "${FILE_PATH}"

# ================== 架构检测 & 下载 sing-box (完全修复) ==================
ARCH=$(uname -m)
SINGBOX_VERSION="1.10.0"
FILE_NAME=""
ARCH_SUFFIX=""

if [[ "$ARCH" == "arm"* ]] || [[ "$ARCH" == "aarch64" ]]; then
  ARCH_SUFFIX="arm64"
elif [[ "$ARCH" == "amd64"* ]] || [[ "$ARCH" == "x86_64" ]]; then
  ARCH_SUFFIX="amd64"
elif [[ "$ARCH" == "s390x" ]]; then
  ARCH_SUFFIX="s390x"
else
  echo "不支持的架构: $ARCH"
  exit 1
fi

# 构建文件名和下载URL (必须带 .tar.gz)
TAR_FILE="sing-box-${SINGBOX_VERSION}-linux-${ARCH_SUFFIX}.tar.gz"
GITHUB_URL="https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/${TAR_FILE}"
MIRROR_URL="https://gh.api.99988866.xyz/${GITHUB_URL}" # 使用更稳定的镜像

# 临时下载路径
TEMP_TAR="${FILE_PATH}/${TAR_FILE}"
# 最终二进制路径 (随机命名)
FINAL_BIN="${FILE_PATH}/$(head /dev/urandom | tr -dc a-z0-9 | head -c6)"

download_file() {
  local URL=$1
  local OUTPUT=$2
  local NO_CERT=$3
  
  if command -v wget >/dev/null 2>&1; then
    if [ "$NO_CERT" == "1" ]; then
      wget --no-check-certificate -q -T 10 -t 2 -O "$OUTPUT" "$URL" && return 0
    else
      wget -q -T 10 -t 2 -O "$OUTPUT" "$URL" && return 0
    fi
  elif command -v curl >/dev/null 2>&1; then
    if [ "$NO_CERT" == "1" ]; then
      curl -k -L --connect-timeout 10 --max-time 300 -sS -o "$OUTPUT" "$URL" && return 0
    else
      curl -L --connect-timeout 10 --max-time 300 -sS -o "$OUTPUT" "$URL" && return 0
    fi
  fi
  return 1
}

echo -e "\e[1;33m[下载] 正在从 GitHub 下载 ${TAR_FILE}...\e[0m"
DOWNLOAD_SUCCESS=0

# 1. 尝试 GitHub 官方源
if download_file "$GITHUB_URL" "$TEMP_TAR" "0"; then
  echo -e "\e[1;32m[下载] GitHub 下载成功\e[0m"
  DOWNLOAD_SUCCESS=1
else
  echo -e "\e[1;31m[下载] GitHub 连接失败，尝试国内镜像...\e[0m"
  # 2. 尝试 镜像源 (忽略证书验证)
  if download_file "$MIRROR_URL" "$TEMP_TAR" "1"; then
    echo -e "\e[1;32m[下载] 镜像下载成功\e[0m"
    DOWNLOAD_SUCCESS=1
  else
    echo -e "\e[1;31m[错误] 所有下载源均失败，请检查网络\e[0m"
    exit 1
  fi
fi

# 解压并提取二进制文件
echo -e "\e[1;33m[解压] 正在提取 sing-box 二进制文件...\e[0m"
if ! command -v tar >/dev/null 2>&1; then
  echo "未找到 tar 命令，无法解压"
  exit 1
fi

# 解压到临时目录
EXTRACT_DIR="${FILE_PATH}/temp_extract"
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$TEMP_TAR" -C "$EXTRACT_DIR"

# 查找解压后的 sing-box 文件并移动
FOUND_BIN=$(find "$EXTRACT_DIR" -type f -name "sing-box" | head -n 1)
if [ -z "$FOUND_BIN" ]; then
  echo "[错误] 压缩包内未找到 sing-box 文件"
  exit 1
fi

mv "$FOUND_BIN" "$FINAL_BIN"
chmod +x "$FINAL_BIN"

# 清理
rm -rf "$EXTRACT_DIR" "$TEMP_TAR"

declare -A FILE_MAP
FILE_MAP["sing-box"]="$FINAL_BIN"

# ================== 固定 Reality 密钥 ==================
KEY_FILE="${FILE_PATH}/key.txt"
if [ -f "$KEY_FILE" ]; then
  echo -e "\e[1;33m[密钥] 检测到已有密钥，复用...\e[0m"
  private_key=$(grep "PrivateKey:" "$KEY_FILE" | awk '{print $2}')
  public_key=$(grep "PublicKey:" "$KEY_FILE" | awk '{print $2}')
else
  echo -e "\e[1;33m[密钥] 首次生成 Reality 密钥对...\e[0m"
  output=$("${FILE_MAP[sing-box]}" generate reality-keypair)
  echo "$output" > "$KEY_FILE"
  private_key=$(echo "$output" | awk '/PrivateKey:/ {print $2}')
  public_key=$(echo "$output" | awk '/PublicKey:/ {print $2}')
  chmod 600 "$KEY_FILE"
  echo -e "\e[1;32m[密钥] 密钥已保存，重启后保持不变\e[0m"
fi

# ================== 生成证书（自签或固定）==================
if ! command -v openssl >/dev/null 2>&1; then
  cat > "${FILE_PATH}/private.key" <<'EOF'
-----BEGIN EC PARAMETERS-----
BgqghkjOPQQBw==
-----END EC PARAMETERS-----
-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIM4792SEtPqIt1ywqTd/0bYidBqpYV/+siNnfBYsdUYsAoGCCqGSM49
AwEHoUQDQgAE1kHafPj07rJG+HboH2ekAI4r+e6TL38GWASAnngZreoQDF16ARa
/TsyLyFoPkhTxSbehH/OBEjHtSZGaDhMqQ==
-----END EC PRIVATE KEY-----
EOF
  cat > "${FILE_PATH}/cert.pem" <<'EOF'
-----BEGIN CERTIFICATE-----
MIIBejCCASGgAwIBAgIUFWeQL3556PNJLp/veCFxGNj9crkwCgYIKoZIzj0EAwIw
EzERMA8GA1UEAwwIYmluZy5jb20wHhcNMjUwMTAxMDEwMTAwWhcNMzUwMTAxMDEw
MTAwWjATMREwDwYDVQQDDAhiaW5nLmNvbTBNBgqgGzM9AgEGCCqGSM49AwEHA0IA
BNZB2nz49O6yRvh26B9npACOK/nuky9/BlgEgDZ54Ga3qEAxdeWv07Mi8h
d5IR8Um3oR/zQRIx7UmRmg4TKmjUzBRMB0GA1UdDgQWBQTV1cFID7UISE7PLTBR
BfGbgrkMNzAfBgNVHSMEGDAWgBTV1cFID7UISE7PLTBRBfGbgrkMNzAPBgNVHRMB
Af8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIARDAJvg0vd/ytrQVvEcSm6XTlB+
eQ6OFb9LbLYL9Zi+AiffoMbi4y/0YUQlTtz7as9S8/lciBF5VCUoVIKS+vX2g==
-----END CERTIFICATE-----
EOF
else
  openssl ecparam -genkey -name prime256v1 -out "${FILE_PATH}/private.key" 2>/dev/null
  openssl req -new -x509 -days 3650 -key "${FILE_PATH}/private.key" -out "${FILE_PATH}/cert.pem" -subj "/CN=bing.com" 2>/dev/null
fi
chmod 600 "${FILE_PATH}/private.key"

# ================== 生成 config.json ==================
cat > "${FILE_PATH}/config.json" <<EOF
{
  "log": { "disabled": true },
  "inbounds": [$( \
    [ "$TUIC_PORT" != "" ] && [ "$TUIC_PORT" != "0" ] && echo "{
      \"type\": \"tuic\",
      \"listen\": \"::\",
      \"listen_port\": $TUIC_PORT,
      \"users\": [{\"uuid\": \"$UUID\", \"password\": \"admin\"}],
      \"congestion_control\": \"bbr\",
      \"tls\": {\"enabled\": true, \"alpn\": [\"h3\"], \"certificate_path\": \"${FILE_PATH}/cert.pem\", \"key_path\": \"${FILE_PATH}/private.key\"}
    },"; \
    [ "$HY2_PORT" != "" ] && [ "$HY2_PORT" != "0" ] && echo "{
      \"type\": \"hysteria2\",
      \"listen\": \"::\",
      \"listen_port\": $HY2_PORT,
      \"users\": [{\"password\": \"$UUID\"}],
      \"masquerade\": \"https://bing.com\",
      \"tls\": {\"enabled\": true, \"alpn\": [\"h3\"], \"certificate_path\": \"${FILE_PATH}/cert.pem\", \"key_path\": \"${FILE_PATH}/private.key\"}
    },"; \
    [ "$REALITY_PORT" != "" ] && [ "$REALITY_PORT" != "0" ] && echo "{
      \"type\": \"vless\",
      \"listen\": \"::\",
      \"listen_port\": $REALITY_PORT,
      \"users\": [{\"uuid\": \"$UUID\", \"flow\": \"xtls-rprx-vision\"}],
      \"tls\": {
        \"enabled\": true,
        \"server_name\": \"www.nazhumi.com\",
        \"reality\": {
          \"enabled\": true,
          \"handshake\": {\"server\": \"www.nazhumi.com\", \"server_port\": 443},
          \"private_key\": \"$private_key\",
          \"short_id\": [\"\"]
        }
      }
    }"; \
  )],
  "outbounds": [{"type": "direct"}]
}
EOF

# ================== 启动 sing-box ==================
"${FILE_MAP[sing-box]}" run -c "${FILE_PATH}/config.json" &
SINGBOX_PID=$!
echo "[SING-BOX] 启动完成 PID=$SINGBOX_PID"

# ================== 获取 IP & ISP ==================
IP=$(curl -s --max-time 2 ipv4.ip.sb || curl -s --max-time 1 api.ipify.org || echo "IP_ERROR")
ISP=$(curl -s --max-time 2 https://speed.cloudflare.com/meta | awk -F'"' '{print $26"-"$18}' || echo "0.0")

# ================== 生成订阅 ==================
> "${FILE_PATH}/list.txt"
[ "$TUIC_PORT" != "" ] && [ "$TUIC_PORT" != "0" ] && echo "tuic://${UUID}:admin@${IP}:${TUIC_PORT}?sni=www.bing.com&alpn=h3&congestion_control=bbr&allowInsecure=1#TUIC-${ISP}" >> "${FILE_PATH}/list.txt"
[ "$HY2_PORT" != "" ] && [ "$HY2_PORT" != "0" ] && echo "hysteria2://${UUID}@${IP}:${HY2_PORT}/?sni=www.bing.com&insecure=1#Hysteria2-${ISP}" >> "${FILE_PATH}/list.txt"
[ "$REALITY_PORT" != "" ] && [ "$REALITY_PORT" != "0" ] && echo "vless://${UUID}@${IP}:${REALITY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.nazhumi.com&fp=firefox&pbk=${public_key}&type=tcp#Reality-${ISP}" >> "${FILE_PATH}/list.txt"

base64 "${FILE_PATH}/list.txt" | tr -d '\n' > "${FILE_PATH}/sub.txt"
cat "${FILE_PATH}/list.txt"
echo -e "\n\e[1;32m${FILE_PATH}/sub.txt 已保存\e[0m"

# ================== 启动定时重启（前台阻塞） ==================
schedule_restart() {
  echo "[定时重启:Sing-box] 已启动（北京时间 00:03）"
  LAST_RESTART_DAY=-1

  while true; do
    now_ts=$(date +%s)
    beijing_ts=$((now_ts + 28800))
    H=$(( (beijing_ts / 3600) % 24 ))
    M=$(( (beijing_ts / 60) % 60 ))
    D=$(( beijing_ts / 86400 ))

    # ---- 时间匹配 → 重启 sing-box ----
    if [ "$H" -eq 00 ] && [ "$M" -eq 03 ] && [ "$D" -ne "$LAST_RESTART_DAY" ]; then
      echo "[定时重启:Sing-box] 到达 00:03 → 重启 sing-box"
      LAST_RESTART_DAY=$D

      kill "$SINGBOX_PID" 2>/dev/null || true
      sleep 3
      
      rm -rf ~/.npm/_logs/* ./npm-debug.log* "${DATA_PATH}"/* /tmp/.singbox_* 2>/dev/null || true

      "${FILE_MAP[sing-box]}" run -c "${FILE_PATH}/config.json" &
      SINGBOX_PID=$!

      echo "[Sing-box重启完成] 新 PID: $SINGBOX_PID"
    fi

    sleep 1
  done
}

# ★★★ 关键：保持脚本前台运行，不能退出
schedule_restart
