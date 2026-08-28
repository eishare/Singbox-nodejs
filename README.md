![简介与说明](https://img.shields.io/badge/简介与说明-Argo内网穿透、直连UDP+TCP部署方案-red?style=flat-square)

### 1.Argo Tunnel-64MB Ram

* 极限精简+性能平衡版
* 适合64MB内存+64MB磁盘部署（如freecloudpanel）
* （适用场景：直连线路差、UDP被阻断，或未开放映射端口）
---    
### 2.Argo Tunnel

* 非精简版，偏向性能调优
* 推荐内存/磁盘>100MB的环境部署
* （适用场景：直连线路差、UDP被阻断，或未开放映射端口）
---
### 3.hy2+tuic+reality

* 64MB内存+64MB磁盘（如freecloudpanel）推荐只部署单节点
* 单端口，可选择UDP+TCP的不同组合
* 2个端口以上，可全部部署
* （适用场景：直连UDP无阻断，已开放映射端口）

---


### 📌已测试平台

* Lunes Host
* Katabump
* Bot hosting（不支持argo）
* Freecloudpanel
---

⚠️ **免责声明（Disclaimer）**

1. 本项目所提供的配置文件及部署脚本仅供网络运维、容器技术交流与个人学术测试使用。
2. 请在测试和使用过程中，严格遵守您所使用的服务商服务条款（TOS）及当地法律法规，切勿用于任何非法或违规用途。
