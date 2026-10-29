#!/bin/sh
set -eu
# Railway 新卷属于 root；只修正媒体目录后立即降权。
mkdir -p static
chown node:node static
exec gosu node "$@"
