#!/bin/sh

TOTAL_MEM_MB=0

# 优先读取 Cgroup v2 内存限制
if [ -f /sys/fs/cgroup/memory.max ]; then
    BYTES=$(cat /sys/fs/cgroup/memory.max 2>/dev/null)
    if [ "$BYTES" != "max" ] && [ -n "$BYTES" ]; then
        TOTAL_MEM_MB=$((BYTES / 1024 / 1024))
    fi
# 其次读取 Cgroup v1 内存限制
elif [ -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    BYTES=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)
    if [ -n "$BYTES" ]; then
        TOTAL_MEM_MB=$((BYTES / 1024 / 1024))
    fi
fi

# 若 Cgroup 未限制或获取失败，退回使用 free -m
if [ -z "$TOTAL_MEM_MB" ] || [ "$TOTAL_MEM_MB" -eq 0 ] || [ "$TOTAL_MEM_MB" -gt 100000 ]; then
    if command -v free >/dev/null 2>&1; then
        TOTAL_MEM_MB=$(free -m 2>/dev/null | awk '/Mem:/{print $2}')
    fi
fi

# 保底设定：极端情况下默认为 100MB
if [ -z "$TOTAL_MEM_MB" ] || [ "$TOTAL_MEM_MB" -eq 0 ]; then
    TOTAL_MEM_MB=100
fi

# 统一预设全套 Go 优化参数，防止被父进程环境变量覆盖
export GODEBUG="madvdontneed=1,cgocheck=0,netdns=go"

# 针对不同内存档位优化 Node.js V8 引擎与 glibc 内存分配
if [ "$TOTAL_MEM_MB" -le 160 ]; then
    export MALLOC_ARENA_MAX=1
    # 移除 --gc-interval=100，避免在 15% CPU 下频繁 GC 抢占算力
    export NODE_OPTIONS="--max-old-space-size=24 --optimize-for-size"

elif [ "$TOTAL_MEM_MB" -lt 256 ]; then
    export MALLOC_ARENA_MAX=2
    export NODE_OPTIONS="--max-old-space-size=40 --optimize-for-size"

elif [ "$TOTAL_MEM_MB" -lt 320 ]; then
    export MALLOC_ARENA_MAX=2
    export NODE_OPTIONS="--max-old-space-size=50"

elif [ "$TOTAL_MEM_MB" -lt 448 ]; then
    export NODE_OPTIONS="--max-old-space-size=64"

elif [ "$TOTAL_MEM_MB" -lt 576 ]; then
    export NODE_OPTIONS="--max-old-space-size=80"

else
    export NODE_OPTIONS="--max-old-space-size=128"
fi

echo "[start.sh] TOTAL_MEM_MB: ${TOTAL_MEM_MB}MB | NODE_OPTIONS: $NODE_OPTIONS | MALLOC_ARENA_MAX: ${MALLOC_ARENA_MAX:-default}"

# 启动 Node 主程序
exec node index.js
