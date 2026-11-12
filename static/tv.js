// Modo TV: o mapa sozinho numa tela da sala, com um diretor de câmera que corre para o que acontece.
// Abre por ?tv=1 ou pelo botão do mapa. O app.js entrega a câmera em TV.iniciar(api); aqui só se decide
// para onde olhar e por quanto tempo. Sem som próprio (o som segue a escolha de quem liga).
// A TV é o mapa: ligar leva ao #escritorio, então /?tv=1#jornal abre a TV (o hash de outra página é trocado).
"use strict";

const TV = (() => {
  // pedido seu primeiro, depois briga ou greve, depois "terminou", depois "começou"
  const PRIORIDADE = { pediu_aprovacao: 3, pediu_resposta: 3, briga: 2, greve: 2, terminou: 1, comecou: 0, voltou_a_trabalhar: 0 };
  const FICA = { 3: 12000, 2: 12000, 1: 9000, 0: 8000 };   // 8 a 12 s em cada evento
  const PASSEIO = 10000;        // sem evento: 10 s numa sala e 10 s na visão geral (uma sala a cada 20 s)
  const DEVOLVE = 30000;        // um toque devolve o controle por 30 s
  const VELHO = 120000;         // evento que esperou mais de 2 min na fila já não é notícia
  const FILA_MAX = 12, VISTOS_MAX = 300;
  const MUNDO_A_CADA = 300000, MUNDO_FICA = 45000;   // sem notícia, o mundo (/mundo.html?tv=1) por 45 s a cada 5 min
  const menosMovimento = matchMedia("(prefers-reduced-motion: reduce)");
  const $ = id => document.getElementById(id);

  let api = null, ligada = false, relogio = 0, wake = null, pedindoWake = false, parado = 0, configV = null;
  let fila = [], atual = null, ate = 0, pausaAte = 0, passeio = { sala: -1, geral: true }, mundoEm = 0;
  const vistos = new Set();     // eventos e cenas já mostrados (ou que já existiam quando a TV ligou)

  const urlTv = () => new URLSearchParams(location.search).get("tv") === "1";
  const telaCheiaDoNavegador = () => !!document.fullscreenElement || matchMedia("(display-mode: fullscreen)").matches;

  function iniciar(a) {
    api = a;
    $("modo-tv").addEventListener("click", () => ligar(true));
    $("tv-sair").addEventListener("click", desligar);
    $("tv-cheia").addEventListener("click", pedirTelaCheia);
    document.addEventListener("fullscreenchange", () => { $("tv-cheia").hidden = !ligada || telaCheiaDoNavegador(); });
    document.addEventListener("visibilitychange", pedirWake);
    // mouse parado: some o cursor e o botão de sair (o teclado continua achando o botão pelo foco)
    document.addEventListener("pointermove", () => {
      if (!ligada) return;
      document.body.classList.remove("tv-quieto"); clearTimeout(parado);
      parado = setTimeout(() => document.body.classList.add("tv-quieto"), 3000);
    });
    if (urlTv()) ligar(false);
  }

  // gesto: veio de um clique (pode pedir a tela cheia do navegador); pelo endereço, oferece o botão
  function ligar(gesto) {
    if (ligada) return;
    ligada = true;
    api.irAoMapa();
    if (!urlTv()) { const u = new URL(location.href); u.searchParams.set("tv", "1"); history.replaceState(history.state, "", u); }   // recarregar continua na TV
    document.body.classList.add("tv", "tv-quieto");
    api.fecharFicha(); api.telaCheia(true);
    if (gesto) pedirTelaCheia(); else $("tv-cheia").hidden = telaCheiaDoNavegador() || !document.fullscreenEnabled;
    pedirWake(); api.aoLigar();
    fila = []; atual = null; ate = 0; pausaAte = 0; passeio = { sala: -1, geral: true }; mundoEm = performance.now();
    marcarVistos(api.estado());   // o que já estava acontecendo não vira notícia
    api.verTudo(true);
    relogio = setInterval(passo, 500);
    $("tv-sair").focus({ preventScroll: true });
  }

  function desligar() {
    if (!ligada) return;
    ligada = false;
    clearInterval(relogio); relogio = 0; clearTimeout(parado);
    if (wake) { wake.release().catch(() => {}); wake = null; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const u = new URL(location.href); u.searchParams.delete("tv"); history.replaceState(history.state, "", u);
    document.body.classList.remove("tv", "tv-quieto");
    $("tv-legenda").hidden = true; $("tv-cheia").hidden = true; mundo(false);
    fila = []; atual = null; configV = null;
    api.soltar(); api.telaCheia(false);
    $("modo-tv").focus({ preventScroll: true });
  }

  function pedirTelaCheia() {
    if (!document.fullscreenEnabled || document.fullscreenElement) return;
    document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => { $("tv-cheia").hidden = false; });
  }

  // Wake Lock: a tela não apaga; o navegador solta ao esconder a aba, então pede de novo na volta
  async function pedirWake() {
    if (!ligada || wake || pedindoWake || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
    pedindoWake = true;
    try {
      const w = await navigator.wakeLock.request("screen");
      if (!ligada) { w.release().catch(() => {}); return; }   // saiu da TV enquanto o pedido corria: não deixa a tela presa acesa
      wake = w;
      w.addEventListener("release", () => { if (wake === w) wake = null; });
    } catch (e) { /* bateria fraca ou sem permissão: a TV segue, só sem a trava */ } finally { pedindoWake = false; }
  }

  // ---------- fila de notícias ------------------------------------------------------
  const chave = v => `${v.em}|${v.tipo}|${v.agente}|${v.run_id || ""}`;
  function lembrar(k) {
    vistos.add(k);
    if (vistos.size > VISTOS_MAX) vistos.delete(vistos.values().next().value);   // o Set guarda a ordem de entrada
  }
  function marcarVistos(est) {
    if (!est) return;
    for (const v of api.eventos(est)) lembrar(chave(v));
    const c = api.cena(); if (c) lembrar(`cena:${c.id}`);
  }

  // a cada leitura do /api/estado (10 s)
  function atualizar(est) {
    if (!ligada || !est) return;
    if (typeof est.config_v === "string") {   // servidor antigo, sem a chave: nada a fazer
      if (configV === null) configV = est.config_v;
      else if (est.config_v !== configV) { location.reload(); return; }   // mudou times, marca, planta, clima...
    }
    const agora = performance.now();
    for (const v of api.eventos(est)) {
      const k = chave(v);
      if (vistos.has(k) || !Object.hasOwn(PRIORIDADE, v.tipo)) continue;
      lembrar(k);
      fila.push({ tipo: v.tipo, agente: v.agente, prio: PRIORIDADE[v.tipo], entrou: agora });
    }
    const c = api.cena();
    if (c && !vistos.has(`cena:${c.id}`)) { lembrar(`cena:${c.id}`); fila.push({ tipo: c.tipo, prio: 2, entrou: agora }); }
    fila.sort((a, b) => b.prio - a.prio || b.entrou - a.entrou);
    fila.length = Math.min(fila.length, FILA_MAX);
  }

  // ---------- diretor ---------------------------------------------------------------
  function passo() {
    const agora = performance.now();
    if (agora < pausaAte) return;
    fila = fila.filter(n => agora - n.entrou < VELHO);
    // notícia entra na hora durante o passeio; durante outra notícia, só se for mais importante e a outra já teve 4 s de tela
    const furar = fila.length > 0 && (!atual || (fila[0].prio > atual.prio && agora - atual.desde > 4000));
    if (agora < ate && !furar) {
      if (atual && atual.agente && !api.temAgente(atual.agente)) ate = 0;   // o agente saiu do mapa: próxima cena
      return;
    }
    for (let n; (n = fila.shift());) if (mostrar(n, agora)) return;   // a de agente fora do mapa cai e passa a próxima, sem trocar o passeio
    passear(agora);
  }

  function mostrar(n, agora) {
    const ja = menosMovimento.matches;   // movimento reduzido: corta em vez de deslizar
    mundo(false);   // a notícia fura o mundo
    if (n.agente) {
      if (!api.seguirAgente(n.agente, ja)) return false;
      const a = api.agente(n.agente);
      legenda(a ? a.ap : null, a ? a.nome : n.agente, api.frase(n.tipo), n.prio >= 2 ? "alerta" : n.prio === 1 ? "feito" : "");
    } else {
      const s = api.salaDaCena(); if (!s) return false;
      api.enquadrar(s, ja);
      legenda(null, n.tipo === "briga" ? "Briga no ringue!" : `Greve na ${s.nome}!`, "", "alerta");
    }
    atual = { ...n, desde: agora }; ate = agora + FICA[n.prio];
    return true;
  }

  // sem notícia: uma sala com gente, depois a visão geral, e assim por diante
  function passear(agora) {
    const ja = menosMovimento.matches;
    atual = null; ate = agora + PASSEIO;
    if (agora - mundoEm > MUNDO_A_CADA && !$("tv-mundo")) {
      mundoEm = agora; ate = agora + MUNDO_FICA; mundo(true); $("tv-legenda").hidden = true;
      return;
    }
    mundo(false);
    const salas = api.salasComGente();
    if (passeio.geral && salas.length) {
      passeio.sala = (passeio.sala + 1) % salas.length;
      const s = salas[passeio.sala];
      api.enquadrar(s.sala, ja);
      legenda(null, s.sala.nome, s.n === 1 ? "1 agente aqui" : `${s.n} agentes aqui`, "sala");
      passeio.geral = false;
    } else {
      api.soltar(); api.verTudo(ja);
      $("tv-legenda").hidden = true;
      passeio.geral = true;
    }
  }

  // o mundo por cima do mapa, sem foco nem clique (um toque cai no mapa, devolve o controle e fecha o mundo)
  function mundo(abrir) {
    const f = $("tv-mundo");
    if (!abrir) { if (f) f.remove(); return; }
    if (f) return;
    const novo = document.createElement("iframe");
    novo.id = "tv-mundo"; novo.className = "tv-mundo"; novo.src = "/mundo.html?tv=1"; novo.title = "Mundo dos escritórios";
    novo.tabIndex = -1; novo.setAttribute("aria-hidden", "true");
    $("tv-legenda").before(novo);
  }

  // faixa de baixo, estilo telejornal: boneco, quem e o quê
  function legenda(ap, titulo, texto, tom) {
    const l = $("tv-legenda");
    l.className = `tv-legenda${tom ? ` ${tom}` : ""}`;
    const partes = [];
    if (ap) partes.push(api.mini(ap));
    const txt = document.createElement("span"); txt.className = "tv-legenda-txt";
    const forte = document.createElement("strong"); forte.textContent = titulo; txt.append(forte);
    if (texto) txt.append(` ${texto}`);
    partes.push(txt);
    l.replaceChildren(...partes);
    l.hidden = false;
  }

  // mexeu no mapa (toque, arrasto, roda, teclado): o controle volta para a pessoa por 30 s
  function tocou() {
    if (!ligada) return;
    pausaAte = performance.now() + DEVOLVE; ate = 0; atual = null;
    $("tv-legenda").hidden = true; mundo(false);
  }

  return {
    iniciar, atualizar, tocou, desligar,
    get ligada() { return ligada; },
    get invisivel() { return ligada || urlTv(); },   // a leitura antes de a TV ligar (?tv=1) também não marca presença
  };
})();

window.TV = TV;
