"use strict";
// Modo apresentação (1.6 Onda 3): para mostrar a tela numa chamada com cliente ou postar um print sem vazar nada. Os
// bonecos ficam; os nomes viram "Agente 1", "Pessoa 2" e "Você" (o vida.js pergunta aqui, Vida.renomear); os balões
// somem (o app.js pergunta ligado()); e o estilo.css esconde, pela classe html.apresentacao, o que mostra nome, tarefa,
// conversa, mural e recado. Lembrado por aba (sessionStorage), com um botão na barra da câmera e o atalho Alt+Shift+P.
const Apresentacao = (() => {
  const CHAVE = "escritorio:apresentacao", ATALHO = "Alt+Shift+P";
  const numeros = new Map(), contagem = { agente: 0, pessoa: 0, terminal: 0 };
  let ligado = false, botao = null;
  try { ligado = sessionStorage.getItem(CHAVE) === "1"; } catch (e) { /* armazenamento bloqueado: começa desligado */ }

  // o nome mostrado: o de sempre, ou o pseudônimo, numerado pela ordem em que cada um aparece (o mesmo até fechar a aba).
  // Agente pelo handle, pessoa pelo "usuario" (no saguão, o id opaco): o número segue a conta, não o nome
  function nome(b) {
    if (!b) return "";
    if (!ligado) return b.nome;
    if (b.eu) return "Você";
    const tipo = b.terminal ? "terminal" : typeof b.usuario === "string" ? "pessoa" : "agente", chave = `${tipo}:${tipo === "pessoa" ? b.usuario : b.handle || b.id}`;
    if (!numeros.has(chave)) numeros.set(chave, ++contagem[tipo]);
    return `${{ pessoa: "Pessoa", terminal: "Terminal" }[tipo] || "Agente"} ${numeros.get(chave)}`;
  }

  function ligar(sim) {
    ligado = !!sim;
    try { if (ligado) sessionStorage.setItem(CHAVE, "1"); else sessionStorage.removeItem(CHAVE); } catch (e) { /* fica só nesta visita */ }
    aplicar();
    if (window.Vida && typeof Vida.renomear === "function") Vida.renomear();
    window.dispatchEvent(new CustomEvent("apresentacao", { detail: { ligado } }));
  }
  const alternar = () => ligar(!ligado);

  function aplicar() {
    document.documentElement.classList.toggle("apresentacao", ligado);
    if (!botao) return;
    botao.setAttribute("aria-pressed", String(ligado));
    botao.setAttribute("aria-label", ligado ? "Desligar o modo apresentação" : "Modo apresentação: esconder nomes e textos");
    botao.title = `${ligado ? "Desligar o modo apresentação" : "Modo apresentação: esconde nomes, tarefas e conversas"} (${ATALHO})`;
  }

  // o ícone: um olho riscado, desenhado em SVG (sem innerHTML)
  function icone() {
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    for (const [k, v] of [["width", "18"], ["height", "18"], ["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"],
      ["stroke-width", "2"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"]]) svg.setAttribute(k, v);
    for (const d of ["M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z", "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z", "M4 20 20 4"]) {
      const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); svg.append(p);
    }
    return svg;
  }

  const barra = document.querySelector(".controles");
  if (barra) {
    botao = document.createElement("button");
    botao.type = "button"; botao.className = "apresentacao-bt";
    botao.setAttribute("aria-keyshortcuts", ATALHO);
    botao.append(icone());
    botao.addEventListener("click", alternar);
    barra.append(botao);
  }
  aplicar();

  // Alt+Shift+P pelo code (não muda com o layout do teclado); escrevendo num campo, a tecla fica com o campo
  document.addEventListener("keydown", ev => {
    if (ev.code !== "KeyP" || !ev.altKey || !ev.shiftKey || ev.ctrlKey || ev.metaKey) return;
    const el = document.activeElement;
    if (el && (/INPUT|SELECT|TEXTAREA/.test(el.tagName) || el.isContentEditable)) return;
    ev.preventDefault();
    alternar();
  });

  return { ligado: () => ligado, ligar, alternar, nome };
})();

window.Apresentacao = Apresentacao;
