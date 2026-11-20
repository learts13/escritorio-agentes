# Gera uma arte no PixelLab (pixflux): python3 gerar.py <saida.png> <largura> <altura> "<descrição>" [semente]
# A chave fica fora do repositório, em ~/.config/pixellab/key. Mostra o custo de cada geração.
import base64, json, os, sys, urllib.request
saida, w, h, desc = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
corpo = {"description": desc, "image_size": {"width": w, "height": h}, "view": "side", "no_background": True,
         "detail": "highly detailed", "shading": "medium shading", "outline": "single color outline"}
if len(sys.argv) > 5: corpo["seed"] = int(sys.argv[5])
chave = open(os.path.expanduser("~/.config/pixellab/key")).read().strip()
req = urllib.request.Request("https://api.pixellab.ai/v1/generate-image-pixflux", json.dumps(corpo).encode(),
                             {"Authorization": "Bearer " + chave, "Content-Type": "application/json"})
d = json.load(urllib.request.urlopen(req, timeout=180))
open(saida, "wb").write(base64.b64decode(d["image"]["base64"].split(",")[-1]))
print(saida, "US$ %.4f" % d["usage"]["usd"])
