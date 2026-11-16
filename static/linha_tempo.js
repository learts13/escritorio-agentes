// Linha do tempo dos agentes (servidor: linha.py, GET /api/fora e /api/linha). Duas peças:
// - a faixa "Enquanto você esteve fora" (#faixa-ausencia), no topo do escritório, quando a última visita a este andar
//   (localStorage, por andar) foi há mais de 1 h e houve algo; fechável; cada item leva ao agente;
// - a linha de hoje no cartão do agente (noCard), pedida no máximo 1 vez por minuto por agente.
// Os nomes levam data-sensivel (o modo apresentação os esconde). Só textContent: nada de innerHTML com dado.
"use strict";
const LinhaTempo = (() => {
  const LONGE = 3600 * 1000, MARCAR_A_CADA = 5 * 60 * 1000, CACHE = 60 * 1000;
  const FUSO = "America/Sao_Paulo";
  const FMT_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
  const FMT_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
  const FMT_DM = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" });
  const ESPEROU = { aprovacao: "aprovação", resposta: "resposta" };
  let json = null, agora = () => Date.now();
  const cache = new Map();   // id do agente -> { em, itens (undefined: carregando; null: falhou), ol (o da tela) }

  const chave = andar => `escritorio:visita:${andar}`;
  function lerVisita(andar) {
    try { const v = Number(localStorage.getItem(chave(andar))); return v > 0 ? v : null; } catch (e) { return null; }   // aba anônima
  }
  function marcarVisita(andar) {
    try { localStorage.setItem(chave(andar), String(agora())); } catch (e) { /* armazenamento bloqueado: sem a faixa */ }
  }

  function duracao(s) {
    const min = Math.floor(s / 60);
    if (min < 1) return "menos de 1 min";
    const h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
  }
  function frase(t) {
    if (t.para === "aprovacao") return "pediu aprovação";
    if (t.para === "resposta") return "fez uma pergunta";
    if (t.para === "livre") return "terminou uma tarefa";
    return t.de === "livre" ? "começou uma tarefa" : "voltou a trabalhar";
  }
  function resumoDoAgente(a) {
    const partes = [];
    if (a.tarefas) partes.push(a.tarefas === 1 ? "1 tarefa concluída" : `${a.tarefas} tarefas concluídas`);
    for (const s of a.esperas || []) {
      partes.push(s.resolvida ? `esperou ${ESPEROU[s.tipo]} ${duracao(s.duracao_s)}, resolvido`
        : `espera ${ESPEROU[s.tipo]} há ${duracao(s.duracao_s)}`);
    }
    return partes.join(" · ");
  }
  function quando(ms) {   // "18:00", "ontem, 18:00" ou "14/11, 18:00", no fuso de Brasília
    const dia = FMT_DIA.format(new Date(ms)), hoje = FMT_DIA.format(new Date(agora()));
    const ontem = FMT_DIA.format(new Date(Date.parse(`${hoje}T12:00:00Z`) - 86400 * 1000));
    const hora = FMT_HORA.format(new Date(ms));
    return dia === hoje ? hora : dia === ontem ? `ontem, ${hora}` : `${FMT_DM.format(new Date(ms))}, ${hora}`;
  }

  function el(tag, classe, txt) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function mostrarFaixa(r, nome, ir) {
    const f = document.getElementById("faixa-ausencia");
    const topo = el("div", "lt-topo"), titulo = el("h2", "lt-titulo", "Enquanto você esteve fora");
    titulo.id = "lt-titulo";
    const fechar = el("button", "lt-fechar", "×");
    fechar.type = "button";
    fechar.setAttribute("aria-label", "Fechar o resumo de enquanto você esteve fora");
    fechar.addEventListener("click", () => { f.hidden = true; });
    topo.append(titulo, el("span", "lt-desde", `desde ${quando(r.desde * 1000)}`), fechar);
    const lista = el("ul", "lt-lista");
    for (const a of r.agentes) {
      const li = el("li"), b = el("button", "lt-item"), n = el("strong", "lt-nome", nome(a.agente) || "Agente");
      b.type = "button";
      n.setAttribute("data-sensivel", "");
      b.append(n, el("span", "lt-resumo", resumoDoAgente(a)));
      b.addEventListener("click", () => ir(a.agente));
      li.append(b);
      lista.append(li);
    }
    f.setAttribute("aria-labelledby", "lt-titulo");
    f.replaceChildren(topo, lista);
    f.hidden = false;
  }

  // opcoes: { json (o do app.js, que põe o andar), nome(id), ir(id), andar, agora? }
  async function iniciar(opcoes) {
    configurar(opcoes);
    const { andar, nome, ir } = opcoes, ultima = lerVisita(andar);
    marcarVisita(andar);
    setInterval(() => { if (document.visibilityState === "visible") marcarVisita(andar); }, MARCAR_A_CADA);
    document.addEventListener("visibilitychange", () => marcarVisita(andar));
    if (!ultima || agora() - ultima < LONGE) return;
    const r = await json(`api/fora?desde=${Math.floor(ultima / 1000)}`).catch(() => null);
    if (r && Array.isArray(r.agentes) && r.agentes.length) mostrarFaixa(r, nome, ir);
  }
  function configurar(opcoes) {
    json = opcoes.json;
    if (opcoes.agora) agora = opcoes.agora;
  }

  function preencher(ol, itens) {
    if (itens === undefined) { ol.replaceChildren(el("li", "lt-vazio", "Carregando…")); return; }
    if (itens === null) { ol.replaceChildren(el("li", "lt-vazio", "Não deu para carregar agora.")); return; }
    if (!itens.length) { ol.replaceChildren(el("li", "lt-vazio", "Nada registrado hoje.")); return; }
    ol.replaceChildren(...itens.slice(-8).map(t => {   // as 8 mais recentes
      const li = el("li"), h = el("time", "lt-hora", FMT_HORA.format(new Date(t.em * 1000)));
      li.append(h, document.createTextNode(` ${frase(t)}`));
      return li;
    }));
  }
  function noCard(id) {
    const ol = el("ol", "lt-dia");
    ol.setAttribute("aria-label", "Linha do tempo de hoje");
    const c = cache.get(id);
    preencher(ol, c && c.itens);
    if (c) c.ol = ol;   // a ficha é refeita a cada mudança: a resposta vai para o cartão que está na tela
    if (c && agora() - c.em < CACHE) return ol;
    const novo = { em: agora(), itens: c && c.itens, ol };
    cache.set(id, novo);
    json(`api/linha?agente=${encodeURIComponent(id)}`)
      .then(r => (Array.isArray(r && r.itens) ? r.itens : null), () => null)
      .then(itens => { novo.itens = itens; novo.em = agora(); preencher(novo.ol, itens); });
    return ol;
  }

  return { iniciar, configurar, noCard, frase, duracao, resumoDoAgente };
})();
window.LinhaTempo = LinhaTempo;
