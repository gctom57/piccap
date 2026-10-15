#!/bin/bash
# Build hyperion-webos and its capture backends, then collect them with the
# service files into ./build/hyperion-webos for packaging.
# Usage: build-backend.sh [make targets...]
set -euo pipefail

cd "$(dirname "$0")/.."

: "${TOOLCHAIN_FILE:?TOOLCHAIN_FILE must point to the webOS toolchain cmake file}"

BACKENDS="dile_vt_backend gm_backend halgal_backend vtcapture_backend"
OUT=./build/hyperion-webos

mkdir -p "$OUT" ./hyperion-webos/build
(
  cd ./hyperion-webos/build
  cmake -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN_FILE" ..
  make "$@"
)

cp ./hyperion-webos/build/hyperion-webos "$OUT/"
for backend in $BACKENDS; do
  cp "./hyperion-webos/build/lib${backend}.so" "$OUT/"
done
cp ./servicefiles/* "$OUT/"
chmod +x "$OUT/hyperion-webos" "$OUT/piccapautostart" "$OUT/setuplegacylogging.sh"
