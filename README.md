# 🚀 http2/quic双模Argo Tunnel & 直连 sing-box部署方案

![简介与说明](https://img.shields.io/badge/%E7%AE%80%E4%BB%8B%E4%B8%8E%E8%AF%B4%E6%98%8E-Argo%E5%86%85%E7%BD%91%E7%A9%BF%E9%80%8F%E3%80%81%E7%9B%B4%E8%BF%9EUDP%2BTCP%E9%83%A8%E7%BD%B2%E6%96%B9%E6%A1%88-red?style=flat-square)

极致轻量化代理节点部署方案，确保在低配置环境中稳定运行。底层架构采用 **Sing-box + Cloudflared**

---

## 💡 特性与适用场景

### 1. 🌐 http2/quic 双模Argo Tunnel 方案 (内网穿透与穿墙)


* **TCP/UDP双模**：隧道类型手动切换http2/quic、连接数可调。
* **精简 Sing-box 架构**：极低资源占用。
* **高稳定 Guardian 启动器**：内置 `start.sh` 内存与进程守护机制，精准控制垃圾回收（GC），在 64MB 低内存环境稳定运行。
* **📌 适用场景**：
  * 直连线路质量差、UDP 被 QoS 限速或阻断。
  * 服务器未开放公网端口。
### Argo Tunnel-64MB Ram适用于64MB低内存环境，如Freecloudpanel。

---

### 2. ⚡ 直连协议方案 (Hysteria2 / TUIC / REALITY)


  * **面板仅开放单端口**：可选 hy2+reality 或 tuic+reality不同组合。
    
  * **面板开放了多端口（≥ 2个）**：支持一键同时部署 Hysteria2 + TUIC v5 + VLESS-REALITY。
    
* **📌 适用场景**：
  
  * 直连 线路良好、UDP极少被QoS。
  * 平台已开放外部映射端口。

---


### 📌兼容环境测试记录（持续更新中......）


## 🌐 以下平台仅用于验证 Docker 容器与面板架构的兼容性：

| 平台名称 | 核心配置 (RAM / Disk / CPU) | 续期机制 / 存活规则 | ⚠️ 注意事项与网络限制 | 部署状态 |
| :--- | :--- | :--- | :--- | :---: |
| **Lunes Host** | `128 MB` / `512 MB` / `15%` | 🔄 每 15 天登录控制台=续期 |  | 🟢 正常 |
| **Katabump** | `308 MB` / `716 MB` / `25%` | 🔄 每 4 天手动续期 |  | 🟢 正常 |
| **Bot Hosting** | `256 MB` / `1 GB` / `20%` | 🔄 每日最多赚取 10 金币，自动扣费 | ❌ 不开放 7844 端口<br>❌ 不支持 Cloudflare Argo | 🟢 正常 |
| **Pella.app** | `100 MB` / `5 GB` / `10%` | 🔄 每 24 小时手动续期 | ❌ 无公网 TCP/UDP 端口<br>✅ **仅支持 Argo 临时/固定隧道** | 🟢 正常 |
| **Freecloudpanel** | `64 MB` / `64 MB` / `100%` | 🔄 每 30 天手动续期 | 🚫 不定期开放注册 | 🟡 稀缺 |
| **host-ship** | `512 MB` / `1 GB` / `50%` | 🔄 手动续费，最长30填 |  | 🟢 正常 |
| **Zenix.sg** | `1 GB` / `5 GB` / `50%` | 🔄 维持账号活跃度 | ⏳ 目前正在队列等待中... | ⏳ 漫长排队 |

> 📌 **提示**：部分托管平台对 TCP / UDP 端口及代理协议（如 Cloudflare Argo）有严格限制，部署前请仔细核对平台规则。


---

⚠️ **免责声明（Disclaimer）**

1. 本项目所提供的配置文件及部署脚本仅供网络运维、容器技术交流与个人学术测试使用。
   
2. 请在测试和使用过程中，严格遵守您所使用的服务商服务条款（TOS）及当地法律法规，切勿用于任何非法或违规用途。
