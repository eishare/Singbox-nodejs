#!/bin/bash

# 1. 设置工作目录环境变量
export FILE_PATH=${FILE_PATH:-".tmp"}
mkdir -p "$FILE_PATH"

# 2. 优化运行环境，取消低内存限制以支持高性能模式
unset GOMAXPROCS
unset GOMEMLIMIT
export GOGC=100

# 3. 清理残留进程
pkill -9 -f "$FILE_PATH/web" 2>/dev/null || true
pkill -9 -f "$FILE_PATH/bot" 2>/dev/null || true

# 4. 前台常驻启动 index.js
exec node index.js
