![简介](https://img.shields.io/badge/简介-Argo内网穿透、直连UDP+TCP部署方案-red?style=flat-square)

### 1.Argo Tunnel-64MB Ram

* 极限精简+性能平衡版
* 适合64MB内存+64MB磁盘部署（如freecloudpanel）
* （适用场景：直连线路差、UDP被阻断，或未开放映射端口）
    
### 2.Argo Tunnel

* 非精简版，偏向性能调优
* 推荐内存/磁盘>100MB的环境部署
* （适用场景：直连线路差、UDP被阻断，或未开放映射端口）

### 3.hy2+tuic+reality

* 64MB内存+64MB磁盘（如freecloudpanel）推荐只部署单节点
* 单端口，可选择UDP+TCP的不同组合
* 2个端口以上，可全部部署
* （适用场景：直连UDP无阻断，已开放映射端口）
