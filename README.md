![简介与说明](https://img.shields.io/badge/简介与说明-Argo内网穿透、直连UDP+TCP部署方案-red?style=flat-square)
---

### 1.Argo Tunnel

* 可切换http2/quic模式
  
* 64MB存储，完成部署、生成节点，需要立刻手动删除tmp文件夹，防止存储溢出
  
* （适用场景：直连线路差、UDP被阻断，或未开放映射端口）
  
---
### 2.hy2+tuic+reality

* 单端口，可选择UDP+TCP组合；2个端口以上，可一次部署hy2+tuic+reality
  
* 64MB内存+64MB磁盘（如freecloudpanel）推荐只部署单节点
  
* （适用场景：直连UDP无阻断，已开放映射端口）

---


### 📌兼容环境测试记录（持续更新中......）

以下平台仅用于验证 Docker 容器与面板架构的兼容性：

* Lunes Host：128/512，每15天登录一次控制台续期
  
* Katabump：308/716，每4天续期
  
* Bot hosting：256/512，Earn Coins每日赚取10金币，自动扣费续期
                （❗️不开放7844端口，不支持Argo）
  
* Freecloudpanel：64+64，每30天续期
                （⚠️不定期开放注册）
---

⚠️ **免责声明（Disclaimer）**

1. 本项目所提供的配置文件及部署脚本仅供网络运维、容器技术交流与个人学术测试使用。
   
2. 请在测试和使用过程中，严格遵守您所使用的服务商服务条款（TOS）及当地法律法规，切勿用于任何非法或违规用途。
