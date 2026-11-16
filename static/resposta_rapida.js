// Resposta rápida: os botões prontos da caixa de responder a um agente (app.js, caixaResposta). O toque só PREENCHE o
// campo; quem envia é a pessoa, pelo Enviar de sempre (mesmo caminho, limite e guarda). Com rascunho, a resposta entra
// na linha de baixo; se passar do limite do campo, ou com a caixa desabilitada ou enviando, nada muda.
"use strict";
const RespostaRapida = (() => {
  const RESPOSTAS = Object.freeze(["Pode seguir", "Sim", "Não", "Pare", "Resuma o que fez"]);
  function preencher(ta, texto) {
    if (ta.disabled || ta.readOnly) return false;
    const novo = ta.value.trim() ? `${ta.value.replace(/\s+$/, "")}\n${texto}` : texto;
    if (novo.length > ta.maxLength) return false;
    ta.value = novo;
    return true;
  }
  // depois(ta): quem montou ajusta o contador, a altura e o foco
  function montar(ta, depois) {
    const g = document.createElement("div");
    g.className = "cp-rapidas";
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", "Respostas prontas: preenchem a caixa, e você confere antes de enviar");
    for (const texto of RESPOSTAS) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "cp-rapida"; b.textContent = texto;
      b.addEventListener("click", () => { if (preencher(ta, texto)) depois(ta); });
      g.append(b);
    }
    return g;
  }
  return { RESPOSTAS, montar };
})();
window.RespostaRapida = RespostaRapida;
