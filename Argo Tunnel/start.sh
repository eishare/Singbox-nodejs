#!/bin/sh

export MALLOC_ARENA_MAX=2

export NODE_OPTIONS="--optimize-for-size --gc-interval=100"

exec node --max-old-space-size=80 index.js
