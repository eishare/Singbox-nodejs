#!/bin/sh

# 优化 Linux 内存分配器行为，要求动态内存及时退回 OS
export MALLOC_ARENA_MAX=1
export GODEBUG="madvdontneed=1,cgocheck=0"

# 启动 Node.js，直接注入 V8 极限参数
exec node --expose-gc --max-old-space-size=6 index.js
