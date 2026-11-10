// Letreiros da cidade em Silkscreen, desenhados uma vez num canvas pequeno e passados a duas cores (sem suavização):
// a placa RECEPÇÃO do chalé da casa (na escala do mundo), as placas azuis com o nome das ruas nas esquinas e a etiqueta
// com o nome de uma construção (estas duas na escala da tela, a 8 px de CSS). A fonte já vem declarada pela página: até
// ela carregar, nenhum letreiro.
"use strict";
const CidadeLetreiro = (() => {
  const FONTE = "Silkscreen, monospace";
  const ESTILOS = { placa: ["#2a1d14", "#f2e6c8"], rua: ["#1f4f8f", "#f3f6fa"], etiqueta: ["#2a1d14", "#f6e7b8"] };

  function criar() {
    const telas = new Map();
    let pronto = false, pedido = false;
    function pedir() {
      if (pedido) return;
      pedido = true;
      const ok = () => { pronto = true; };
      if (document.fonts && document.fonts.load) document.fonts.load("8px Silkscreen").then(ok, ok); else ok();
    }
    // o letreiro: texto em k vezes 8 px, com margem de 2k e 1k de borda clara (a placa da rua) ou nenhuma
    function letreiro(texto, estilo, k = 1) {
      const chave = estilo + "|" + k + "|" + texto;
      let cv = telas.get(chave);
      if (cv) return cv;
      if (!pronto) { pedir(); return null; }
      if (telas.size > 200) telas.clear();
      const [fundo, letra] = ESTILOS[estilo], h = 12 * k;
      cv = document.createElement("canvas");
      const c = cv.getContext("2d");
      c.font = `${8 * k}px ${FONTE}`;
      const m = c.measureText(texto), w = Math.ceil((m && m.width) || texto.length * 5 * k) + 5 * k;
      cv.width = w; cv.height = h;
      c.font = `${8 * k}px ${FONTE}`; c.textAlign = "left"; c.textBaseline = "alphabetic";
      c.fillStyle = fundo; c.fillRect(0, 0, w, h);
      c.fillStyle = letra; c.fillText(texto, 3 * k, 9 * k);
      const img = c.getImageData(0, 0, w, h), d = img && img.data;
      if (d) {
        const f = [fundo, letra].map(x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)));
        const corte = (f[0][0] + f[1][0]) / 2;
        for (let i = 0; i < d.length; i += 4) {
          const q = f[d[i] > corte ? 1 : 0];
          d[i] = q[0]; d[i + 1] = q[1]; d[i + 2] = q[2]; d[i + 3] = 255;
        }
        if (estilo === "rua") for (let x = 0; x < w; x++) for (const y of [0, h - 1]) d.set(f[1].concat(255), (y * w + x) * 4);
        c.putImageData(img, 0, 0);
      }
      telas.set(chave, cv);
      return cv;
    }
    return { letreiro, pedir, get pronto() { return pronto; } };
  }
  return { criar };
})();
window.CidadeLetreiro = CidadeLetreiro;
