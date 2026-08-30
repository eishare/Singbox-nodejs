
### 适配翼龙面板node.js环境
  
* Sing-box架构

* uuid自动生成

* 单节点 Vless ws tls
  
* 可自行测试不同的优选域名&优选ip
  
### 1.临时隧道使用说明：

   

1：start.sh+index.js+package.json上传至服务器文件夹，无需修改内容

2：开机

❗️ 临时隧道默认优先quic协议（无法切换），内存占用偏高，不建议在64MB内存环境部署（如Freecloudpanel）

### 2.固定隧道使用说明：

1：start.sh+index.js+package.json上传至服务器文件夹

2：添加固定隧道域名+Token

3：（可选）手动修改http2/quic，连接数量1-4 （64MB内存建议http2，连接数4）

4：开机

❗️ 64MB存储，完成部署、生成节点后，需立刻手动删除tmp文件夹，以防存储溢出（（如Freecloudpanel）
