#!/bin/sh

export MALLOC_ARENA_MAX=2

export NODE_OPTIONS="--max-old-space-size=128 --optimize-for-size --gc-interval=100"

exec node index.js
