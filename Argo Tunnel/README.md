
### 适配翼龙面板node.js环境（内存≥128MB）

* 自动清理残留进程。

* uuid自动生成。

* 单节点 Vless ws tls。
  
* 可自行测试不同的优选域名&优选ip。
---
  
### 1.临时隧道使用说明：

1：start.sh+index.js+package.json上传至服务器文件夹，无需修改内容。

2：开机。

❗️ 临时隧道优先quic协议+单连接（Cloudflare默认设置，无法更改）。

---

### 2.固定隧道使用说明：

1：start.sh+index.js+package.json上传至服务器文件夹。

2：添加固定隧道域名+Token。

3：隧道模式可修改为http2或quic，连接数量1-4。

4：开机。

❗️ quic模式下，128MB内存建议连接数设置1，以防内存溢出。
