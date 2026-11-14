// Modo construção: editor da planta do escritório. Monta o prédio pelo mesmo Mapa.montarPredio da página
// (o que se vê aqui é o que todos vão ver) com o rascunho do Planta.rascunho por cima, e grava com o Planta.salvar.
// Pinta parede e piso por sala; move, espelha, tira e põe móveis de chão; desfaz e refaz; volta ao automático.
// Celular: só o aviso. ?demo=1: exemplo próprio, sem /api e sem salvar.
"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const DEMO = new URLSearchParams(location.search).get("demo") === "1";
  const SO_VER = matchMedia("(max-width: 699px), not (any-pointer: fine)");   // o avesso do NO_COMPUTADOR do personalizar.js
  const PASSO = 8;   // setas: 8 px (Shift: 1 px)
  // saída pedida pelo editor (Recarregar do 409, sessão expirada): o rascunho já foi dado como perdido, sem o "Sair do site?"
  let saindo = false;
  const sair = url => { saindo = true; if (url) location.href = url; else location.reload(); };

  const tela = $("tela"), ctx = tela.getContext("2d"), palco = $("palco"), camada = $("camada");
  let config = null, atlas = null, grupos = null, rasc = null, predio = null;
  let fechadas = [], ignorados = [], pecas = new Map(), salas = new Map();   // id -> objeto; chave -> sala
  let sel = null, salaSel = null, porNome = null, arrasto = null, salvando = false;
  let avisoSalvar = null;   // { tipo, texto, acao? } do último salvar
  let semRefazer = null;    // a planta depois de um "não coube": o refazer não volta a tentar o mesmo lugar
  const cam = { x: 0, y: 0, k: 1 };
  let dpr = 1, vw = 0, vh = 0, pedidoDesenho = 0;
  let FIXOS = new Set(), SEM_ESPELHO = new Set();

  for (const a of document.querySelectorAll("[data-voltar]")) a.href = DEMO ? "./?demo=1" : "./" + (Andar.atual === Andar.PRINCIPAL ? "" : `#andar=${Andar.atual}`);   // volta ao andar editado

  // ---------- carga ------------------------------------------------------------------
  // o editor trabalha na planta do andar atual (expediente.js: Andar); o principal não leva nada na query. Andar que
  // sumiu (404 {"codigo":"andar"}): volta para o principal e relê.
  async function json(url) {
    const api = url.startsWith("api/");
    const r = await fetch(api ? Andar.com(url) : url, { cache: "no-store", credentials: "same-origin" });
    if (r.status === 401) { sair("/entrar"); throw new Error("sessão expirou"); }
    if (r.status === 404 && api && Andar.atual !== Andar.PRINCIPAL) {
      const d = await r.json().catch(() => null);
      if (d && d.codigo === "andar") { Andar.limpar(); return json(url); }
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  const imagem = src => new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = src; });

  // demonstração: exemplo próprio (nada vem do servidor e nada é salvo)
  function demo() {
    const time = (nome, tipo, cor, icone, agentes) => ({ nome, tipo, cor, icone, agentes });
    const cfg = { empresa: "Estúdio Exemplo", cor: "#a855f7", aparencia: {},
      times: [time("Dev", "mesas", "#3b82f6", "codigo", ["aurora", "bento", "cacau"]), time("Produto", "mesas", "#8b5cf6", "grafico", ["dara", "enzo"]),
        time("Marketing", "mesas", "#e8587a", "megafone", ["flora", "gael"]), time("Ops", "ops", "#10b981", "servidor", ["jade"])],
      planta: { rev: 0, salas: { "time:Marketing": { parede: 4 }, cozinha: { piso: 2 } }, moveis: {}, novos: [] } };
    const agentes = ["aurora", "bento", "cacau", "dara", "enzo", "flora", "gael", "jade"].map(h => ({ handle: h }));
    return { cfg, agentes };
  }

  async function iniciar() {
    if (SO_VER.matches) return;   // celular ou sem mouse: só o aviso (CSS)
    let agentes = [];
    try {
      if (DEMO) ({ cfg: config, agentes } = demo());
      else { config = await json("api/config"); agentes = (await json("api/estado")).agentes || []; }
      const mapaJson = await json("tema/atlas.json");
      atlas = { img: await imagem(`tema/atlas.png?v=${encodeURIComponent(mapaJson.versao || "")}`), json: mapaJson };
      try { await document.fonts.load(Mapa.PLACA_FONTE); } catch (e) { /* sem a fonte, o nome usa a reserva */ }
    } catch (e) {
      $("carregando").textContent = "Não deu para abrir o editor agora. Recarregue a página.";
      return;
    }
    if (config.cor) aplicarCor(config.cor);
    FIXOS = Mapa.FIXOS instanceof Set ? Mapa.FIXOS : new Set();
    SEM_ESPELHO = Mapa.SEM_ESPELHO instanceof Set ? Mapa.SEM_ESPELHO : new Set();
    grupos = Planta.grupos(config, Array.isArray(agentes) ? agentes : []);
    rasc = Planta.rascunho(config.planta || Planta.vazia());
    montar();
    const fora = ignorados.length;
    if (fora) avisoIgnorados(fora);
    if (DEMO) $("ed-sub").textContent = "Demonstração: mexa à vontade, nada é salvo.";
    else if (Andar.atual !== Andar.PRINCIPAL) {   // vários andares: diz em qual a planta está sendo editada
      const a = (Array.isArray(config.andares) ? config.andares : []).find(x => x && x.id === Andar.atual);
      if (a && typeof a.nome === "string" && a.nome.length <= 80) $("ed-sub").textContent = `Editando a planta do andar ${a.nome}. Mova, espelhe, tire e ponha móveis e pinte as salas.`;
    }
    $("carregando").hidden = true;
    medir(); verTudo();
    montarAmostras(); montarCatalogo();
    escolherSala(predio.salas[0] && predio.salas[0].chave);
    new ResizeObserver(() => { medir(); desenhar(); }).observe(palco);
    atualizar();
  }

  // cor da marca: o texto sobre ela fica escuro ou claro, o que der mais contraste (a mesma regra do app.js)
  function luminancia(hex) {
    const n = parseInt(hex.slice(1), 16), c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(n >> 16) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255);
  }
  function aplicarCor(cor) {
    if (!/^#[0-9a-f]{6}$/i.test(cor)) return;
    const l = luminancia(cor), escuro = (l + 0.05) / (luminancia("#1a1408") + 0.05), claro = 1.05 / (l + 0.05);
    document.documentElement.style.setProperty("--destaque", cor);
    document.documentElement.style.setProperty("--destaque-texto", escuro >= claro ? "#1a1408" : "#ffffff");
  }

  // ---------- montagem -----------------------------------------------------------------
  // Refaz o prédio com o rascunho atual (o mesmo montarPredio da página) e tudo o que depende dele.
  function montar() {
    predio = Mapa.montarPredio(atlas, config, grupos, rasc.planta);
    Efeitos.iniciar(predio, atlas, config, null);
    fechadas = Planta.semPassagem(predio);
    ignorados = (predio.planta && Array.isArray(predio.planta.ignorados)) ? predio.planta.ignorados : [];
    salas = new Map();
    for (const s of [...predio.salas, ...predio.baixo]) if (s.chave) salas.set(s.chave, s);
    pecas = new Map();
    for (const o of predio.objetos) if (typeof o.id === "string" && o.salaChave && salas.has(o.salaChave)) pecas.set(o.id, o);
    if (sel && !pecas.has(sel)) sel = null;
    montarCamada();
    desenhar();
  }

  // uma peça focável por móvel, na mesma ordem de desenho (a da frente fica por cima e recebe o clique)
  function montarCamada() {
    const focada = document.activeElement && document.activeElement.classList.contains("peca") ? document.activeElement.dataset.id : null;
    const lista = [...pecas.values()].sort((a, b) => a.chave - b.chave);
    const frag = document.createDocumentFragment();
    for (const o of lista) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "peca"; b.dataset.id = o.id;
      b.style.left = `${o.x}px`; b.style.top = `${o.y}px`; b.style.width = `${o.w}px`; b.style.height = `${o.h}px`;
      b.setAttribute("aria-label", `${nomePeca(o.nome)}, ${nomeSala(o.salaChave)}`);
      b.setAttribute("aria-pressed", String(o.id === sel));
      frag.append(b);
    }
    camada.replaceChildren(frag);
    if (focada) { const b = botaoDa(focada); if (b) b.focus({ preventScroll: true }); }
  }
  const botaoDa = id => [...camada.children].find(b => b.dataset.id === id) || null;

  // ---------- nomes ------------------------------------------------------------------
  const PALAVRAS = { sofa: "sofá", luminaria: "luminária", armario: "armário", aquario: "aquário", relogio: "relógio", violao: "violão", estacao: "estação",
    balcao: "balcão", agua: "água", maquina: "máquina", cafe: "café", tv: "TV", arvore: "árvore", grafico: "gráfico", estatua: "estátua", cha: "chá",
    radio: "rádio", recepcao: "balcão da recepção" };
  function nomePeca(nome) { // "planta_alta2" -> "Planta alta" (a variação numerada fica no catálogo)
    const t = String(nome).split("_").filter(w => !/^[a-z]?\d+$/.test(w)).map(w => w.replace(/\d+$/, ""))
      .map(w => (Object.hasOwn(PALAVRAS, w) ? PALAVRAS[w] : w)).join(" ") || String(nome);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const nomeSala = chave => (salas.has(chave) ? salas.get(chave).nome : String(chave).replace(/^time:/, ""));

  // ---------- câmera -----------------------------------------------------------------
  function medir() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = palco.clientWidth; vh = palco.clientHeight;
    tela.width = Math.max(1, Math.round(vw * dpr)); tela.height = Math.max(1, Math.round(vh * dpr));
    tela.style.width = `${vw}px`; tela.style.height = `${vh}px`;
    if (predio) { cam.k = limitarK(cam.k); prender(); aplicarCamada(); }
  }
  const quadroVisto = () => predio.predioRet || { x: 0, y: 0, w: predio.W, h: predio.H };
  function encaixe() { const r = quadroVisto(); return Math.min(vw / (r.w + 24), vh / (r.h + 24)) * dpr; }
  const limitarK = k => Math.max(encaixe() * 0.8, Math.min(8 * dpr, k));
  function prender() { cam.x = Math.max(0, Math.min(predio.W, cam.x)); cam.y = Math.max(0, Math.min(predio.H, cam.y)); }
  function verTudo() { const r = quadroVisto(); cam.x = r.x + r.w / 2; cam.y = r.y + r.h / 2; cam.k = encaixe(); aplicarCamada(); desenhar(); }
  function zoom(f, cx = vw / 2, cy = vh / 2) {
    const antes = paraMundo(cx, cy, true);
    cam.k = limitarK(cam.k * f);
    const depois = paraMundo(cx, cy, true);
    cam.x += antes.x - depois.x; cam.y += antes.y - depois.y;
    prender(); aplicarCamada(); desenhar();
  }
  // ponto da tela (CSS px; local = relativo ao palco) -> mundo
  function paraMundo(cx, cy, local) {
    const r = local ? { left: 0, top: 0 } : palco.getBoundingClientRect();
    return { x: cam.x + ((cx - r.left) * dpr - tela.width / 2) / cam.k, y: cam.y + ((cy - r.top) * dpr - tela.height / 2) / cam.k };
  }
  function aplicarCamada() {
    const k = cam.k / dpr;
    camada.style.transform = `translate(${vw / 2 - cam.x * k}px, ${vh / 2 - cam.y * k}px) scale(${k})`;
    camada.style.setProperty("--k", k);
  }

  // ---------- desenho (sem bonecos e sem vida social; parado, como o app com menos movimento) ------
  function desenhar() {
    if (!predio || pedidoDesenho) return;
    pedidoDesenho = requestAnimationFrame(() => { pedidoDesenho = 0; pintar(); });
  }
  function spr(nome, x, y) {
    const s = atlas.json.sprites[nome]; if (!s) return;
    ctx.drawImage(atlas.img, s[0], s[1], s[2], s[3], Math.round(x), Math.round(y), s[2], s[3]);
  }
  function objeto(o) { // a regra do desenharObjeto do app.js
    if (o.tipo === "mesa") Mapa.desenharMesa(ctx, o.mesa.x, o.mesa.topo, "apagada", 0, o.mesa);
    else if (o.tipo === "cadeira") Mapa.desenharCadeira(ctx, o.x, o.y, o.cor, o.estilo);
    else {
      if (o.espelho) { ctx.save(); ctx.translate(2 * o.x + o.w, 0); ctx.scale(-1, 1); }
      if (!Efeitos.objeto(ctx, o, 0)) spr(o.nome, o.x, o.y);
      if (o.espelho) ctx.restore();
    }
  }
  function animado(a) { if (a.tipo !== "tela") spr(`${a.tipo}_0`, a.x, a.y); }

  function pintar() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0d11"; ctx.fillRect(0, 0, tela.width, tela.height);
    ctx.setTransform(cam.k, 0, 0, cam.k, tela.width / 2 - cam.x * cam.k, tela.height / 2 - cam.y * cam.k);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(predio.fundo, 0, 0);
    const ceu = Ceu.agora();
    for (const j of predio.janelas) Ceu.janela(ctx, j, ceu, 0);
    for (const a of predio.animados) if (a.parede) animado(a);
    const arr = arrasto && arrasto.ativo ? arrasto : null;
    const cena = [];
    for (const o of predio.objetos) cena.push({ chave: o.chave, desenha: () => { if (arr && arr.id === o.id) { ctx.globalAlpha = 0.25; objeto(o); ctx.globalAlpha = 1; } else objeto(o); } });
    for (const a of predio.animados) if (!a.parede) cena.push({ chave: a.chave, desenha: () => animado(a) });
    cena.sort((a, b) => a.chave - b.chave).forEach(c => c.desenha());

    const fino = dpr / cam.k, destaque = Mapa.cor("destaque");
    if (salaSel && salas.has(salaSel)) { // sala escolhida para pintar ou pôr
      const s = salas.get(salaSel);
      ctx.strokeStyle = destaque; ctx.lineWidth = 2 * fino; ctx.setLineDash([6 * fino, 4 * fino]);
      ctx.strokeRect(s.px + fino, s.py + fino, s.pw - 2 * fino, s.ph - 2 * fino); ctx.setLineDash([]);
    }
    for (const v of fechadas) { // assento sem passagem: anel vermelho com borda escura, de pelo menos 10 px na tela (visível sobre tapete vermelho)
      ctx.beginPath(); ctx.arc(v.x, v.y, Math.max(6, 10 * fino), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,90,79,.35)"; ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.lineWidth = 5 * fino; ctx.stroke();
      ctx.strokeStyle = "#ff5a4f"; ctx.lineWidth = 2.5 * fino; ctx.stroke();
    }
    const o = sel && pecas.get(sel);
    if (o && !arr) contorno(o.x, o.y, o.w, o.h, destaque, fino);
    if (arr) { // fantasma da peça durante o arraste; o prédio é refeito ao soltar
      const f = { ...pecas.get(arr.id), x: arr.gx, y: arr.gy };
      ctx.globalAlpha = 0.8; objeto(f); ctx.globalAlpha = 1;
      contorno(f.x, f.y, f.w, f.h, destaque, fino);
    }
    nomesDasSalas();
  }
  function contorno(x, y, w, h, cor, fino) {
    ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 3 * fino; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    ctx.strokeStyle = cor; ctx.lineWidth = 2 * fino; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  }
  function nomesDasSalas() { // nome de cada sala no canto do chão, em tamanho de tela (legível em qualquer zoom)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const tam = Math.round(11 * dpr);
    ctx.font = `700 ${tam}px Figtree, system-ui, sans-serif`; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    for (const s of salas.values()) {
      const x = tela.width / 2 + (s.px - cam.x) * cam.k + 6 * dpr, y = tela.height / 2 + (s.chao - cam.y) * cam.k + 6 * dpr;
      const w = Math.ceil(ctx.measureText(s.nome).width) + 12 * dpr, h = tam + 8 * dpr;
      if (w > s.pw * cam.k - 8 * dpr) continue;   // a sala ficou pequena demais na tela para o nome
      ctx.fillStyle = s.chave === salaSel ? "rgba(15,15,14,.92)" : "rgba(15,15,14,.72)";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#efefec"; ctx.fillText(s.nome, x + 6 * dpr, y + h / 2 + dpr * 0.5);
    }
  }

  // ---------- ações ------------------------------------------------------------------
  const anunciar = t => { const a = $("anuncio"); a.textContent = ""; setTimeout(() => { a.textContent = t; }, 30); };

  // aplica uma ação do rascunho, refaz o prédio e diz o resultado; devolve true se a planta mudou
  function agir(feito, texto) {
    if (typeof feito === "string") { anunciar(feito); avisar("atencao", feito); return false; }   // limite da planta
    if (!feito) return false;
    avisoSalvar = null; avisoTemp = null;   // um aviso antigo ("não coube", limite) não fica preso depois de uma ação que deu certo
    montar(); atualizar();
    if (texto) anunciar(texto);
    return true;
  }
  // mover e pôr: se o mapa não aceitou (colisão, parede, zona protegida), desfaz na hora
  function naoCoube(id) {
    if (!ignorados.includes(id)) return false;
    rasc.desfazer(); semRefazer = rasc.planta; montar(); atualizar();
    const t = "Não coube aqui: voltou para o lugar.";
    anunciar(t); avisar("atencao", t);
    return true;
  }

  function moverPara(id, x, y) {
    const o = pecas.get(id); if (!o) return;
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    if (!agir(rasc.mover(id, x, y, o.auto))) return;
    if (!naoCoube(id)) anunciar(`Peça movida: ${nomePeca(o.nome)}.`);
  }
  function posicao(o) { const s = salas.get(o.salaChave); return { x: o.x + o.w / 2 - s.px, y: o.y + o.h - s.chao }; }

  function espelhar() {
    const o = sel && pecas.get(sel); if (!o || !podeEspelhar(o)) return;
    agir(rasc.espelhar(o.id), `Peça espelhada: ${nomePeca(o.nome)}.`);
  }
  function tirar() {
    const o = sel && pecas.get(sel); if (!o) return;
    const lista = [...camada.children], i = lista.findIndex(b => b.dataset.id === o.id);
    const focoNaPeca = document.activeElement && document.activeElement.classList.contains("peca");
    sel = null;
    if (!agir(rasc.tirar(o.id), `Peça tirada: ${nomePeca(o.nome)}. Ctrl+Z desfaz.`)) return;
    if (focoNaPeca) { const prox = camada.children[Math.min(i, camada.children.length - 1)]; (prox || $("painel")).focus({ preventScroll: true }); }
  }
  function devolver(id) { agir(rasc.limpar([id]), "Peça devolvida ao lugar automático."); }

  function por(s, x, y) {
    if (!porNome || !s) return;
    const nome = porNome;
    const feito = rasc.por(nome, s.chave, Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), false);
    if (!agir(feito)) return;
    const id = `novo:${rasc.planta.novos.length - 1}`;
    if (naoCoube(id)) return;
    escolherPor(null);
    selecionar(id, false);
    anunciar(`Peça posta em ${s.nome}: ${nomePeca(nome)}.`);
  }
  function porNaSala() { // sem arrastar: no meio do chão da sala escolhida
    const s = salas.get(salaSel); if (!s) return;
    por(s, s.pw / 2, (s.py + s.ph - s.chao) / 2 + 8);
  }

  function desfazer() { if (rasc.desfazer()) { avisoSalvar = avisoTemp = null; montar(); atualizar(); anunciar("Desfeito."); } }
  function refazer() { if (rasc.planta !== semRefazer && rasc.refazer()) { avisoSalvar = avisoTemp = null; montar(); atualizar(); anunciar("Refeito."); } }

  const podeMover = o => !!o && !FIXOS.has(o.nome);
  const podeEspelhar = o => !!o && !FIXOS.has(o.nome) && !SEM_ESPELHO.has(o.nome);

  function selecionar(id, focar) {
    sel = id && pecas.has(id) ? id : null;
    for (const b of camada.children) b.setAttribute("aria-pressed", String(b.dataset.id === sel));
    const o = sel && pecas.get(sel);
    if (o) { salaSel = o.salaChave; $("sala").value = salaSel; marcarAmostras(); }
    if (o && focar) { const b = botaoDa(sel); if (b) b.focus({ preventScroll: true }); }
    atualizarPeca(); desenhar();
  }

  // ---------- salvar ------------------------------------------------------------------
  const bloqueioSalvar = () => (DEMO ? "demo" : fechadas.length ? "passagem" : !rasc.mudou() ? "igual" : salvando ? "salvando" : "");

  async function salvar() {
    if (bloqueioSalvar()) return;
    salvando = true; atualizar();
    const enviada = rasc.planta;   // uma edição feita enquanto o pedido está no ar não entra neste salvar
    const res = await Planta.salvar(enviada);
    salvando = false;
    if (!Object.hasOwn(res, "status")) {
      rasc.salvo(res.rev, enviada);
      avisoSalvar = rasc.mudou()
        ? { tipo: "atencao", texto: "Salvo o que foi enviado. O que você mudou durante o envio ainda não está salvo: clique em Salvar de novo." }
        : { tipo: "ok", texto: "Salvo. As outras telas mostram a planta nova ao recarregar.", link: true };
      anunciar(avisoSalvar.texto);
    } else if (res.status === 401) { sair("/entrar"); return; }
    else if (res.status === 409) {
      avisoSalvar = { tipo: "erro", texto: "A planta mudou em outra tela. Recarregue o editor para ver a versão nova (este rascunho não é salvo).", recarregar: true };
      anunciar(avisoSalvar.texto);
    } else {
      avisoSalvar = { tipo: "erro", texto: `${res.mensagem} O rascunho continua aqui.` };
      anunciar(avisoSalvar.texto);
    }
    atualizar();
    focoDepoisDeSalvar();
  }
  // o Salvar fica desabilitado durante o envio e o foco cairia no body: vai para o "Recarregar" do 409 ou para o painel
  function focoDepoisDeSalvar() {
    const a = document.activeElement;
    if (a && a !== document.body && !a.disabled) return;   // quem salvou por outro caminho (Voltar ao automático) fica onde está
    const recarregar = $("avisos").querySelector("[data-recarregar]");
    (recarregar || $("painel")).focus({ preventScroll: true });
  }

  async function voltarAoAutomatico() {
    if (!(await confirmar())) return;
    const feito = rasc.automatico();
    if (feito === false && !rasc.mudou()) { anunciar("O escritório já está no automático."); return; }
    agir(feito, "Tudo voltou ao automático.");
    sel = null; atualizarPeca();
    if (!DEMO && rasc.mudou()) await salvar();
  }

  async function descartar() {
    if (!rasc.mudou()) return;
    let planta = DEMO ? demo().cfg.planta : null;
    if (!DEMO) {
      try { config = await json("api/config"); planta = config.planta || Planta.vazia(); }
      catch (e) { avisar("erro", "Não deu para reler a planta salva agora. Tente de novo."); return; }
    }
    rasc = Planta.rascunho(planta);
    sel = null; avisoSalvar = null;
    montar(); atualizar(); marcarAmostras();
    anunciar("Rascunho descartado: voltou o que está salvo.");
  }

  // diálogo de confirmação do próprio app (sem confirm nativo); Esc e "Cancelar" respondem não
  function confirmar() {
    const d = $("dlg-auto"), volta = document.activeElement;
    return new Promise(ok => {
      const fim = sim => { d.removeEventListener("close", fechou); if (d.open) d.close(); if (volta && volta.focus) volta.focus(); ok(sim); };
      const fechou = () => fim(false);
      d.addEventListener("close", fechou);
      $("auto-sim").onclick = () => fim(true);
      $("auto-nao").onclick = () => fim(false);
      d.showModal(); $("auto-nao").focus();
    });
  }

  // ---------- painel ------------------------------------------------------------------
  let avisoTemp = null;
  function avisar(tipo, texto) { avisoTemp = { tipo, texto }; desenharAvisos(); }
  let avisoIgn = 0;
  function avisoIgnorados(n) { avisoIgn = n; desenharAvisos(); }

  function caixa(tipo, texto) {
    const d = document.createElement("div"); d.className = `aviso-ed ${tipo}`;
    const p = document.createElement("p"); p.textContent = texto; d.append(p); return d;
  }
  function botao(texto, classe, aoClicar) {
    const b = document.createElement("button"); b.type = "button"; b.className = classe; b.textContent = texto; b.addEventListener("click", aoClicar); return b;
  }
  function desenharAvisos() {
    const av = $("avisos"), itens = [];
    if (avisoSalvar) {
      const c = caixa(avisoSalvar.tipo, avisoSalvar.texto);
      if (avisoSalvar.link) { const l = document.createElement("div"); l.className = "linha-bt"; const a = document.createElement("a"); a.href = "./"; a.textContent = "Ver no escritório"; l.append(a); c.append(l); }
      if (avisoSalvar.recarregar) {
        const l = document.createElement("div"), b = botao("Recarregar", "botao", () => sair());
        l.className = "linha-bt"; b.dataset.recarregar = ""; l.append(b); c.append(l);
      }
      itens.push(c);
    }
    const ign = ignorados.length;
    if (avisoIgn && ign) {
      const c = caixa("atencao", ign === 1 ? "1 ajuste salvo não aparece nesta montagem (os times mudaram ou a peça não coube)."
        : `${ign} ajustes salvos não aparecem nesta montagem (os times mudaram ou as peças não couberam).`);
      const l = document.createElement("div"); l.className = "linha-bt";
      l.append(botao("Limpar esses ajustes", "botao secundario", () => {
        avisoIgn = 0;
        if (!agir(rasc.limpar(ignorados.slice()), "Ajustes que não apareciam foram limpos. Salve para gravar.")) desenharAvisos();
        $("painel").focus({ preventScroll: true });   // o botão some com o aviso
      }));
      c.append(l); itens.push(c);
    }
    if (avisoTemp) itens.push(caixa(avisoTemp.tipo, avisoTemp.texto));
    av.replaceChildren(...itens);
  }

  function atualizarPeca() {
    const o = sel && pecas.get(sel);
    $("sem-peca").hidden = !!o; $("com-peca").hidden = !o;
    if (o) {
      $("peca-nome").textContent = nomePeca(o.nome);
      $("peca-sala").textContent = `· ${nomeSala(o.salaChave)}${o.id.startsWith("novo:") ? " · peça nova" : ""}`;
      $("espelhar").disabled = !podeEspelhar(o); $("espelhar").setAttribute("aria-pressed", String(!!o.espelho));
      $("peca-nota").textContent = FIXOS.has(o.nome) ? "Esta peça fica presa ao lugar (tem animação nele): dá para tirar, mas não mover nem espelhar."
        : SEM_ESPELHO.has(o.nome) ? "Esta peça não espelha (ficaria errada ao contrário)." : "";
      $("peca-nota").hidden = !$("peca-nota").textContent;
    }
    // peças tiradas (salvas ou do rascunho): dá para devolver uma a uma
    const tiradas = Object.entries(rasc.planta.moveis).filter(([, v]) => v && v.fora === true).map(([id]) => id);
    let ul = $("tiradas");
    if (!tiradas.length) { if (ul) ul.remove(); return; }
    if (!ul) {
      ul = document.createElement("ul"); ul.id = "tiradas"; ul.className = "tiradas"; ul.setAttribute("aria-label", "Peças tiradas");
      $("sem-peca").parentElement.append(ul);
    }
    ul.replaceChildren(...tiradas.map(id => {
      const [chave, nome] = id.split("|"), li = document.createElement("li"), t = document.createElement("span");
      t.textContent = `${nomePeca(nome)} · ${nomeSala(chave)}`;
      const b = botao("Devolver", "link-botao", () => devolver(id)); b.setAttribute("aria-label", `Devolver ${nomePeca(nome)} (${nomeSala(chave)})`);
      li.append(t, b); return li;
    }));
  }

  function atualizar() {
    $("desfazer").disabled = !rasc.podeDesfazer();
    $("refazer").disabled = !rasc.podeRefazer() || rasc.planta === semRefazer;
    $("descartar").disabled = !rasc.mudou() || salvando;
    const bloq = bloqueioSalvar();
    $("salvar").disabled = !!bloq;
    $("salvar").textContent = salvando ? "Salvando…" : "Salvar";
    const m = $("motivo-salvar");
    m.className = "motivo" + (bloq === "demo" ? " neutro" : "");
    if (bloq === "demo") m.textContent = "Demonstração: dá para mexer em tudo, mas nada é salvo.";   // o único aviso da demo, preso ao Salvar
    else if (bloq === "passagem") m.textContent = fechadas.length === 1
      ? "Não dá para salvar: 1 assento ficou sem passagem (marcado em vermelho no mapa). Mova ou tire o que está na frente."
      : `Não dá para salvar: ${fechadas.length} assentos ficaram sem passagem (marcados em vermelho no mapa). Mova ou tire o que está na frente.`;
    else m.textContent = "";
    m.hidden = !m.textContent;
    if (bloq === "passagem" && !atualizar.avisado) { anunciar(m.textContent); atualizar.avisado = true; }
    if (bloq !== "passagem") atualizar.avisado = false;
    atualizarPeca(); marcarAmostras(); desenharAvisos();
  }

  // amostras de parede e piso tiradas do próprio atlas
  function montarAmostras() {
    const sel0 = $("sala");
    sel0.replaceChildren(...[...salas.values()].map(s => Object.assign(document.createElement("option"), { value: s.chave, textContent: s.nome })));
    sel0.addEventListener("change", () => escolherSala(sel0.value));
    const grupo = (raiz, campo, n, desenha) => {
      const leg = raiz.parentElement.querySelector("legend");
      const auto = botao("Cor automática", "link-botao", () => { const s = salas.get(salaSel); if (s) agir(rasc.pintar(s.chave, campo, null), `${campo === "parede" ? "Parede" : "Piso"} automático em ${s.nome}.`); });
      auto.dataset.auto = campo; leg.append(auto);
      for (let i = 0; i < n; i++) {
        const l = document.createElement("label"), cv = document.createElement("canvas"), inp = document.createElement("input");
        l.className = "amostra"; cv.width = 32; cv.height = 32; desenha(cv.getContext("2d"), i);
        inp.type = "radio"; inp.name = campo; inp.value = String(i); inp.setAttribute("aria-label", `${campo === "parede" ? "Parede" : "Piso"} ${i + 1}`);
        inp.addEventListener("change", () => { const s = salas.get(salaSel); if (s) agir(rasc.pintar(s.chave, campo, i), `${s.nome}: ${campo} ${i + 1}.`); });
        l.append(cv, inp); raiz.append(l);
      }
    };
    const recorte = (c, nome, x, y) => { const s = atlas.json.sprites[nome]; if (s) c.drawImage(atlas.img, s[0], s[1], Math.min(16, s[2]), Math.min(16, s[3]), x, y, 16, 16); };
    grupo($("paredes"), "parede", Planta.LIMITES.parede + 1, (c, i) => { for (const [col, x] of [[1, 0], [2, 16]]) { recorte(c, `parede${i}_${col}_0`, x, 0); recorte(c, `parede${i}_${col}_1`, x, 16); } });
    grupo($("pisos"), "piso", Planta.LIMITES.piso + 1, (c, i) => { const s = atlas.json.sprites[`piso${i}`]; if (s) c.drawImage(atlas.img, s[0], s[1], 32, 32, 0, 0, 32, 32); });
  }
  function marcarAmostras() {
    const s = salas.get(salaSel); if (!s) return;
    const p = Object.hasOwn(rasc.planta.salas, s.chave) ? rasc.planta.salas[s.chave] : {};
    for (const inp of document.querySelectorAll('.amostra input')) inp.checked = Number(inp.value) === s[inp.name];
    for (const b of document.querySelectorAll("[data-auto]")) b.hidden = !Object.hasOwn(p, b.dataset.auto);
  }
  function escolherSala(chave) {
    if (!salas.has(chave)) return;
    salaSel = chave; $("sala").value = chave;
    $("por-aqui").textContent = `Pôr em ${salas.get(chave).nome}`;
    marcarAmostras(); desenhar();
  }

  function montarCatalogo() {
    const raiz = $("catalogo"), nomes = Mapa.CATALOGO instanceof Set ? [...Mapa.CATALOGO] : [], vistos = new Map();
    for (const nome of nomes) {
      const base = nomePeca(nome), n = (vistos.get(base) || 0) + 1; vistos.set(base, n);
      const rotulo = n > 1 ? `${base} ${n}` : base;   // variações do mesmo móvel: "Planta", "Planta 2"…
      const t = Mapa.tamanho(atlas, nome); if (!t) continue;
      const [w, h] = t, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const c = cv.getContext("2d"); c.imageSmoothingEnabled = false;
      const o = { nome, x: 0, y: 0, w, h, chave: h };
      if (!Efeitos.objeto(c, o, 0)) { const s = atlas.json.sprites[nome]; if (s) c.drawImage(atlas.img, s[0], s[1], s[2], s[3], 0, 0, s[2], s[3]); }
      const b = document.createElement("button"), mini = document.createElement("span"), rot = document.createElement("span");
      b.type = "button"; b.className = "item-cat"; b.dataset.nome = nome; b.setAttribute("aria-pressed", "false");
      mini.className = "mini"; mini.append(cv); rot.textContent = rotulo; b.dataset.rotulo = rotulo;
      const k = Math.min(40 / w, 40 / h, 2); cv.style.width = `${Math.round(w * k)}px`; cv.style.height = `${Math.round(h * k)}px`;
      b.append(mini, rot);
      b.addEventListener("click", () => escolherPor(porNome === nome ? null : nome));
      raiz.append(b);
    }
    if (!raiz.childElementCount) raiz.closest(".bloco").hidden = true;
  }
  function escolherPor(nome) {
    porNome = nome;
    for (const b of $("catalogo").children) b.setAttribute("aria-pressed", String(b.dataset.nome === nome));
    palco.classList.toggle("pondo", !!nome);
    $("por-aqui").hidden = !nome;
    const d = $("dica-por");
    d.hidden = !nome;
    if (nome) { d.textContent = `Clique numa sala para pôr: ${nomePeca(nome)}. Esc cancela.`; anunciar(`Para pôr: ${nomePeca(nome)}. Clique numa sala do mapa ou use o botão "Pôr em ${nomeSala(salaSel)}".`); }
  }

  // ---------- ponteiro ------------------------------------------------------------------
  const salaEm = p => [...salas.values()].find(s => p.x >= s.px && p.x <= s.px + s.pw && p.y >= s.py && p.y <= s.py + s.ph) || null;

  palco.addEventListener("pointerdown", e => {
    if (!predio || e.button !== 0) return;
    const p = paraMundo(e.clientX, e.clientY);
    if (porNome) { // pondo peça: o clique escolhe o lugar (o pé da peça)
      e.preventDefault();
      const s = salaEm(p);
      if (!s) { anunciar("Clique dentro de uma sala."); return; }
      escolherSala(s.chave);
      por(s, p.x - s.px, Math.max(p.y, s.chao + 8) - s.chao);
      return;
    }
    const alvo = e.target.closest && e.target.closest(".peca");
    try { palco.setPointerCapture(e.pointerId); } catch (erro) { /* ponteiro já solto */ }
    if (alvo) {
      const o = pecas.get(alvo.dataset.id);
      e.preventDefault();   // o foco vai pelo selecionar (sem o salto de rolagem)
      selecionar(o.id, true);
      if (podeMover(o)) arrasto = { tipo: "peca", id: o.id, x0: p.x, y0: p.y, ox: o.x, oy: o.y, gx: o.x, gy: o.y, ativo: false };
      return;
    }
    const s = salaEm(p);
    if (s) escolherSala(s.chave);
    if (sel) selecionar(null);
    arrasto = { tipo: "camera", cx: e.clientX, cy: e.clientY, x: cam.x, y: cam.y, ativo: false };
  });
  palco.addEventListener("pointermove", e => {
    if (!arrasto) return;
    if (arrasto.tipo === "camera") {
      const dx = e.clientX - arrasto.cx, dy = e.clientY - arrasto.cy;
      if (!arrasto.ativo && Math.hypot(dx, dy) < 3) return;
      arrasto.ativo = true;
      cam.x = arrasto.x - (dx * dpr) / cam.k; cam.y = arrasto.y - (dy * dpr) / cam.k;
      prender(); aplicarCamada(); desenhar();
      return;
    }
    const p = paraMundo(e.clientX, e.clientY), o = pecas.get(arrasto.id), s = salas.get(o.salaChave);
    if (!arrasto.ativo && Math.hypot(p.x - arrasto.x0, p.y - arrasto.y0) * cam.k / dpr < 4) return;
    if (!arrasto.ativo) { arrasto.ativo = true; palco.classList.add("arrastando"); }
    // o fantasma fica dentro do chão da sala (as mesmas bordas que o mapa aceita)
    const cx = Math.max(s.px + o.w / 2 + 1, Math.min(s.px + s.pw - o.w / 2 - 1, arrasto.ox + o.w / 2 + p.x - arrasto.x0));
    const pe = Math.max(s.chao + 8, Math.min(s.py + s.ph - 2, arrasto.oy + o.h + p.y - arrasto.y0));
    arrasto.gx = Math.round(cx - o.w / 2); arrasto.gy = Math.round(pe - o.h);
    desenhar();
  });
  function soltar() {
    const a = arrasto; arrasto = null; palco.classList.remove("arrastando");
    if (!a || a.tipo !== "peca" || !a.ativo) { desenhar(); return; }
    const o = pecas.get(a.id), s = salas.get(o.salaChave);
    moverPara(a.id, a.gx + o.w / 2 - s.px, a.gy + o.h - s.chao);
    desenhar();
  }
  palco.addEventListener("pointerup", soltar);
  palco.addEventListener("pointercancel", () => { arrasto = null; palco.classList.remove("arrastando"); desenhar(); });
  palco.addEventListener("wheel", e => { e.preventDefault(); const r = palco.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  // a peça focada pelo teclado escolhe com Enter/Espaço (o clique do mouse já escolheu no pointerdown)
  camada.addEventListener("click", e => { const b = e.target.closest(".peca"); if (b && e.detail === 0) { selecionar(b.dataset.id, true); anunciar(`Peça escolhida: ${b.getAttribute("aria-label")}. Setas movem, E espelha, Delete tira.`); } });
  camada.addEventListener("focusin", e => { // a peça focada aparece na tela
    const b = e.target.closest(".peca"); if (!b) return;
    const o = pecas.get(b.dataset.id); if (!o) return;
    const sx = vw / 2 + (o.x + o.w / 2 - cam.x) * cam.k / dpr, sy = vh / 2 + (o.y + o.h / 2 - cam.y) * cam.k / dpr;
    if (sx < 40 || sy < 40 || sx > vw - 40 || sy > vh - 40) { cam.x = o.x + o.w / 2; cam.y = o.y + o.h / 2; prender(); aplicarCamada(); desenhar(); }
  });
  palco.addEventListener("scroll", () => { palco.scrollTop = palco.scrollLeft = 0; });   // o foco numa peça não rola o palco

  // ---------- teclado ------------------------------------------------------------------
  const digitando = el => !!el && (el.tagName === "INPUT" && el.type !== "radio" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
  document.addEventListener("keydown", e => {
    if (!predio || $("dlg-auto").open) return;
    const mod = e.ctrlKey || e.metaKey, tecla = e.key.toLowerCase();
    if (mod && tecla === "z") { e.preventDefault(); if (e.shiftKey) refazer(); else desfazer(); return; }
    if (mod && tecla === "y") { e.preventDefault(); refazer(); return; }
    if (mod || e.altKey || digitando(document.activeElement)) return;
    if (e.key === "Escape") { if (porNome) escolherPor(null); else if (sel) { selecionar(null); anunciar("Peça solta."); } return; }
    const o = sel && pecas.get(sel), naPeca = document.activeElement && document.activeElement.classList.contains("peca");
    if (o && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); tirar(); return; }
    if (o && tecla === "e") { e.preventDefault(); if (podeEspelhar(o)) espelhar(); else anunciar("Esta peça não espelha."); return; }
    const setas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (o && naPeca && Object.hasOwn(setas, e.key)) {
      e.preventDefault();
      if (!podeMover(o)) { anunciar("Esta peça fica presa ao lugar."); return; }
      const [dx, dy] = setas[e.key], d = e.shiftKey ? 1 : PASSO, p = posicao(o);
      moverPara(o.id, p.x + dx * d, p.y + dy * d);
      return;
    }
    if (e.key === "+" || e.key === "=") zoom(1.25);
    else if (e.key === "-") zoom(1 / 1.25);
    else if (e.key === "0" && !naPeca) verTudo();
  });

  // ---------- botões ------------------------------------------------------------------
  $("desfazer").addEventListener("click", desfazer);
  $("refazer").addEventListener("click", refazer);
  $("salvar").addEventListener("click", salvar);
  $("descartar").addEventListener("click", descartar);
  $("automatico").addEventListener("click", voltarAoAutomatico);
  $("espelhar").addEventListener("click", espelhar);
  $("tirar").addEventListener("click", tirar);
  $("por-aqui").addEventListener("click", porNaSala);
  $("zoom-mais").addEventListener("click", () => zoom(1.25));
  $("zoom-menos").addEventListener("click", () => zoom(1 / 1.25));
  $("zoom-tudo").addEventListener("click", verTudo);
  addEventListener("beforeunload", e => { if (!saindo && !DEMO && rasc && rasc.mudou()) e.preventDefault(); });   // rascunho não salvo

  iniciar().catch(e => { console.error(e); $("carregando").textContent = "Não deu para abrir o editor agora. Recarregue a página."; });
})();
