#!/bin/sh

TOTAL_MEM_MB=0

if [ -f /sys/fs/cgroup/memory.max ]; then
    BYTES=$(cat /sys/fs/cgroup/memory.max 2>/dev/null)
    if [ "$BYTES" != "max" ] && [ -n "$BYTES" ]; then
        TOTAL_MEM_MB=$((BYTES / 1024 / 1024))
    fi
elif [ -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    BYTES=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)
    if [ -n "$BYTES" ]; then
        TOTAL_MEM_MB=$((BYTES / 1024 / 1024))
    fi
fi

if [ -z "$TOTAL_MEM_MB" ] || [ "$TOTAL_MEM_MB" -eq 0 ] || [ "$TOTAL_MEM_MB" -gt 100000 ]; then
    if command -v free >/dev/null 2>&1; then
        TOTAL_MEM_MB=$(free -m 2>/dev/null | awk '/Mem:/{print $2}')
    fi
fi

if [ -z "$TOTAL_MEM_MB" ] || [ "$TOTAL_MEM_MB" -eq 0 ]; then
    TOTAL_MEM_MB=128
fi

export MALLOC_ARENA_MAX=2

export GOMAXPROCS=2

export GODEBUG="madvdontneed=1,asyncpreempt=1"

if [ "$TOTAL_MEM_MB" -le 160 ]; then

    export MALLOC_ARENA_MAX=1
    export GOMAXPROCS=1
    export NODE_OPTIONS="--max-old-space-size=30 --optimize-for-size"

elif [ "$TOTAL_MEM_MB" -lt 256 ]; then

    export NODE_OPTIONS="--max-old-space-size=80"

elif [ "$TOTAL_MEM_MB" -lt 320 ]; then

    export NODE_OPTIONS="--max-old-space-size=128"

elif [ "$TOTAL_MEM_MB" -lt 448 ]; then

    export NODE_OPTIONS="--max-old-space-size=160"

elif [ "$TOTAL_MEM_MB" -lt 576 ]; then

    export NODE_OPTIONS="--max-old-space-size=200"

else

    export NODE_OPTIONS="--max-old-space-size=256"
fi

echo "[启动脚本] 识别到内存上限: ${TOTAL_MEM_MB}MB | NODE_OPTIONS: $NODE_OPTIONS | MALLOC_ARENA_MAX: $MALLOC_ARENA_MAX | GOMAXPROCS: $GOMAXPROCS"

exec node index.js
