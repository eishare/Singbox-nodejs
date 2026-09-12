#!/bin/bash


chmod +x ./*


if [ ! -d "node_modules" ] && [ -f "package.json" ]; then
    npm install
fi


node index.js
