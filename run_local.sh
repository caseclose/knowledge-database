#!/bin/bash
# 本地预览 Docsify 知识库站点
# 用法: bash run_local.sh [端口号]

PORT=${1:-3000}

echo "启动本地预览: http://localhost:${PORT}"
echo "按 Ctrl+C 停止"
echo "---"

python3 -m http.server ${PORT}
