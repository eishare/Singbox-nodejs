#!/bin/bash

# 1. 运行 Node.js 脚本完成下载、配置生成和节点打印
node index.js

# 2. 强制杀掉 Node.js 进程，释放其占用的 15-20MB 内存
pkill -9 -f "node index.js" || true

# 3. 挂起零内存前台进程，维持翼龙面板 running 状态
exec tail -f /dev/null
