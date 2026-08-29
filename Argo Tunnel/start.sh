#!/bin/sh

export MALLOC_ARENA_MAX=2
exec node --max-old-space-size=32 index.js
