#!/bin/sh
# Codifica as gravações do modo demonstração (quadros PNG do canvas) em WebP animado, 1,4x mais rápido que o real,
# e um quadro parado para quem prefere menos movimento. Uso: codificar.sh <pasta dos quadros> <saída sem extensão> [recorte WxH+X+Y]
set -e
DIR=$1; OUT=$2; CROP=$3
MS=$(python3 -c "import json;print(json.load(open('$DIR/meta.json'))['ms'])")
FPS=$(python3 -c "print(round(1000/($MS*0.7),2))")
VF="format=yuva420p"
[ -n "$CROP" ] && VF=$(echo "$CROP" | sed -E 's/([0-9]+)x([0-9]+)\+([0-9]+)\+([0-9]+)/crop=\1:\2:\3:\4/'),$VF
ffmpeg -loglevel error -y -framerate "$FPS" -i "$DIR/%02d.png" -vf "$VF" -c:v libwebp_anim -lossless 0 -q:v 62 -compression_level 6 -loop 0 "$OUT.webp"
ffmpeg -loglevel error -y -i "$DIR/10.png" -vf "$VF" -c:v libwebp -q:v 75 "$OUT-parado.webp"
echo "$OUT $(du -k "$OUT.webp" | cut -f1)KB ${FPS}fps"
