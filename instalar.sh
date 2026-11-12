#!/usr/bin/env bash
# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
# Instala o Escritório dos agentes na VPS e publica SÓ na rede Tailscale (tailscale serve, HTTPS).
# Rodar como root, com escritorio.py, acesso.py, social.py, planta.py, ajustes.py, jornal.py, avisos.py, vapid.py, novidades.py,
# CHANGELOG.pt-BR.md, static/ e times.json (ou times.exemplo.json) ao lado. Idempotente.
# Uso: sudo AGENTES_ORG=<id da sua organização no agentes.chat> ./instalar.sh
#      (opcional: AGENTES_URL=<endereço da sua instalação self-host do agentes.chat, o PUBLIC_URL dela>;
#       o padrão é a nuvem, https://app.agentes.chat)
#      (opcional: ESCRITORIO_PORTA=<porta abaixo de 1024>; o padrão é 737)
#      (opcional: ESCRITORIO_FONTE=<https do seu código>, o link "Código-fonte" da página, AGPL §13; se você
#       modificou o escritório, aponte para a sua versão. O padrão é o repositório original)
# O código de primeiro acesso aparece no fim da instalação (em terminal); para ver de novo: sudo escritorio-codigo
# Crie seu usuário em https://<esta-máquina>.<sua-tailnet>.ts.net/
set -euo pipefail
cd "$(dirname "$0")"

ENV=/etc/escritorio.env
CASA=/var/lib/escritorio
PORTA="${ESCRITORIO_PORTA:-737}"
ORG="${AGENTES_ORG:-}"
AGENTES="${AGENTES_URL:-https://app.agentes.chat}"; AGENTES="${AGENTES%/}"
FONTE="${ESCRITORIO_FONTE:-https://github.com/HelbertMoura/escritorio-agentes}"
# Porta privilegiada: quando o serviço reinicia, nenhum usuário comum consegue ocupá-la e receber o
# tráfego da tailnet já decifrado pelo tailscaled.
[[ "$PORTA" =~ ^[0-9]{1,4}$ ]] && [ "$PORTA" -ge 1 ] && [ "$PORTA" -lt 1024 ] \
  || { echo "ABORTADO: ESCRITORIO_PORTA precisa ser menor que 1024 (porta privilegiada)" >&2; exit 1; }
[ "$(sysctl -n net.ipv4.ip_unprivileged_port_start)" -ge 1024 ] \
  || { echo "ABORTADO: net.ipv4.ip_unprivileged_port_start está abaixo de 1024; qualquer usuário pegaria a porta $PORTA" >&2; exit 1; }
[[ "$ORG" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
  || { echo "ABORTADO: defina AGENTES_ORG com o id da sua organização (o que vem depois de /org/ no endereço do agentes.chat)" >&2; exit 1; }
# A mesma regra do servidor (FONTE_OK no escritorio.py): o .env é lido pelo shell (escritorio-codigo, como root),
# então nada de aspas, espaços, $, ; ou crase
{ [ "${#FONTE}" -le 200 ] && [[ "$FONTE" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~:/%+-]*)?$ ]]; } \
  || { echo "ABORTADO: ESCRITORIO_FONTE precisa ser um endereço https simples (até 200 caracteres, sem aspas nem espaços)" >&2; exit 1; }
# A regra do servidor (erro_agentes), só com https: o http://localhost numa porta alta, que o servidor aceita para teste,
# deixaria outro usuário da máquina ocupar a porta e receber o token quando a self-host reinicia
[[ "$AGENTES" =~ ^https://[a-z0-9.-]+(:[0-9]{1,5})?$ && "$AGENTES" != *:443 ]] \
  || { echo "ABORTADO: AGENTES_URL precisa ser o endereço da sua instalação, como https://agentes.minha-rede.ts.net (https, minúsculas, sem caminho)" >&2; exit 1; }
# Self-host: o serviço só sai para a internet pública. Os IPs da sua instalação (na tailnet ou na rede local) entram
# na lista de liberados, um a um, num drop-in que o instalador reescreve
AGENTES_HOST=$(printf '%s' "$AGENTES" | sed -E 's#^https?://##; s#:[0-9]+$##')
LIBERAR=""
case "$AGENTES_HOST" in
  app.agentes.chat) ;;
  *) LIBERAR=$(getent ahosts "$AGENTES_HOST" | awk '{print $1}' | sort -u | tr '\n' ' ')
     [ -n "$LIBERAR" ] || { echo "ABORTADO: o nome $AGENTES_HOST não resolve nesta máquina (na tailnet, ligue o MagicDNS)" >&2; exit 1; };;
