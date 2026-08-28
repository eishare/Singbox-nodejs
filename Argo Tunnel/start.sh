#!/bin/sh

# 1. 允许 C 库分配适度内存池，匹配 100MB+ 容器的并发 IO
export MALLOC_ARENA_MAX=2

# 2. 移除 --expose-gc 与 24MB 的极小堆限制
# 为 Node.js 留出 48MB~64MB 堆内存上限，确保主进程稳定不频繁卡顿
exec node --max-old-space-size=64 index.js
