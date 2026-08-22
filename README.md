### 内存极限优化版-适配低内存/存储（如64MB内存+64磁盘）
    
### tuic+reality双节点，磁盘占用42.55MB，运行内存占用低于60MB

### 64MB内存机器建议只部署单节点，如果没有运营商QoS，建议tuic

* 精简化：去除哪吒、argo隧道；保留3种协议：tuic、hy2、vless+xtls+reality

* uuid自动生成
  
* 自动重启：每天凌晨00:03自动执行一次Sing-box重启，清除缓存
  
* TCP/UDP端口可共用
  
### 使用说明：

1：start.sh+index.js+package.json上传至服务器

2：输入tuic/hy2/vless端口，保存

3：开机