esac
command -v tailscale >/dev/null || { echo "ABORTADO: Tailscale não está instalada nesta máquina" >&2; exit 1; }
HOST=$(tailscale status --json | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
[ -n "$HOST" ] || { echo "ABORTADO: não achei o nome desta máquina na Tailscale (MagicDNS ligado?)" >&2; exit 1; }
# Não derruba outra publicação: a 443 desta máquina na tailnet precisa estar livre ou já ser deste serviço
ATUAL=$(tailscale serve status --json | python3 -I -c 'import json,sys; c=json.loads(sys.stdin.read() or "{}") or {}; h=(((c.get("Web") or {}).get(sys.argv[1]+":443") or {}).get("Handlers") or {}).get("/"); print((h.get("Proxy") or "outro") if h else "")' "$HOST") \
  || { echo "ABORTADO: não consegui ler tailscale serve status" >&2; exit 1; }
case "$ATUAL" in
  ""|"http://127.0.0.1:$PORTA") ;;
  *) echo "ABORTADO: a 443 desta máquina já publica $ATUAL; libere antes (veja tailscale serve status)" >&2; exit 1;;
esac

# 1. Usuário do serviço, sem shell
id escritorio >/dev/null 2>&1 || useradd --system --home-dir "$CASA" --shell /usr/sbin/nologin escritorio
if [ -L "$CASA" ]; then echo "ABORTADO: $CASA é link simbólico" >&2; exit 1; fi
install -d -o escritorio -g escritorio -m 0700 "$CASA"

# 2. Código e página, só do root (o serviço não reescreve o que executa nem o que serve)
install -d -o root -g root -m 0755 /opt/escritorio /opt/escritorio/static /opt/escritorio/static/tema /opt/escritorio/static/fontes
# o CHANGELOG.pt-BR.md é a página Novidades (novidades.py)
install -o root -g root -m 0644 escritorio.py acesso.py social.py planta.py ajustes.py jornal.py avisos.py vapid.py novidades.py visitas_sala.py \
  CHANGELOG.pt-BR.md /opt/escritorio/
if [ ! -f /opt/escritorio/times.json ]; then
  TIMES=times.json; [ -f "$TIMES" ] || TIMES=times.exemplo.json   # sem times.json, começa pelo exemplo
  install -o root -g root -m 0644 "$TIMES" /opt/escritorio/times.json
