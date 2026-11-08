#!/usr/bin/env bash
set -euo pipefail

image="${1:?Uso: smoke-coolify.sh IMAGEM}"
suffix="$$"
container="escritorio-smoke-${suffix}"
volume="escritorio-smoke-${suffix}"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$volume" >/dev/null

start_container() {
  docker run --detach \
    --name "$container" \
    --user 10001:10001 \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --cap-drop ALL \
    --cap-add NET_BIND_SERVICE \
    --security-opt no-new-privileges:true \
    --memory 256m \
    --cpus 0.20 \
    --pids-limit 64 \
    --env AGENTES_ORG=00000000-0000-0000-0000-000000000000 \
    --env ESCRITORIO_BASE=https://smoke.example.ts.net \
    --env ESCRITORIO_BIND=0.0.0.0 \
    --env ESCRITORIO_PORTA=737 \
    --env ESCRITORIO_DADOS=/dados \
    --env ESCRITORIO_TIMES=/dados/times.json \
    --env ESCRITORIO_FONTE=https://github.com/learts13/escritorio-agentes \
    --publish 127.0.0.1::737 \
    --volume "$volume":/dados \
    "$image" >/dev/null
}

wait_for_login() {
  local port code
  port="$(docker port "$container" 737/tcp | awk -F: 'NR == 1 {print $NF}')"
  for _ in $(seq 1 30); do
    code="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "http://127.0.0.1:$port/entrar" || true)"
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  docker logs "$container"
  return 1
}

start_container
wait_for_login
docker exec "$container" python3 -B -I -c 'from pathlib import Path; Path("/dados/.smoke-persist").write_text("ok")'
docker rm -f "$container" >/dev/null
start_container
wait_for_login
docker exec "$container" python3 -B -I -c 'from pathlib import Path; assert Path("/dados/.smoke-persist").read_text() == "ok"'
echo "Imagem ARM64 iniciou como UID 10001, serviu /entrar e manteve os dados após recriação do container."
