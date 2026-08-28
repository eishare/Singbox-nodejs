![说明](https://img.shields.io/badge/Argo内网穿透、直连UDP+TCP 部署方案-red?style=flat-square)

![说明](https://img.shields.io/badge/注意-这是一条醒目的红色提示信息-red?style=flat-square)

### 1.Argo Tunnel-64MB Ram

* 极限精简+性能平衡版
* 适合64MB内存+64MB磁盘部署（如freecloudpanel）
* （适用场景：直连线路差、UDP被阻断）
    
### 2.Argo Tunnel

* 普通版
* 推荐内存/磁盘>100MB的环境部署
* （适用场景：直连线路差、UDP被阻断）

### 3.hy2+tuic+reality

* 64MB内存+64MB磁盘（如freecloudpanel）推荐只部署单节点
* 单端口，可选择UDP+TCP的不同组合
* 2个端口以上，可全部部署
* （适用场景：直连UDP无阻断）