fi
for f in static/*.html static/*.js static/*.css static/*.png static/*.webmanifest; do
  [ -e "$f" ] || continue   # padrão sem arquivo (sem nullglob, o shell deixa o * como está)
  install -o root -g root -m 0644 "$f" "/opt/escritorio/$f"
done
install -o root -g root -m 0644 static/tema/atlas.png static/tema/atlas.json /opt/escritorio/static/tema/
install -o root -g root -m 0644 static/fontes/* /opt/escritorio/static/fontes/
rm -f /opt/escritorio/static/maquete.js; rm -rf /opt/escritorio/static/vendor   # sobras da maquete 3D (removida), caminho fixo
python3 -I -m py_compile /opt/escritorio/escritorio.py /opt/escritorio/acesso.py /opt/escritorio/social.py /opt/escritorio/planta.py \
  /opt/escritorio/ajustes.py /opt/escritorio/jornal.py /opt/escritorio/avisos.py /opt/escritorio/vapid.py \
  /opt/escritorio/novidades.py /opt/escritorio/visitas_sala.py && rm -rf /opt/escritorio/__pycache__
# Comando do administrador: em /usr/sbin, que está no secure_path do sudo (RHEL e Debian; /usr/local/bin não está).
# Lê o .env como root e roda o Python como o usuário do serviço: só lê o que o próprio serviço já lê.
cat > /usr/sbin/escritorio-codigo <<'EOF'
#!/bin/sh
# Mostra o código de primeiro acesso do Escritório, só enquanto não existe usuário. Uso: sudo escritorio-codigo
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
[ "$(id -u)" -eq 0 ] || { echo "rode com sudo: sudo escritorio-codigo" >&2; exit 1; }
. /etc/escritorio.env
cd /
exec runuser -u escritorio -- /usr/bin/env ESCRITORIO_DADOS="$ESCRITORIO_DADOS" ESCRITORIO_BASE="$ESCRITORIO_BASE" \
  /usr/bin/python3 -I /opt/escritorio/escritorio.py codigo
EOF
chown root:root /usr/sbin/escritorio-codigo; chmod 0755 /usr/sbin/escritorio-codigo

# 3. Configuração (sem segredo; tokens e senhas ficam em $CASA, 0600, do usuário escritorio)
umask 077
{
  echo "ESCRITORIO_BASE=https://$HOST"
  echo "ESCRITORIO_PORTA=$PORTA"
  echo "AGENTES_ORG=$ORG"
  echo "AGENTES_URL=$AGENTES"
  echo "ESCRITORIO_DADOS=$CASA"
  echo "ESCRITORIO_TIMES=/opt/escritorio/times.json"
  echo "ESCRITORIO_INTERVALO=30"
  echo "ESCRITORIO_FONTE=$FONTE"
} > "$ENV"
chown root:root "$ENV"; chmod 0600 "$ENV"

# 4. Serviço: escuta só em 127.0.0.1, numa porta privilegiada (só com CAP_NET_BIND_SERVICE);
#    saída só para a internet pública (agentes.chat, Open-Meteo). O ExecStartPre (+, como root e fora do
#    sandbox, que esconde /proc/sys) não deixa subir se alguém baixar o sysctl depois da instalação.
cat > /etc/systemd/system/escritorio.service <<'EOF'
[Unit]
Description=Escritório dos agentes (agentes.chat, só leitura)
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=escritorio
Group=escritorio
EnvironmentFile=/etc/escritorio.env
ExecStartPre=+/bin/sh -c 'read p < /proc/sys/net/ipv4/ip_unprivileged_port_start && test "$$p" -ge 1024'
ExecStart=/usr/bin/python3 -I /opt/escritorio/escritorio.py
Restart=on-failure
RestartSec=5s
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/escritorio
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
ProcSubset=pid
RestrictNamespaces=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=yes
MemoryDenyWriteExecute=yes
SystemCallArchitectures=native
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
IPAddressDeny=10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 fc00::/7 fe80::/10
IPAddressAllow=127.0.0.0/8 ::1 100.100.100.100 fd7a:115c:a1e0::53
MemoryMax=256M
TasksMax=64
CPUQuota=20%

[Install]
WantedBy=multi-user.target
EOF
install -d -o root -g root -m 0755 /etc/systemd/system/escritorio.service.d
if [ -n "$LIBERAR" ]; then
  { echo "# Gerado pelo instalar.sh: os IPs de $AGENTES_HOST (AGENTES_URL). Para mudar, rode o instalador de novo."
    echo "[Service]"; for ip in $LIBERAR; do echo "IPAddressAllow=$ip"; done; } > /etc/systemd/system/escritorio.service.d/agentes-url.conf
  echo "liberado para $AGENTES_HOST: $LIBERAR"
else
  rm -f /etc/systemd/system/escritorio.service.d/agentes-url.conf
fi
systemctl daemon-reload
systemctl enable escritorio >/dev/null 2>&1
systemctl restart escritorio
sleep 2
systemctl is-active escritorio
echo "local: HTTP $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA/") (esperado 302 para /entrar)"

# 5. Publica só na tailnet, com HTTPS da Tailscale (nada no túnel público)
tailscale serve --bg --https=443 "http://127.0.0.1:$PORTA" >/dev/null
tailscale serve status | head -5
echo "Pronto: https://$HOST/"
# Código de primeiro acesso: só num terminal (automação, | tee e agentes não guardam o código em log).
# Ao reinstalar com usuário criado, o comando sai com 1 de propósito ("já foi feito").
if [ -t 1 ]; then /usr/sbin/escritorio-codigo || true; else echo "Para ver o código de primeiro acesso: sudo escritorio-codigo (num terminal)"; fi
