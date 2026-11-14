// Escritório: junta configuração (white-label), tema (atlas), estado do agentes.chat, o prédio
// (mapa.js), a vida dos agentes (vida.js) e os sons (som.js). Desenha tudo num canvas.
"use strict";

const ESTADOS = {
  running:          { texto: "Trabalhando",         classe: "trabalhando", balao: null, filtro: "trab" },
  still_running:    { texto: "Trabalhando",         classe: "trabalhando", balao: null, filtro: "trab" },
  waiting_approval: { texto: "Esperando aprovação", classe: "aprovacao",   balao: "!",  filtro: "esp" },
  waiting_input:    { texto: "Esperando resposta",  classe: "pergunta",    balao: "?",  filtro: "esp" },
};
const estadoDe = s => (Object.hasOwn(ESTADOS, s) ? ESTADOS[s] : { texto: "Trabalhando", classe: "trabalhando", balao: null, filtro: "trab" });

const tela = document.getElementById("tela"), ctx = tela.getContext("2d");
let config = null, atlas = null, predio = null, mundo = null, estado = null, assinatura = "", logoImg = null, festa = null, dtQuadro = 0;
let escala = 1, filtro = "todos", selecionado = null;
const menosMovimento = matchMedia("(prefers-reduced-motion: reduce)");
// câmera: centro (x,y) no mundo e k = pixels de tela por pixel do mundo; "alvo" anima até lá
const cam = { x: 0, y: 0, k: 1, alvo: null, ajustada: false };
let dpr = 1, vw = 0, vh = 0;
const $ = id => document.getElementById(id);

// ---------- carga --------------------------------------------------------------------
// O andar atual (expediente.js: Andar) vai na query de todo pedido a api/; no andar principal nada é acrescentado.
// 404 {"codigo":"andar"}: o andar não existe mais ou perdeu o acesso; quem chamou volta para o principal.
class AndarInvalido extends Error {}
async function json(url) {
  const api = url.startsWith("api/");
  const r = await fetch(api ? Andar.com(url) : url, { cache: "no-store", credentials: "same-origin" });
  if (r.status === 401) { location.href = "/entrar"; throw new Error("sessão expirou"); }
  if (r.status === 404 && api && Andar.atual !== Andar.PRINCIPAL) {
    const d = await r.json().catch(() => null);
    if (d && d.codigo === "andar") throw new AndarInvalido("andar");
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
}
function imagem(src) { return new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = src; }); }

async function iniciar() {
  config = Brincar.demo ? Brincar.configDemo()   // demonstração: nada vem do servidor
    : await json("api/config").catch(e => { if (!(e instanceof AndarInvalido)) throw e; sairDoAndarInvalido(); return json("api/config"); });
  Expediente.definir(config.expediente);   // sem a chave (demonstração, servidor antigo): 07:00 às 20:00
  const pasta = `tema/`;
  const mapaJson = await json(pasta + "atlas.json");
  const img = await imagem(`${pasta}atlas.png?v=${encodeURIComponent(mapaJson.versao || "")}`);
  atlas = { img, json: mapaJson };
  try { logoImg = await imagem(config.logo || "logo.png"); } catch (e) { logoImg = null; }
  aplicarConfig();
  paginaConversas();
  Brincar.iniciar();
  medirFaixa();
  if (Brincar.demo) Ceu.acelerar(8, 26);   // um dia de expediente em uns 6 minutos
  try { await document.fonts.load(Mapa.PLACA_FONTE); } catch (e) { /* sem a fonte, a placa usa a reserva monoespaçada */ }
  if (!$("v-personalizar").hidden) { Personalizar.abrir(config); Ajustes.abrir(config); }   // abriu direto em #personalizar
  await buscar();
  ligarAoVivo();
  irAoAgentePedido();
  ligarTV();
  if (!souMembro()) Assistente.talvez(config, () => estado);   // nome de exemplo ou sem conexão: o assistente (uma vez por sessão, e na volta do OAuth)
  setInterval(buscar, 10000);
  requestAnimationFrame(quadro);
}

// o que sai do config de cada andar (a marca, as datas e o expediente são do prédio e vêm iguais em todos)
function aplicarConfig() {
  // o Personalizar grava config.logo assim que o /api/logo responde: o logo do topo e o do mapa trocam na hora
  // (mesmo se o salvar do nome e da cor falhar depois), sem esperar recarregar
  let logoAtual = config.logo;
  Object.defineProperty(config, "logo", { configurable: true, enumerable: true, get: () => logoAtual, set: v => { logoAtual = v; trocarLogo(v); } });
  Festas.configurar(config.festas, config.cor);   // datas próprias e festas desligadas (Personalizar)
  festa = Festas.ativa();
  aplicarMarca();
  mostrarElevador();
  aplicarPapel();
}

// O papel da conta ("admin" | "membro") vem no /api/config; sem o campo (servidor antigo) vale admin, a tela de sempre.
// A regra mora aqui: o body ganha data-papel e o CSS esconde tudo que tem class "so-admin" (estilo.css). O servidor também
// barra no back (403); isto só evita mostrar botões que não funcionam. Conversas e o assistente de instalação dependem daqui.
const souMembro = () => !!config && config.papel === "membro";
function aplicarPapel() {
  document.body.dataset.papel = souMembro() ? "membro" : "admin";
  if (souMembro() && location.hash === "#conversas") rota();   // abriu direto numa tela de admin: o rota() manda para o mapa
}

function aplicarMarca() {
  $("empresa").textContent = config.empresa; $("empresa-topo").textContent = config.empresa;
  $("marca-exemplo").hidden = config.marca_exemplo !== true;   // ninguém trocou o nome padrão ainda
  if (config.logo) $("logo").src = $("logo-topo").src = config.logo;
  document.title = `Escritório · ${config.empresa}`;
  if (config.cor) aplicarCor(config.cor);
  for (const a of document.querySelectorAll("[data-externo]")) a.href = `${config.app_url}/${a.dataset.externo}`;
  // código-fonte (AGPL §13): o servidor já validou o https; a demonstração não lê o servidor e fica sem o link
  const fonte = typeof config.fonte === "string" && /^https:\/\/[^\s"'<>]+$/.test(config.fonte) ? config.fonte : "";
  if (fonte) $("fonte").href = fonte;
  $("fonte-par").hidden = !fonte;
  if (config.previa && !document.querySelector(".faixa-previa")) { // só a prévia local manda previa: true (o servidor real nunca)
    const f = document.createElement("div"); f.className = "faixa-demo faixa-previa"; f.setAttribute("role", "status");
    f.append(Object.assign(document.createElement("strong"), { textContent: "Prévia de desenvolvimento" }), " · dados fixos, não é o agentes.chat ao vivo");
    document.body.prepend(f);
  }
}

async function trocarLogo(src) {
  $("logo").src = $("logo-topo").src = src || "logo.png";
  try { logoImg = await imagem(src || "logo.png"); } catch (e) { return; }   // sem a imagem nova, o mapa fica com a anterior
  if (predio) Efeitos.iniciar(predio, atlas, config, logoImg);
}

// Cor da marca: o texto sobre ela (botões, placas) fica escuro ou claro, o que der mais contraste (WCAG)
function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16), c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(n >> 16) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255);
}
function contraste(a, b) { const x = luminancia(a), y = luminancia(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function textoSobre(cor) { return contraste(cor, "#1a1408") >= contraste(cor, "#ffffff") ? "#1a1408" : "#ffffff"; }
function aplicarCor(cor) {
  document.documentElement.style.setProperty("--destaque", cor);
  document.documentElement.style.setProperty("--destaque-texto", textoSobre(cor));
}

function aparencia(handle) {
  return Object.hasOwn(config.aparencia, handle) ? config.aparencia[handle] : Avatar.padrao(handle);
}

// Reconstrói o prédio quando muda a lista de agentes ou de times.
function montar(agentes) {
  const conhecidos = new Set(agentes.map(a => a.handle));
  const usados = new Set();
  const grupos = config.times.map(t => {
    const hs = t.agentes.filter(h => conhecidos.has(h));
    hs.forEach(h => usados.add(h));
    return { ...t, handles: hs };
  });
  const novos = agentes.map(a => a.handle).filter(h => !usados.has(h));
  if (novos.length) grupos.push({ nome: "Novos", tipo: "mesas", parede: 2, piso: 3, handles: novos });
  const chave = JSON.stringify(grupos.map(g => [g.nome, g.handles]));
  if (chave === assinatura && predio) return false;
  assinatura = chave;
  predio = Mapa.montarPredio(atlas, config, grupos);
  mundo = Vida.criarMundo(predio);
  Efeitos.iniciar(predio, atlas, config, logoImg);
  cam.ajustada = false;
  fecharFicha();
  ajustarEscala();
  montarSalas();
  Brincar.montar(predio);
  return true;
}

async function buscar() {
  if (trocando) return;   // a troca de andar chama de novo quando o config novo chegar
  const pedido = performance.now(), andar = Andar.atual;
  try {
    const lido = Brincar.demo ? Brincar.estadoDemo() : await json(TV.invisivel || !aparecer ? "api/estado?invisivel=1" : "api/estado");   // a TV e quem desligou não contam como visitante
    if (andar !== Andar.atual) return;   // trocou de andar no meio do pedido: esta leitura é do andar de antes
    estado = lido;
    modoDoServidor(estado.modo_resposta, pedido);
    Clima.definir(estado.clima);
    // "Olá de novo" na tela de entrada: só o nome de quem já entrou com sucesso (o servidor só manda usuario com sessão válida)
    if (!Brincar.demo && typeof estado.usuario === "string" && estado.usuario.length <= 64) try { localStorage.setItem("escritorio:usuario", estado.usuario); } catch (e) { /* aba anônima ou armazenamento bloqueado */ }
    const novo = montar(estado.agentes || []);
    const mesas = new Map();
    for (const s of predio.salas) for (const m of s.mesas || []) if (m.handle) mesas.set(m.handle, m);
    Vida.sincronizar(mundo, estado.agentes || [], estado.trabalhos || [], mesas, aparencia, novo);
    Vida.social(mundo, !naSimulacao() && estado.social && typeof estado.social === "object" ? estado.social : null);   // null desliga a camada
    mostrarOlhando();
    falhou = false;
    desenharPainel(); desenharEventos(); mostrarConexao(); paginaConversas();
    TV.atualizar(estado);
    if (!$("v-jornal").hidden) Jornal.abrir();   // os nomes vêm desta leitura; o jornal em si é relido a cada minuto
    if (!$("ficha").hidden) renderFicha();
    vigiarSocial(); vigiarGreve();
  } catch (e) {
    if (e instanceof AndarInvalido && andar === Andar.atual) { voltarAoPrincipal(); return; }
    if (andar !== Andar.atual) return;
    falhou = true; mostrarConexao();
  }
}

// ---------- desenho ------------------------------------------------------------------
function ajustarEscala() {
  if (!predio) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);   // acima de 2x o celular só gasta bateria
  const palco = $("palco"), cheio = $("palco-cartao").classList.contains("cheio");
  vw = palco.clientWidth;
  if (cheio) vh = Math.max(240, window.innerHeight - (parseFloat(getComputedStyle($("palco-cartao")).top) || 0));   // sem a faixa de prévia ou demonstração do topo
  else if (window.innerWidth <= 760) vh = 268;   // celular: cartão de 268 px; a câmera completa fica na tela cheia
  else vh = Math.round(Math.max(380, Math.min(window.innerHeight * 0.72, vw * predio.H / predio.W)));
  tela.width = Math.round(vw * dpr); tela.height = Math.round(vh * dpr);
  tela.style.width = `${vw}px`; tela.style.height = `${vh}px`;
  if (!cam.ajustada) { verTudo(true); cam.ajustada = true; }
}

// O zoom mínimo cobre o quadro inteiro (nunca sobra área vazia) e a câmera não sai do mundo.
function encaixe() { return Math.max(vw / predio.W, vh / predio.H) * dpr; }
function limitarK(k) { return Math.max(encaixe(), Math.min(10 * dpr, k)); }
function prenderCamera(c) {
  const meiaW = tela.width / (2 * c.k), meiaH = tela.height / (2 * c.k);
  c.x = predio.W <= meiaW * 2 ? predio.W / 2 : Math.max(meiaW, Math.min(predio.W - meiaW, c.x));
  c.y = predio.H <= meiaH * 2 ? predio.H / 2 : Math.max(meiaH, Math.min(predio.H - meiaH, c.y));
}
function verTudo(ja) { moverCamera({ x: predio.W / 2, y: predio.H / 2, k: encaixe() }, ja); }
function moverCamera(alvo, ja) { alvo.k = limitarK(alvo.k); prenderCamera(alvo); if (ja) Object.assign(cam, alvo, { alvo: null }); else cam.alvo = alvo; }
function enquadrar(s, ja) {
  const k = Math.min((vw * dpr) / (s.pw + 40), (vh * dpr) / (s.ph + 60));
  seguir = null;
  moverCamera({ x: s.px + s.pw / 2, y: s.py + s.ph / 2 - 6, k }, ja);
}
function focarSala(s) { enquadrar(s); marcarSala(s); }
function paraMundo(cx, cy) {
  const r = tela.getBoundingClientRect();
  const sx = (cx - r.left) * dpr, sy = (cy - r.top) * dpr;
  return { x: cam.x + (sx - tela.width / 2) / cam.k, y: cam.y + (sy - tela.height / 2) / cam.k };
}
function salaEm(p) { return [...predio.salas, ...predio.baixo].find(s => p.x >= s.px && p.x <= s.px + s.pw && p.y >= s.py && p.y <= s.py + s.ph); }

function spr(nome, x, y) {
  const s = atlas.json.sprites[nome]; if (!s) return;
  ctx.drawImage(atlas.img, s[0], s[1], s[2], s[3], Math.round(x), Math.round(y), s[2], s[3]);
}

function quadroAnim(nome, fps, t) {
  const n = (atlas.json.quadros || {})[nome] || 1;
  return `${nome}_${Math.floor((t / 1000) * fps) % n}`;
}

// o agente aparece aceso no mapa e na lista quando bate com o filtro e com a busca
function combina(b) {
  if (buscaIds && !buscaIds.has(b.id)) return false;
  return filtro === "todos" || situacao(b) === filtro;
}

let antes = performance.now();
function quadro(t) {
  requestAnimationFrame(quadro);   // no topo: um erro neste quadro não para o laço
  const dt = Math.min(0.1, (t - antes) / 1000); antes = t; dtQuadro = dt;
  if (predio && mundo) {
    Vida.passo(mundo, dt);
    for (const e of mundo.eventos.splice(0)) Som.evento(e.nome || e, e);
    Som.teclado(Vida.digitando(mundo), t);
    Som.ambiente(true);
    desenharCena(t);
    Timelapse.quadro();   // na vez do quadro do time-lapse, fotografa logo depois de desenhar
  }
}

// handle → boneco, refeito a cada quadro: as telas das mesas consultam sem varrer a lista
const bonecoDaMesa = new Map();
function desenharCena(t) {
  bonecoDaMesa.clear(); for (const b of mundo.bonecos.values()) bonecoDaMesa.set(b.handle, b);
  const seguido = seguir && boneco(seguir);
  if (seguido && visivel(seguido)) { const a = { x: seguido.x, y: seguido.y - 10, k: cam.alvo ? cam.alvo.k : cam.k }; prenderCamera(a); cam.alvo = a; }
  if (cam.alvo) { // anima a câmera até o alvo
    const f = 0.14;
    cam.x += (cam.alvo.x - cam.x) * f; cam.y += (cam.alvo.y - cam.y) * f; cam.k += (cam.alvo.k - cam.k) * f;
    if (Math.abs(cam.alvo.k - cam.k) < 0.002 && Math.abs(cam.alvo.x - cam.x) < 0.3) cam.alvo = null;
  }
  cam.k = limitarK(cam.k); prenderCamera(cam);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, tela.width, tela.height);
  ctx.setTransform(cam.k, 0, 0, cam.k, tela.width / 2 - cam.x * cam.k, tela.height / 2 - cam.y * cam.k);
  ctx.imageSmoothingEnabled = false;
  const ceu = Ceu.agora(), ta = menosMovimento.matches ? 0 : t;   // ta: relógio dos objetos (parado com menos movimento)
  ctx.drawImage(predio.fundo, 0, 0);
  Efeitos.exterior(ctx, dtQuadro, t, ceu);
  for (const j of predio.janelas) { Ceu.janela(ctx, j, ceu, ta); Clima.naJanela(ctx, j, t); }
  Efeitos.painelLogo(ctx, t, ceu);
  Efeitos.festaChao(ctx, festa);
  Efeitos.robo(ctx, dtQuadro, t, ceu);
  for (const a of predio.animados) if (a.parede) desenharAnimado(a, ta);
  if (predio.ringue && predio.ringue.quadro) Efeitos.placar(ctx, predio.ringue.quadro, placarDaTela(), mundo);   // top 3 da semana na parede do ringue
  const cena = [];
  for (const o of predio.objetos) cena.push({ chave: o.chave, desenha: () => desenharObjeto(o, ta) });
  for (const a of predio.animados) if (!a.parede) cena.push({ chave: a.chave, desenha: () => desenharAnimado(a, ta) });
  for (const s of [...predio.salas, ...predio.baixo]) if (s.placa) cena.push({ chave: s.placa.y + Mapa.PLACA_H, desenha: () => { desenharPlaca(s); } });
  const ent = mundo.entrega;   // entrega da greve atendida (vida.js): o item no ponto e o entregador, na ordem da cena
  if (ent && ent.fase === "entregue") cena.push({ chave: ent.y, desenha: () => Efeitos.entrega(ctx, ent, t) });
  if (ent && ent.entregador) cena.push({ chave: ent.entregador.chave ?? ent.entregador.y + 0.5, desenha: () => desenharEntregador(ent, t) });
  if (ent && ent.entregador && ent.item === "pizza" && predio.entrada) { // a moto fica na calçada cinza, à direita do caminho da entrada, até o motoboy ir embora
    const mx = predio.entrada.x + 12, my = predio.entrada.calcadaY - 6;
    cena.push({ chave: my, desenha: () => Efeitos.moto(ctx, mx, my) });
  }
  const cs = mundo.cenaSocial, naNuvem = b => !!cs && cs.fase === "luta" && (b.id === cs.a || b.id === cs.b);   // na luta, a nuvem cobre os dois (Efeitos.cena)
  for (const b of mundo.bonecos.values()) if (visivel(b) && !naNuvem(b)) cena.push({ chave: b.chave ?? b.y + 0.5, desenha: () => desenharBoneco(b, t) });
  const visitas = Vida.pessoas();   // as pessoas da equipe neste andar e o meu boneco (vida.js: /api/ao-vivo)
  for (const v of visitas) cena.push({ chave: v.chave ?? v.y + 0.5, desenha: () => Avatar.boneco(ctx, v, t, escala) });
  cena.sort((a, b) => a.chave - b.chave).forEach(c => c.desenha());
  desenharPortas(t);
  Clima.desenhar(ctx, predio, dtQuadro, t, Som.ligado ? Som : null);
  desenharLuzes(dt0(t), ceu);
  Efeitos.luzesNoite(ctx, ceu);
  Efeitos.festaAr(ctx, festa, t, dtQuadro, ceu);
  Efeitos.particulas(ctx, dtQuadro, mundo, t);
  Efeitos.cena(ctx, mundo, t);   // nuvem da briga e estrelinhas de quem perdeu, embaixo dos nomes e dos balões
  anunciarVencedor(); anunciarEntrega();
  const visiveis = [...mundo.bonecos.values()].filter(visivel);
  const ocupadas = Efeitos.placas(ctx, mundo, t);   // plaquinhas da greve: os nomes e os balões desviam delas
  visiveis.sort((a, b) => b.y - a.y || a.x - b.x).forEach(b => desenharEtiqueta(b, t, ocupadas));
  for (const v of visitas) desenharEtiqueta(v, t, ocupadas);   // depois dos agentes: o nome deles tem a preferência
  for (const b of visiveis) Efeitos.emote(ctx, b, t, ceu.escuro);
  const faixa = Efeitos.faixaVencedor(ctx, mundo, t); if (faixa) ocupadas.push(faixa);   // os balões desviam da faixa do vencedor
  const faixaEntrega = Efeitos.entregaAr(ctx, mundo.entrega, t); if (faixaEntrega) ocupadas.push(faixaEntrega);   // e da faixa do pedido atendido
  for (const b of visiveis.filter(b => b.fala).sort((a, b) => b.y - a.y || a.x - b.x)) desenharBalao(b, ocupadas);
  Brincar.desenhar(ctx);   // realce, reações dos objetos e a festa do Konami
}

function visivel(b) { return !(b.lugar && b.lugar.tipo === "fora" && !b.rota.length) && b.x > -20; }

// Zona de passagem de cada porta (os pés de quem atravessa passam por ela)
function zonaPorta(p) {
  if (p.tipo === "lateral") return { x: p.x - 10, y: p.y - 2, w: 20, h: p.h + 4 };
  if (p.h) return { x: p.x - 2, y: p.y - 6, w: p.w + 4, h: p.h + 12 };   // portas na parede de cima das salas de baixo
  return { x: p.x - 2, y: p.y - 9, w: p.w + 4, h: 18 };                  // portas na fachada das salas de cima
}
// O agente está na zona ou vai entrar nela nos próximos ~34 px da rota (~0,8 s andando)
const naZonaDaPorta = (z, x, y) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
function vaiPassar(z, b) {
  if (naZonaDaPorta(z, b.x, b.y)) return true;
  let ax = b.x, ay = b.y, resto = 34;
  for (const [bx, by] of b.rota) {
    const d = Math.hypot(bx - ax, by - ay), anda = Math.min(d, resto), n = Math.max(1, Math.ceil(anda / 3));
    for (let k = 1; k <= n; k++) { const f = d ? (anda * k) / n / d : 1; if (naZonaDaPorta(z, ax + (bx - ax) * f, ay + (by - ay) * f)) return true; }
    resto -= d; if (resto <= 0) return false;
    ax = bx; ay = by;
  }
  return false;
}

// Portas: abrem antes de o agente chegar, ficam abertas enquanto ele atravessa e fecham logo depois
function desenharPortas(t) {
  const bonecos = [...mundo.bonecos.values()].filter(visivel);
  for (const p of predio.portas) {
    const z = p.zona || (p.zona = zonaPorta(p));
    if (bonecos.some(b => vaiPassar(z, b))) p.ate = t + 250;
    const aberta = t < (p.ate || 0);
    if (aberta && !p.abrindo) Som.evento("porta", p);
    p.abrindo = aberta;
    p.abre = menosMovimento.matches ? +aberta : Math.max(0, Math.min(1, p.abre + (aberta ? dtQuadro * 5 : -dtQuadro * 3)));
    const A = p.abre * p.abre * (3 - 2 * p.abre);   // suaviza o começo e o fim do movimento
    const meia = p.w / 2, des = Math.round(A * (meia - 2));
    ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y - 2, p.w, (p.h || 4) + 4); ctx.clip();   // a folha some dentro da parede
    if (p.tipo === "vidro") { // duas folhas de vidro que correm para os lados
      for (const [x0, dir] of [[p.x, -1], [p.x + meia, 1]]) {
        const x = x0 + dir * des;
        ctx.fillStyle = "rgba(170,215,255,.28)"; ctx.fillRect(x, p.y + 2, meia, p.h - 2);
        ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(x + 2, p.y + 4, 1, p.h - 8);
        ctx.fillStyle = "#5b6478"; ctx.fillRect(x, p.y + 2, meia, 1); ctx.fillRect(dir < 0 ? x + meia - 1 : x, p.y + 2, 1, p.h - 2);
        ctx.fillStyle = "#c7ccd8"; ctx.fillRect(dir < 0 ? x + meia - 3 : x + 2, p.y + p.h / 2, 1, 4);   // puxador
      }
      ctx.restore();
      ctx.fillStyle = "#23212f"; ctx.fillRect(p.x - 2, p.y, 2, p.h); ctx.fillRect(p.x + p.w, p.y, 2, p.h); ctx.fillRect(p.x - 2, p.y, p.w + 4, 2);
      continue;
    } else if (p.tipo === "lateral") { // entrada principal: vidro que corre para cima e para baixo
      const meiaH = p.h / 2, d2 = Math.round(A * (meiaH - 2));
      ctx.fillStyle = "rgba(170,215,255,.4)"; ctx.fillRect(p.x, p.y - d2, 3, meiaH); ctx.fillRect(p.x, p.y + meiaH + d2, 3, meiaH);
      ctx.fillStyle = "#5b6478"; ctx.fillRect(p.x, p.y + meiaH - 1 - d2, 3, 1); ctx.fillRect(p.x, p.y + meiaH + d2, 3, 1);
    } else if (p.tipo === "vaivem") { // porta vaivém da cozinha, com janelinhas redondas
      const ab = A * 0.85;
      for (const [x0, dir] of [[p.x, -1], [p.x + meia, 1]]) {
        const w = Math.max(2, meia * (1 - ab)), x = dir < 0 ? x0 : x0 + meia - w;
        ctx.fillStyle = "#8a5a3a"; ctx.fillRect(x, p.y + 8, w, p.h - 8);
        ctx.fillStyle = "#a8744c"; ctx.fillRect(x, p.y + 8, w, 1);
        ctx.fillStyle = "#6e4a2c"; ctx.fillRect(x, p.y + p.h - 6, w, 1);              // chute de metal embaixo
        if (w > 6) { ctx.fillStyle = "rgba(190,225,255,.7)"; ctx.fillRect(x + w / 2 - 2, p.y + 16, 4, 4); ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillRect(x + w / 2 - 2, p.y + 16, 1, 1); }
      }
      ctx.restore();
      ctx.fillStyle = "#23212f"; ctx.fillRect(p.x - 2, p.y, 2, p.h); ctx.fillRect(p.x + p.w, p.y, 2, p.h);
      continue;
    } else { // folhas na base da sala: madeira, madeira escura, metal, vidro fosco ou pintada na cor do time
      const cor = p.sala ? corDaSala(p.sala) : "#6e4a2c";
      const cores = { madeira: ["#6e4a2c", "#9a6a40"], madeira_escura: ["#3e2716", "#5a3a22"], metal: ["#7d828c", "#a7acb6"],
        fosca: ["rgba(200,220,240,.75)", "#ffffff"], cor: [clarear(cor, -0.35), clarear(cor, 0.2)] }[p.tipo] || ["#6e4a2c", "#9a6a40"];
      for (const [x0, dir] of [[p.x, -1], [p.x + meia, 1]]) {
        const x = x0 + dir * des;
        ctx.fillStyle = cores[0]; ctx.fillRect(x, p.y - 1, meia, 4);
        ctx.fillStyle = cores[1]; ctx.fillRect(x, p.y - 1, meia, 1);
        ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fillRect(dir < 0 ? x + meia - 1 : x, p.y - 1, 1, 4);   // junta entre as folhas
        ctx.fillStyle = p.tipo === "metal" ? "#3b3f47" : "#e9d9a6"; ctx.fillRect(dir < 0 ? x + meia - 3 : x + 2, p.y + 1, 1, 1); // maçaneta
      }
    }
    ctx.restore();
  }
}

let ultimoLuz = 0;
function dt0(t) { const d = Math.min(0.1, (t - ultimoLuz) / 1000); ultimoLuz = t; return d; }

function desenharObjeto(o, t) {
  if (o.tipo === "mesa") {
    Mapa.desenharMesa(ctx, o.mesa.x, o.mesa.topo, telaDaMesa(o.mesa), t, o.mesa);
  } else if (o.tipo === "cadeira") {
    Mapa.desenharCadeira(ctx, o.x, o.y, o.cor, o.estilo);
  } else {
    if (o.espelho) { ctx.save(); ctx.translate(2 * o.x + o.w, 0); ctx.scale(-1, 1); }   // árvore ou planta espelhada (mapa.js)
    if (!Efeitos.objeto(ctx, o, t)) spr(o.nome, o.x, o.y);
    if (o.espelho) ctx.restore();
    Efeitos.depoisObjeto(ctx, o, t, mundo);
  }
}

// O que o monitor mostra: código com o dono trabalhando na mesa, alerta quando ele espera você,
// protetor de tela quando ele está no escritório sem tarefa e apagado quando saiu (ou a mesa não tem dono).
function telaDaMesa(mesa) {
  const b = mesa.handle && bonecoDaMesa.get(mesa.handle);
  if (!b || (b.lugar && b.lugar.tipo === "fora") || (b.destino && b.destino.tipo === "fora")) return "apagada";
  if (b.trabalho) {
    const est = estadoDe(b.trabalho.status).classe;
    if (est !== "trabalhando") return est;
    return b.lugar && b.lugar.tipo === "mesa" ? "codigo" : "descanso";
  }
  return "descanso";
}

function desenharAnimado(a, t) {
  if (a.tipo === "gato") spr(quadroAnim("gato", 2, t), a.x, a.y);
  else if (a.tipo === "cafe") spr(quadroAnim("cafe", 5, t), a.x, a.y);
  else if (a.tipo === "tela") { // TV: videogame quando alguém joga, canais quando alguém assiste (e mais apagada sem ninguém)
    let modo = "fraca";
    for (const b of mundo.bonecos.values()) {
      const v = b.lugar && b.lugar.vaga && !b.rota.length && Math.abs(b.x - (a.x + a.w / 2)) < 70 && b.y > a.y && b.y - a.y < 120 ? b.lugar.vaga.tipo : null;
      if (v && a.para.includes(v)) { modo = v === "videogame" ? "jogo" : "tv"; if (modo === "jogo") break; }
    }
    Efeitos.tela(ctx, a, t, modo);
  } else if (!Efeitos.animado(ctx, a, t)) spr(quadroAnim(a.tipo, 3, t), a.x, a.y);
}

function desenharBoneco(b, t) {
  const est = b.trabalho ? estadoDe(b.trabalho.status) : null;
  ctx.globalAlpha = combina(b) ? 1 : 0.3;
  const { x, y } = Avatar.boneco(ctx, b, t, escala);   // sombra, pose e direção (avatar.js); x,y = canto do quadro 22x22
  Efeitos.chapeu(ctx, b, x, y, festa);
  if (est && est.classe === "aprovacao") maoLevantada(b, x, y, t);
  if (selecionado === b.id || realce === b.id) { ctx.strokeStyle = Mapa.cor("destaque"); ctx.lineWidth = Math.max(2, escala); ctx.strokeRect((x + 3) * escala, (y + 6) * escala, 16 * escala, 16 * escala); }
  ctx.globalAlpha = 1;
}

// o entregador da greve atendida é um figurante (não está no mundo.bonecos): o mesmo avatar, com o item nas mãos enquanto traz
function desenharEntregador(e, t) {
  const g = e.entregador, { x, y } = Avatar.boneco(ctx, g, t, escala);
  Efeitos.uniforme(ctx, e.item, x, y, g.olha);   // o capacete e a bag do motoboy da pizza
  if (g.carrega) Efeitos.itemNaMao(ctx, e.item, x, y, t);
}

function desenharLuzes(dt, ceu) {
  const ocupadas = new Set();
  for (const b of mundo.bonecos.values()) {
    if (b.lugar && b.lugar.tipo === "mesa" && b.trabalho) ocupadas.add(b.lugar.mesa.sala);
    if (b.lugar && b.lugar.tipo === "vaga") ocupadas.add(b.lugar.vaga.sala);
    if (b.destino && b.destino.vaga) ocupadas.add(b.destino.vaga.sala);
    if (b.destino && b.destino.mesa) ocupadas.add(b.destino.mesa.sala);
  }
  const noite = ceu.escuro; // 0 = dia claro, 1 = noite
  if (noite > 0.02) { ctx.fillStyle = `rgba(8,10,34,${noite * 0.5})`; ctx.fillRect(0, 0, predio.W, predio.H); }
  const agora = performance.now();
  for (const s of [...predio.salas, ...predio.baixo]) {
    const acesa = s.tipo === "recepcao" || ocupadas.has(s);
    if (acesa && s.acesa === false && !menosMovimento.matches) s.pisca = agora + 450;   // lâmpada piscando ao acender
    s.acesa = acesa;
    const piscando = s.pisca > agora;
    s.luz += ((acesa ? (piscando && Math.floor(agora / 70) % 3 === 0 ? 0.2 : 1) : 0) - s.luz) * Math.min(1, dt * (piscando ? 20 : 2.5));
    const escuroSala = (1 - s.luz) * (0.35 + noite * 0.4);
    if (escuroSala > 0.01) { ctx.fillStyle = `rgba(6,8,26,${escuroSala})`; ctx.fillRect(s.px, s.py, s.pw, s.ph); }
    if (noite > 0.05 && s.luz > 0.05) { // luz quente das salas acesas à noite
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(52,40,22,${noite * 0.55 * s.luz})`; ctx.fillRect(s.px, s.py, s.pw, s.ph);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  if (noite > 0.05) { // luminárias, monitores e telas brilham
    ctx.globalCompositeOperation = "lighter";
    for (const o of predio.objetos) {
      if (o.nome === "luminaria" || o.nome === "luminaria_chao" || o.nome === "ring_light" || o.nome === "luminaria_arco") { // luminária de chão: acende com a sala (ou no toque, o.aceso)
        const sala = o.sala || (o.sala = salaEm({ x: o.x + o.w / 2, y: o.y + o.h }));
        const luz = o.aceso ?? (sala ? sala.luz : 1);
        if (luz > 0.05) brilho(o.nome === "luminaria_arco" ? o.x + 20 : o.x + o.w / 2, o.nome === "luminaria_arco" ? o.y + 12 : o.y + 6, 34, `rgba(255,200,120,${0.35 * noite * luz})`);
      } else if (o.tipo === "mesa") {
        const tela = telaDaMesa(o.mesa), cor = { codigo: "110,170,255", descanso: "150,120,255", aprovacao: Mapa.rgb(Mapa.cor("ambar")), pergunta: Mapa.rgb(Mapa.cor("azul")) }[tela];
        if (cor) brilho(o.mesa.x, o.mesa.topo - 6, 22, `rgba(${cor},${(cor === "150,120,255" ? 0.14 : 0.3) * noite})`);
        if (o.mesa.abajur && (o.mesa.abajurAceso ?? tela !== "apagada")) brilho(o.mesa.x + 11, o.mesa.topo + 3, 18, `rgba(255,210,130,${0.4 * noite})`);
      }
      else if (/arcade|rack_tv|estacao_gamer|aquario|neon|tv_parede/.test(o.nome || "")) brilho(o.x + o.w / 2, o.y + o.h / 3, 26, `rgba(140,110,255,${0.22 * noite})`);
    }
    for (const l of predio.luzesTeto || []) { // luminárias de teto do corredor: lâmpada acesa e a luz no chão
      brilho(l.x, l.y + 22, 34, `rgba(255,214,150,${0.32 * noite})`);
      ctx.fillStyle = `rgba(255,236,180,${0.9 * noite})`; ctx.fillRect(l.x - 2, l.y + 3, 5, 1);
    }
    ctx.globalCompositeOperation = "source-over";
  }
}

function brilho(x, y, r, cor) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, cor); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// retângulo do mundo que aparece na tela agora (rótulos e balões ficam dentro dele)
function vistaMundo() { const mw = tela.width / (2 * cam.k), mh = tela.height / (2 * cam.k); return { l: cam.x - mw, r: cam.x + mw, t: cam.y - mh, b: cam.y + mh }; }
function tamMundo(mult) { return Math.max((11 * dpr) / cam.k, mult); }
function fonte(peso, mult) { return `${peso} ${tamMundo(mult)}px Figtree, system-ui, sans-serif`; }

function desenharEtiqueta(b, t, ocupadas) {
  const S = escala, topo = (b.y - Avatar.TAM - 1) * S, v = vistaMundo();
  ctx.font = fonte(700, 4.6);
  const tam = tamMundo(4.6), est0 = b.trabalho && estadoDe(b.trabalho.status);
  const w = ctx.measureText(b.nome).width + tam, h = tam + 6, folga = est0 && est0.balao ? tam * 2.4 : 0;
  const x = Math.max(v.l + 2, Math.min(v.r - w - 2 - folga, b.x * S - w / 2)), cx = x + w / 2;   // nunca cortado na borda da tela
  let y = Math.max(v.t + 2, topo - h);
  for (let i = 0; i < 6 && ocupadas.some(r => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y); i++) y -= h + 3;
  ocupadas.push({ x, y, w, h });
  b.etq = { x, y, w, h };
  ctx.globalAlpha = combina(b) ? 1 : 0.35;
  ctx.fillStyle = selecionado === b.id ? "#f2f2f3" : "rgba(15,15,17,.85)";
  arred(x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = selecionado === b.id ? "#111" : "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(b.nome, cx, y + h / 2 + 1);
  const est = b.trabalho && estadoDe(b.trabalho.status);
  b.selo = null;
  if (est && est.balao) { // selo "!" (aprovação) ou "?" (pergunta): pulsa até a pessoa resolver no agentes.chat
    const aprov = est.classe === "aprovacao", calmo = menosMovimento.matches;
    const r = tam * (aprov ? 1.1 : 0.9), bx = x + w + r * 0.8, by = y + h / 2 - (calmo ? 0 : Math.floor(t / 400) % 2);
    const cor = Mapa.rgb(Mapa.cor(aprov ? "ambar" : "azul"));
    if (!calmo) { // anel que cresce e some
      const f = (t % 1400) / 1400;
      ctx.strokeStyle = `rgba(${cor},${0.85 * (1 - f)})`; ctx.lineWidth = Math.max(0.6, (1.6 * dpr) / cam.k);
      ctx.beginPath(); ctx.arc(bx, by, r * (1 + f * 1.1), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = "#1b1a26"; ctx.beginPath(); ctx.arc(bx, by, r + Math.max(0.5, dpr / cam.k), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgb(${cor})`; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111"; ctx.font = fonte(800, aprov ? 5.6 : 4.6); ctx.fillText(est.balao, bx, by + 1);
    if (b.trabalho.url) b.selo = { x: bx, y: by, r: r * 1.6 };
    ocupadas.push({ x: bx - r * 1.3, y: by - r * 1.3, w: r * 2.6, h: r * 2.6 });   // balões não cobrem o selo
  }
  ctx.globalAlpha = 1;
}

// Mão levantada de quem espera aprovação: braço na cor do agente, acenando (parado com menos movimento)
function maoLevantada(b, x, y, t) {
  const pal = Avatar.CORES[b.ap.color] || Avatar.CORES.graphite;
  const aceno = menosMovimento.matches ? 0 : Math.floor(t / 280) % 2;
  const ax = x + 17 + aceno, ay = y + 2;
  ctx.fillStyle = pal.contorno; ctx.fillRect(ax, ay, 5, 5); ctx.fillRect(ax + 1 - aceno, ay + 4, 3, 7);
  ctx.fillStyle = pal.base; ctx.fillRect(ax + 1, ay + 1, 3, 3); ctx.fillRect(ax + 2 - aceno, ay + 4, 1, 6);
  ctx.fillStyle = pal.claro; ctx.fillRect(ax + 1, ay + 1, 1, 1);
}

// Balão de fala acima do nome de quem fala. Nunca cobre nome, selo nem outro balão: tenta à direita,
// à esquerda e no meio; se não couber, sobe uma linha e tenta de novo.
function desenharBalao(b, ocupadas) {
  ctx.font = fonte(600, 4.4);
  const tam = tamMundo(4.4);
  const w = Math.min(ctx.measureText(b.fala).width + tam * 1.2, tam * 22), h = tam * 1.9, rabo = 4;
  const cx = b.x + 4, topoNome = b.etq ? b.etq.y : b.y - Avatar.TAM - 3 - tam - 4;
  const bate = r => ocupadas.some(o => r.x < o.x + o.w + 2 && r.x + r.w + 2 > o.x && r.y < o.y + o.h + 2 && r.y + r.h + 2 > o.y);
  const v = vistaMundo(), prende = x => Math.min(Math.max(v.l + 2, x), v.r - w - 2);
  let pos = null;
  for (let nivel = 0; nivel < 6 && !pos; nivel++) {
    const y = topoNome - rabo - 1 - h - nivel * (h + 3);
    for (const x of [cx - 4, cx - w + 6, cx - w / 2].map(prende)) { const r = { x, y, w, h, nivel }; if (!bate(r)) { pos = r; break; } }
  }
  pos = pos || { x: prende(cx - 4), y: topoNome - rabo - 1 - h, w, h };
  ocupadas.push(pos);
  const { x, y } = pos, ponta = Math.min(Math.max(cx, x + 4), x + w - 6);
  ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#1b1b22"; ctx.lineWidth = Math.max(0.6, (1.5 * dpr) / cam.k);
  arred(x, y, w, h, h / 3); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ponta - 1, y + h - 0.5); ctx.lineTo(ponta + 3, y + h + rabo); ctx.lineTo(ponta + 5, y + h - 0.5); ctx.closePath(); ctx.fill();
  if (pos.nivel) { // subiu para não cobrir ninguém: um fio liga o balão ao nome de quem fala
    ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(ponta + 3, y + h + rabo); ctx.lineTo(cx, topoNome); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = "#18181b"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(b.fala, x + tam * 0.6, y + h / 2 + 1, w - tam * 1.2);
}

// Ícones 8x8 das placas: "#" = cor principal, "+" = brilho
const ICONES = {
  codigo:   ["........", ".#....#.", "#..+...#", "#..+...#", "#...+..#", "#...+..#", ".#....#.", "........"],
  megafone: ["......#.", "....###.", "#.#####.", "########", "########", "#.#####.", "...#.##.", "...#..#."],
  servidor: ["########", "#+.....#", "########", "#+.....#", "########", "#+.....#", "########", "..#..#.."],
  coroa:    ["........", "#..#...#", "##.##.##", "########", "#+#+#+##", "########", ".######.", "........"],
  sino:     "...##...|..####..|.######.|.######.|.######.|########|........|...##...".split("|"),
  controle: ["........", ".######.", "#+#..#.#", "###.#.##", "#+#..#.#", "########", "##....##", "........"],
  xicara:   ["..+.+...", "...+.+..", "######..", "#++++###", "#++++#.#", "#++++###", ".####...", "######.."],
  pessoas:  [".##..##.", ".##..##.", "........", "###.####", "####.###", "####.###", "........", "........"],
  grafico:  ["......#.", ".....##.", "....#.#.", "#..#..#.", "##.#..#.", "#.##..#.", "#..#..#.", "########"],
  pincel:   [".....##.", "....###.", "...###..", "..###...", ".+##....", "#++.....", "##......", "#......."],
  camera:   ["........", "..##....", "########", "#..++..#", "#.+..+.#", "#.+..+.#", "#..++..#", "########"],
  estrela:  ["...#....", "...#....", "..###...", "#######.", ".#####..", "..#.#...", ".#...#..", "........"],
};
const ICONE_DO_TIPO = { recepcao: "sino", gabinete: "coroa", ops: "servidor", reuniao: "pessoas", lounge: "controle", cozinha: "xicara" };
const CORES_TIME = ["#3b82f6", "#e8587a", "#22c55e", "#f59e0b", "#8b5cf6", "#14b8a6", "#f97316"];

function corDaSala(s) {
  if (s.cor) return s.cor;
  const fixas = { recepcao: Mapa.cor("destaque"), reuniao: "#0ea5e9", lounge: "#a855f7", cozinha: "#f97316", gabinete: "#eab308", ops: "#10b981" };
  if (fixas[s.tipo]) return fixas[s.tipo];
  let h = 0; for (const ch of s.nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_TIME[h % CORES_TIME.length];
}

function iconeDaSala(s) {
  if (s.icone && ICONES[s.icone]) return s.icone;
  if (ICONE_DO_TIPO[s.tipo]) return ICONE_DO_TIPO[s.tipo];
  const n = s.nome.toLowerCase();
  if (/dev|eng|tec|código|codigo/.test(n)) return "codigo";
  if (/market|social|comun/.test(n)) return "megafone";
  if (/dado|anal|bi|estrat/.test(n)) return "grafico";
  if (/design|arte|cria/.test(n)) return "pincel";
  return "estrela";
}

function clarear(hex, k) {
  const n = parseInt(hex.slice(1), 16), f = c => Math.max(0, Math.min(255, Math.round(c + (k > 0 ? (255 - c) * k : c * k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Placa da sala em pixel art presa na parede, junto da porta (moldura, parafusos, ícone, nome) + quem está na mesa.
// Tamanho fixo no mundo: cresce e diminui com o zoom como o resto do prédio; o mapa.js já reservou o espaço.
function desenharPlaca(s) {
  const p = s.placa, c = ctx; if (!p) return;
  const px = (x, y, w, h, cor) => { c.fillStyle = cor; c.fillRect(x, y, w, h); };
  const cor = corDaSala(s), txt = Mapa.nomePlaca(s.nome).toUpperCase(), h = Mapa.PLACA_H, contador = s.mesas && s.mesas.length;
  const w = Math.max(30, Math.min(p.w, p.max - (contador ? p.total - p.w : 0))), x = p.x, y = p.y;
  s.placaRet = { x, y, w, h };
  c.font = Mapa.PLACA_FONTE; c.textBaseline = "middle"; c.textAlign = "left";
  px(x - 1, y - 1, w + 2, h + 2, "#1b1a26");                 // moldura
  px(x, y, w, h, clarear(cor, -0.45));
  px(x + 1, y + 1, w - 2, h - 3, cor);                        // face
  px(x + 1, y + 1, w - 2, 1, clarear(cor, 0.35));             // brilho
  px(x + 1, y + h - 2, w - 2, 1, clarear(cor, -0.3));         // sombra
  px(x + 2, y + 3, 1, 1, "#e5e7eb"); px(x + w - 3, y + 3, 1, 1, "#e5e7eb"); // parafusos
  px(x + 2, y + h - 4, 1, 1, "#9ca3af"); px(x + w - 3, y + h - 4, 1, 1, "#9ca3af");
  px(x + 4, y + 2, 10, 10, clarear(cor, -0.55));             // fundo do ícone
  ICONES[iconeDaSala(s)].forEach((linha, iy) => [...linha].forEach((ch, ix) => { if (ch !== ".") px(x + 5 + ix, y + 3 + iy, 1, 1, ch === "+" ? clarear(cor, 0.6) : "#ffffff"); }));
  const tinta = textoSobre(cor);   // placa clara (ex.: a recepção na cor da marca "Gelo") pede letra escura
  c.fillStyle = tinta === "#ffffff" ? "rgba(0,0,0,.35)" : "rgba(255,255,255,.3)"; c.fillText(txt, x + 17.5, y + h / 2 + 1.5, w - 23);
  c.fillStyle = tinta; c.fillText(txt, x + 17, y + h / 2 + 1, w - 23);
  if (contador && cam.k / dpr >= 1) {                         // quem está na mesa, colado na placa (só quando dá para ler)
    const na = [...mundo.bonecos.values()].filter(b => b.lugar && b.lugar.tipo === "mesa" && b.lugar.mesa.sala === s && b.trabalho).length;
    const etq = `${na}/${s.mesas.filter(m => m.handle).length}`, lw = Math.ceil(c.measureText(etq).width) + 6;
    px(x + w + 2, y + 2, lw + 2, h - 4, "#1b1a26");
    px(x + w + 3, y + 3, lw, h - 6, na ? "#163a24" : "#26262b");
    c.fillStyle = na ? "#6ee7a0" : "#a1a1aa"; c.fillText(etq, x + w + 6, y + h / 2 + 1);
  }
}

function arred(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------- painel e telas -----------------------------------------------------------
function tempoDesde(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "agora"; if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`; return `há ${Math.floor(s / 86400)} d`;
}
const FMT_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const horaDe = iso => (iso ? FMT_HORA.format(new Date(iso)) : "");
// desde quando a tarefa está no estado atual (o servidor manda "desde"; sem ele, vale o início)
const desdeDe = t => t.desde || t.inicio;
function tempoNoEstado(t) {
  const d = tempoDesde(desdeDe(t)), espera = /^waiting_/.test(t.status);
  return d === "agora" ? (espera ? "esperando agora" : "começou agora") : `${espera ? "esperando" : "rodando"} ${d}`;
}

function mini(ap) {
  const cv = document.createElement("canvas"); cv.width = 44; cv.height = 44; cv.className = "mini";
  const c = cv.getContext("2d"); c.imageSmoothingEnabled = false; c.drawImage(Avatar.desenhar(ap), 0, 0, 44, 44);
  cv.setAttribute("aria-hidden", "true");
  return cv;
}

function textoSe(e, txt) { if (e.textContent !== txt) e.textContent = txt; }   // só escreve quando muda
function elem(tag, classe, texto) { const e = document.createElement(tag); if (classe) e.className = classe; if (texto != null) e.textContent = texto; return e; }

// Ícones da interface em pixel art: os mesmos desenhos 8x8 das placas, como SVG nítido
function iconeSvg(nome) {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 8 8"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  (ICONES[nome] || ICONES.estrela).forEach((linha, y) => [...linha].forEach((ch, x) => {
    if (ch === ".") return;
    const r = document.createElementNS(ns, "rect");
    r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", 1); r.setAttribute("height", 1); r.setAttribute("fill", "currentColor");
    if (ch === "+") r.setAttribute("fill-opacity", ".5");
    svg.append(r);
  }));
  return svg;
}
function pintarIcones(raiz) { for (const e of raiz.querySelectorAll("[data-icone]")) if (!e.firstChild) e.append(iconeSvg(e.dataset.icone)); }
Object.assign(ICONES, {
  predio:   ["..####..", ".#+##+#.", ".######.", ".#+##+#.", ".######.", ".#+##+#.", ".##..##.", "########"],
  balao:    [".######.", "########", "##+##+##", "########", "########", ".######.", "..##....", ".#......"],
  ajuda:    ["..####..", ".##..##.", ".....##.", "....##..", "...##...", "...##...", "........", "...##..."],
  lupa:     ["..###...", ".#...#..", "#.....#.", "#.....#.", ".#...#..", "..####..", ".....##.", "......##"],
  expandir: ["###..###", "#......#", "#......#", "........", "........", "#......#", "#......#", "###..###"],
  recolher: ["#......#", ".##..##.", ".##..##.", "........", "........", ".##..##.", ".##..##.", "#......#"],
  alvo:     ["...##...", "..####..", ".##..##.", "###..###", "###..###", ".##..##.", "..####..", "...##..."],
  encaixar: ["##....##", "#......#", "..####..", "..#++#..", "..#++#..", "..####..", "#......#", "##....##"],
  copiar:   ["..#####.", "..#...#.", "###...#.", "#.#...#.", "#.#####.", "#...#...", "#####...", "........"],
  tv:       [".#...#..", "..#.#...", "########", "#++++++#", "#++++++#", "#++++++#", "########", ".#....#."],
  filme:    ["########", "#.#..#.#", "########", "#++++++#", "#++++++#", "########", "#.#..#.#", "########"],
});

// Onde está e o que faz cada agente (o mapa e o painel usam a mesma resposta)
function situacao(b) {
  if (b.trabalho) return estadoDe(b.trabalho.status).filtro;
  if ((b.lugar && b.lugar.tipo === "fora") || (b.destino && b.destino.tipo === "fora")) return "fora";
  return "livres";
}
function classeDe(b) { const sit = situacao(b); return sit === "trab" || sit === "esp" ? estadoDe(b.trabalho.status).classe : sit === "fora" ? "fora" : "livre"; }
function textoEstado(b) { return b.trabalho ? estadoDe(b.trabalho.status).texto : situacao(b) === "fora" ? "Fora" : "Livre"; }
function ondeEsta(b) {
  if (situacao(b) === "fora") return b.rota.length ? "Indo para casa" : "Foi para casa";
  if (b.rota.length) return "Andando pelo escritório";
  if (b.lugar && b.lugar.tipo === "mesa") return `Na mesa, sala ${b.lugar.mesa.sala.nome}`;
  if (b.lugar && b.lugar.vaga) return b.lugar.vaga.sala.nome;
  return "No escritório";
}
const boneco = id => (mundo ? mundo.bonecos.get(id) : null);
const porHandle = h => (mundo ? [...mundo.bonecos.values()].find(b => b.handle === h) : null);
function salaDoAgente(handle) { const s = predio && predio.salas.find(q => (q.handles || []).includes(handle)); return s ? s.nome : ""; }

// ---------- chips de estado (contam e filtram) ----------------------------------------
function atualizarEstados() {
  if (!mundo) return;
  const n = { todos: 0, trab: 0, esp: 0, livres: 0, fora: 0 };
  for (const b of mundo.bonecos.values()) { n.todos++; n[situacao(b)]++; }
  for (const b of document.querySelectorAll("#estados [data-filtro]")) {
    const k = b.dataset.filtro, alvo = b.querySelector("[data-n]");
    if (alvo.textContent !== String(n[k])) alvo.textContent = n[k];
    b.classList.toggle("zero", !n[k] && k !== "todos");
  }
  const partes = [[n.esp, "esperando você", "esperando você"], [n.trab, "trabalhando", "trabalhando"], [n.livres, "livre", "livres"], [n.fora, "fora", "fora"]]
    .filter(([q], i) => q || i < 3).map(([q, um, varios]) => `${q} ${q === 1 ? um : varios}`);
  const resumo = n.todos ? partes.join(" · ") : "Nenhum agente nesta organização ainda";
  if ($("resumo-esc").textContent !== resumo) $("resumo-esc").textContent = resumo;
}
function filtrar(qual) {
  filtro = qual;
  document.querySelectorAll("[data-filtro]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.filtro === filtro)));
  if (estado) desenharPainel();
}
for (const b of document.querySelectorAll("[data-filtro]")) b.addEventListener("click", () => filtrar(filtro === b.dataset.filtro && filtro !== "todos" ? "todos" : b.dataset.filtro));   // clicar de novo desliga o filtro

// ---------- painel: esperando você, agentes e pedidos ---------------------------------
function desenharPainel() {
  if (!mundo) return;
  const ags = estado.agentes || [], trs = estado.trabalhos || [];
  const nomeDe = id => (ags.find(a => a.id === id) || {}).nome || "Agente";
  const handleDe = id => (ags.find(a => a.id === id) || {}).handle;
  const esperando = trs.filter(t => /^waiting_/.test(t.status)).sort((a, b) => Date.parse(desdeDe(a)) - Date.parse(desdeDe(b)));
  const aprov = esperando.filter(t => t.status === "waiting_approval").length, perg = esperando.length - aprov;
  // sino da barra do celular: contador âmbar e o resumo no nome acessível
  const resumo = !esperando.length ? "" : aprov && perg ? `${esperando.length} esperando você` : aprov ? `${aprov} ${aprov === 1 ? "aprovação pendente" : "aprovações pendentes"}` : `${perg} ${perg === 1 ? "pergunta para você" : "perguntas para você"}`;
  $("pendencias-n").hidden = !esperando.length; $("pendencias-n").textContent = esperando.length;
  $("pendencias").setAttribute("aria-label", resumo ? `Aprovações: ${resumo}` : "Aprovações");
  $("nav-aprovacoes").hidden = !esperando.length; $("nav-aprovacoes").textContent = esperando.length;
  $("nav-aprovacoes").setAttribute("aria-label", resumo);
  // "Esperando você" no escritório: cartões de uma linha (2 no máximo a partir do 3º pedido, para o mapa
  // ficar na primeira dobra); a tela Aprovações mostra todos, completos
  // widgets embaixo do mapa: até 3 pedidos (a tela Aprovações mostra todos) e quem está trabalhando agora
  $("avisos").replaceChildren(...esperando.slice(0, 3).map(t => cartaoPedido(t, nomeDe(t.agente_id), handleDe(t.agente_id), true)));
  if (!esperando.length) $("avisos").append(elem("p", "widget-vazio", "Nada esperando você agora."));
  $("ver-pedidos").textContent = esperando.length > 3 ? `Ver todos (${esperando.length})` : "Ver todos";
  $("esperando-n").textContent = esperando.length || "";
  const rodando = trs.filter(t => !/^waiting_/.test(t.status)).sort((a, b) => Date.parse(desdeDe(a)) - Date.parse(desdeDe(b)));
  $("trabalhando-lista").replaceChildren(...rodando.slice(0, 4).map(t => linhaTrabalho(t, nomeDe(t.agente_id), handleDe(t.agente_id))));
  if (rodando.length > 4) { const mais = elem("button", "widget-mais link-bt", `Mais ${rodando.length - 4} trabalhando: mostrar no mapa`); mais.type = "button"; mais.addEventListener("click", () => filtrar("trab")); $("trabalhando-lista").append(mais); }
  if (!rodando.length) $("trabalhando-lista").append(elem("p", "widget-vazio", "Ninguém trabalhando agora."));
  $("trabalhando-n").textContent = rodando.length || "";
  desenharAprovacoes(esperando, nomeDe, handleDe);
  // agentes na lateral: quem espera primeiro, depois quem trabalha, livres e fora (avatar com a luz do estado)
  const ordem = { esp: 0, trab: 1, livres: 2, fora: 3 };
  const bs = [...mundo.bonecos.values()].sort((a, b) => ordem[situacao(a)] - ordem[situacao(b)] || a.nome.localeCompare(b.nome));
  let visiveis = 0;
  $("lista").replaceChildren(...bs.map(b => {
    const ok = combina(b); if (ok) visiveis++;
    const item = elem("button", "item" + (selecionado === b.id ? " sel" : "") + (ok ? "" : " apagado"));
    item.type = "button";
    if (b.trabalho && b.trabalho.rotulo) item.title = b.trabalho.rotulo;
    item.addEventListener("click", () => { irParaEscritorio(); focarAgente(b, { seguir: true, foco: true }); });
    item.addEventListener("mouseenter", () => { realce = b.id; });
    item.addEventListener("mouseleave", () => { realce = null; });
    const foto = elem("span", "foto"); foto.append(mini(b.ap), elem("i", `led ${classeDe(b)}`));
    const sala = salaDoAgente(b.handle), txt = elem("span", "txt");
    txt.append(elem("strong", "nome", b.nome), elem("span", "sub", b.trabalho ? `${textoEstado(b)}${sala ? " · " + sala : ""}` : ondeEsta(b)));
    item.append(foto, txt);
    return item;
  }));
  if (!bs.length) $("lista").append(elem("p", "vazio", "Nenhum agente nesta organização ainda."));
  $("contagem").textContent = filtro === "todos" ? `${bs.length}` : `${visiveis} de ${bs.length}`;
  const nSalas = predio.salas.length + predio.baixo.length;
  $("org-resumo").textContent = `${bs.length} ${bs.length === 1 ? "agente" : "agentes"} · ${nSalas} ${nSalas === 1 ? "sala" : "salas"}`;
  atualizarEstados();
}

function cartaoPedido(t, nome, handle, compacto) {
  const pergunta = t.status === "waiting_input";
  const c = elem("article", "pedido");
  c.setAttribute("aria-label", pergunta ? `${nome} tem uma pergunta para você` : `${nome} pede a sua aprovação`);
  const verNoMapa = () => { const b = boneco(t.agente_id); if (b) { irParaEscritorio(); focarAgente(b, { seguir: true, foco: true }); } };
  if (compacto) { // uma linha: quem e o quê (leva ao agente no mapa), há quanto tempo e o botão principal
    const linha = elem("div", "linha-widget"), ir = elem("button", "linha-ir"); ir.type = "button";
    const txt = elem("span", "txt"), quem = elem("span", "quem"), sub = elem("span", "sub");
    quem.append(elem("strong", null, nome), pergunta ? " tem uma pergunta" : " pede aprovação");
    sub.append(elem("span", pergunta ? "quando pergunta" : "quando", tempoDesde(desdeDe(t))), ` · ${t.rotulo || "Pedido sem descrição"}`);
    txt.append(quem, sub); ir.append(mini(aparencia(handle)), txt); ir.title = t.rotulo || "";
    ir.setAttribute("aria-label", `${nome} ${pergunta ? "tem uma pergunta" : "pede aprovação"} ${tempoDesde(desdeDe(t))}: ${t.rotulo || "pedido sem descrição"}. Ver no mapa`);
    ir.addEventListener("click", verNoMapa);
    linha.append(ir);
    if (t.url) { const a = elem("a", "botao", pergunta ? "Responder" : "Revisar"); a.href = t.url; a.target = "_blank"; a.rel = "noopener"; a.setAttribute("aria-label", pergunta ? `Responder ${nome} no agentes.chat` : `Revisar o pedido de ${nome} no agentes.chat`); linha.append(a); }
    return linha;
  }
  // tela Aprovações: quem pede, o selo do tipo, o pedido, há quanto tempo espera e as ações
  const titulo = elem("div", "pedido-titulo"), corpo = elem("div", "pedido-corpo");
  titulo.append(elem("strong", null, pergunta ? `${nome} tem uma pergunta` : `${nome} pede a sua aprovação`), elem("span", `selo-tipo ${pergunta ? "pergunta" : "aprovacao"}`, pergunta ? "Pergunta" : "Aprovação"));
  const meta = elem("p", "meta"); meta.dataset.desde = desdeDe(t) || ""; meta.dataset.sala = salaDoAgente(handle);
  corpo.append(titulo, elem("p", "oque", t.rotulo || "Pedido sem descrição"), meta);
  const acoes = elem("div", "pedido-acoes");
  if (t.url) { const a = elem("a", "botao", pergunta ? "Responder" : "Revisar pedido"); a.href = t.url; a.target = "_blank"; a.rel = "noopener"; a.setAttribute("aria-label", pergunta ? `Responder ${nome} no agentes.chat` : `Revisar o pedido de ${nome} no agentes.chat`); acoes.append(a); }
  const ver = elem("button", "botao fantasma", "Ver no mapa"); ver.type = "button"; ver.setAttribute("aria-label", `Ver ${nome} no mapa`);
  ver.addEventListener("click", verNoMapa);
  acoes.append(ver);
  c.append(mini(aparencia(handle)), corpo, acoes);
  metaPedido(meta);
  return c;
}

// quem está trabalhando: sala, o que faz e há quanto tempo (a linha leva ao agente no mapa)
function linhaTrabalho(t, nome, handle) {
  const ir = elem("button", "linha-ir linha-widget"); ir.type = "button";
  const sala = salaDoAgente(handle), txt = elem("span", "txt"), quem = elem("span", "quem");
  quem.append(elem("strong", null, nome), sala ? elem("span", "suave-in", ` na sala ${sala}`) : "");
  txt.append(quem, elem("span", "sub", t.rotulo || "Tarefa sem descrição"));
  ir.append(mini(aparencia(handle)), txt, elem("span", "ha", tempoDesde(desdeDe(t)).replace("há ", "")));
  ir.title = t.rotulo || "";
  ir.addEventListener("click", () => { const b = boneco(t.agente_id); if (b) focarAgente(b, { seguir: true, foco: true }); });
  return ir;
}

// ---------- salas: contagem ao vivo e câmera até a sala --------------------------------
function montarSalas() {
  $("salas").replaceChildren(...[...predio.salas, ...predio.baixo].map(s => {
    // sala como canal: "#" na cor da sala, nome e quem está na mesa
    const li = elem("li"), b = elem("button"); b.type = "button"; b.dataset.sala = s.nome;
    const ic = elem("span", "sala-ic", "#"); ic.setAttribute("aria-hidden", "true"); ic.style.color = clarear(corDaSala(s), 0.25);
    b.append(ic, elem("span", "sala-nome", s.nome), elem("span", "sala-n"));
    b.addEventListener("click", () => { irParaEscritorio(); fecharFicha(); focarSala(s); if (innerWidth <= 760) $("palco-cartao").scrollIntoView({ block: "start", behavior: menosMovimento.matches ? "auto" : "smooth" }); });
    li.append(b); return li;
  }));
  atualizarSalas();
}
function atualizarSalas() {
  if (!mundo) return;
  const bs = [...mundo.bonecos.values()], gente = Vida.pessoas();   // gente: as pessoas da equipe neste andar e eu (vida.js)
  for (const s of [...predio.salas, ...predio.baixo]) {
    const b = $("salas").querySelector(`[data-sala="${CSS.escape(s.nome)}"]`); if (!b) continue;
    let txt, ativa, espera = false;
    if (s.mesas && s.mesas.length) { // time: quem está na mesa trabalhando, de quantos; âmbar se alguém espera você
      const donos = bs.filter(x => (s.handles || []).includes(x.handle));
      const na = donos.filter(x => x.lugar && x.lugar.tipo === "mesa" && x.trabalho).length;
      txt = `${na}/${donos.length}`; ativa = na > 0; espera = donos.some(x => situacao(x) === "esp");
    } else {
      const aqui = bs.filter(x => visivel(x) && salaEm(x) === s).length + gente.filter(p => salaEm(p) === s).length;   // pela posição de agora (quem está chegando já conta)
      txt = aqui ? `${aqui} aqui` : "vazia"; ativa = false;
    }
    const n = b.querySelector(".sala-n");
    if (n.textContent !== txt) n.textContent = txt;
    n.classList.toggle("ativa", ativa && !espera); n.classList.toggle("espera", espera);
    b.setAttribute("aria-label", `${s.nome}: ${s.mesas && s.mesas.length ? `${txt} na mesa` : txt}`);
  }
}

// ---------- ficha do agente (abre pela busca, pela lista ou tocando no mapa) ----------
let seguir = null, realce = null, assinaturaFicha = "";
function focarAgente(b, { seguir: seg = false, foco = false } = {}) {
  selecionado = b.id;
  seguir = seg ? b.id : null;
  moverCamera({ x: b.x, y: b.y - 10, k: Math.max(cam.k, 3.2 * dpr) });
  abrirFicha(b, foco);
  if (innerWidth <= 760 && !$("palco-cartao").classList.contains("cheio")) $("palco-cartao").scrollIntoView({ block: "start", behavior: menosMovimento.matches ? "auto" : "smooth" });
  desenharPainel();
}
function abrirFicha(b, foco) {
  fecharConversa(false);
  selecionado = b.id; assinaturaFicha = "";
  if (!amizades || amizades.id !== b.id) amizades = null;
  if (socialLigada() && !Brincar.demo) carregarAmizades(b.id);
  renderFicha();
  $("ficha").hidden = false; $("cartao-agente").hidden = true;
  if (foco) $("ficha").focus({ preventScroll: true });
}
function fecharFicha() {
  const estava = !$("ficha").hidden || !$("conversa").hidden;
  fecharConversa(false);
  $("ficha").hidden = true; selecionado = null; seguir = null;
  if (estava && estado) desenharPainel();
}
function renderFicha() {
  const f = $("ficha"), b = boneco(selecionado);
  if (!b) { if (!f.hidden) fecharFicha(); return; }
  const t = b.trabalho, resp = itemParaResponder(b), social = socialLigada(), motivo = social ? motivoRingue(b) : "";
  const chave = [b.id, t && t.status, t && t.rotulo, t && t.url, ondeEsta(b), seguir === b.id, resp && resp.id,
    social && (amizades && amizades.id === b.id ? amizades.v : 0), motivo].join("|");
  if (chave === assinaturaFicha) { const q = f.querySelector(".ficha-tempo"); if (q && t) q.textContent = tempoNoEstado(t); return; }
  assinaturaFicha = chave;
  f.tabIndex = -1;
  const topo = elem("div", "ficha-topo"), nomes = elem("div");
  const h = elem("h2", null, b.nome); h.id = "ficha-nome";
  nomes.append(h, elem("p", "funcao", b.funcao || salaDoAgente(b.handle)));
  const x = elem("button", "fechar", "×"); x.type = "button"; x.setAttribute("aria-label", "Fechar o cartão"); x.addEventListener("click", fecharFicha);
  topo.append(mini(b.ap), nomes, x);
  const dl = elem("dl"), linha = (rot, ...conteudo) => { const dd = elem("dd"); dd.append(...conteudo); dl.append(elem("dt", null, rot), dd); };
  const chip = elem("span", `chip ${classeDe(b)}`, textoEstado(b));
  linha("Estado", chip, ...(t ? [document.createTextNode(" "), elem("span", "ficha-tempo suave", tempoNoEstado(t))] : []));
  if (t) linha("Fazendo", document.createTextNode(t.rotulo || "Tarefa sem descrição"));
  linha("Onde", document.createTextNode(ondeEsta(b)));
  if (social && !Brincar.demo) linha("Amizades", secaoAmizades(b));   // a demonstração não tem amizades: nada vai ao servidor
  const acoes = elem("div", "acoes");
  if (resp) { // uma caixa só: a resposta mora na página Conversas, e a ficha leva até ela
    const rb = elem("button", "botao", "Responder"); rb.type = "button"; rb.setAttribute("aria-label", `Responder ${b.nome} na página Conversas`);
    rb.addEventListener("click", () => irParaResposta(resp.id)); acoes.append(rb);
  }
  if (t && t.url) {
    const espera = /^waiting_/.test(t.status) && !resp, a = elem("a", espera ? "botao" : "botao fantasma", t.status === "waiting_approval" ? "Revisar pedido" : t.status === "waiting_input" && !resp ? "Responder no agentes.chat" : "Abrir no agentes.chat");
    a.href = t.url; a.target = "_blank"; a.rel = "noopener"; acoes.append(a);
  }
  const seg = elem("button", "botao fantasma seguir"); seg.type = "button"; seg.setAttribute("aria-pressed", String(seguir === b.id));
  const ic = elem("span", "ic"); ic.append(iconeSvg("alvo")); seg.append(ic, document.createTextNode(seguir === b.id ? "Seguindo" : "Seguir"));
  seg.addEventListener("click", () => { seguir = seguir === b.id ? null : b.id; renderFicha(); $("ficha").querySelector(".seguir").focus(); });   // a ficha é refeita: o foco volta ao botão novo
  acoes.append(seg);
  if (t && t.url && conversaLigada()) {
    const vc = elem("button", "botao fantasma ver-conversa", "Ver conversa"); vc.type = "button"; vc.setAttribute("aria-haspopup", "dialog");
    vc.addEventListener("click", () => abrirConversa(b)); acoes.append(vc);
  }
  const fim = [];
  if (social) { // o motivo fica à vista embaixo do botão desabilitado (o servidor confere tudo de novo no envio)
    const rg = elem("button", "botao fantasma ringue so-admin", "Mandar pro ringue"); rg.type = "button"; rg.setAttribute("aria-haspopup", "dialog");
    if (motivo) { rg.disabled = true; rg.setAttribute("aria-describedby", "ficha-motivo"); const p = elem("p", "ficha-motivo", motivo); p.id = "ficha-motivo"; fim.push(p); }
    rg.addEventListener("click", () => abrirRingue(b, rg)); acoes.append(rg);
  }
  f.replaceChildren(topo, dl, acoes, ...fim);
}

// ---------- vida social na ficha (contrato S, fatia 1): amizades pelo GET /api/social e "Mandar pro ringue" pelo POST
// /api/social/briga. É diversão: some sem o bloco social (servidor antigo), no modo sério, na demonstração e na Simulação.
const naSimulacao = () => ["data", "hora", "clima"].some(k => new URLSearchParams(location.search).has(k));
const socialLigada = () => !!estado && !!estado.social && typeof estado.social === "object" && estado.social.serio !== true && !naSimulacao();
const nomeAgente = id => { const b = boneco(id); return b ? b.nome : (((estado && estado.agentes) || []).find(a => a.id === id) || {}).nome || "Agente"; };
let amizades = null, pedidoAmizades = 0, cenaVista = null, releitura = 0, releituraPlacar = 0, ringueDe = null, ringueOrigem = null;   // amizades: { id, d, erro, lida, v } da ficha aberta
async function carregarAmizades(id) {
  const n = ++pedidoAmizades;
  let r = null, d = null;
  try { r = await fetch(Andar.com(`api/social?agente=${encodeURIComponent(id)}`), { cache: "no-store", credentials: "same-origin" }); d = await r.json().catch(() => null); }
  catch (e) { r = null; }
  if (n !== pedidoAmizades || selecionado !== id) return;   // fechou ou trocou de agente enquanto esperava
  if (r && r.status === 401) { location.href = "/entrar"; return; }
  const ok = !!r && r.ok && !!d && Array.isArray(d.amigos) && Array.isArray(d.rivais);
  amizades = { id, d: ok ? d : null, erro: ok ? "" : r && r.status === 404 ? "sem" : "falhou", lida: performance.now(), v: ((amizades && amizades.v) || 0) + 1 };
  renderFicha();
}
// a cada leitura: relê as amizades da ficha aberta no fim de cada cena, de novo uns 70 s depois do fim (o servidor só conta a
// briga no passo seguinte, de 60 s) e a cada 60 s; o prazo sai da diferença para o social.agora, nunca do relógio da máquina
function vigiarSocial() {
  const c = socialLigada() && estado.social.cena, cena = c ? c.id : null, acabou = !!cenaVista && cenaVista !== cena;
  if (c && cena !== cenaVista) { const falta = Date.parse(c.fim) - Date.parse(estado.social.agora); if (Number.isFinite(falta)) releitura = releituraPlacar = performance.now() + falta + 70000; }
  cenaVista = cena;
  if (releituraPlacar && performance.now() >= releituraPlacar) { releituraPlacar = 0; if ($("dlg-placar").open) carregarPlacar(); }   // a briga entra no placar no passo seguinte
  if (Brincar.demo || $("ficha").hidden || !selecionado || !socialLigada()) return;   // na demonstração não há amizades (nada vai ao servidor)
  const tarde = releitura && performance.now() >= releitura;
  if (tarde) releitura = 0;
  if (!amizades || amizades.id !== selecionado || acabou || tarde || performance.now() - amizades.lida > 60000) carregarAmizades(selecionado);
}
function secaoAmizades(b) {
  const caixa = elem("div", "amizades"), a = amizades && amizades.id === b.id ? amizades : null;
  if (!a || !a.d) { caixa.append(elem("p", "suave", !a ? "Carregando…" : a.erro === "sem" ? "Nada para mostrar agora." : "Não deu para ler as amizades agora.")); return caixa; }
  const d = a.d, valor = v => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  if (Number.isFinite(d.media)) caixa.append(elem("p", "amz-media", `Média com a equipe: ${valor(d.media)} de 100`));
  const lista = (titulo, itens, vazio, tipo) => {
    caixa.append(elem("p", "amz-titulo", titulo));
    itens = itens.filter(it => it && typeof it.id === "string").slice(0, 3);
    if (!itens.length) { caixa.append(elem("p", "amz-vazio", vazio)); return; }
    const ul = elem("ul", `amz-lista ${tipo}`);
    for (const it of itens) { // barra e número: a informação não fica só na cor
      const v = valor(it.valor), barra = elem("span", "amz-barra"), cheio = elem("span"), num = elem("span", "amz-valor", String(v)), li = elem("li");
      cheio.style.width = `${v}%`; barra.append(cheio); barra.setAttribute("aria-hidden", "true"); num.append(elem("span", "oculto", " de 100"));
      li.append(elem("span", "amz-nome", nomeAgente(it.id)), barra, num); ul.append(li);
    }
    caixa.append(ul);
  };
  lista("Melhores amigos", d.amigos, "Ainda sem melhores amigos.", "amigos");
  lista("Rivais", d.rivais, "Nenhum rival por enquanto.", "rivais");
  const br = d.ultima_briga;
  caixa.append(elem("p", "amz-briga", br && typeof br.contra === "string"
    ? `Última briga hoje: ${br.venceu ? "venceu" : "perdeu para"} ${nomeAgente(br.contra)}${br.em ? ` às ${horaDe(br.em)}` : ""}.` : "Nenhuma briga hoje."));
  return caixa;
}
function motivoRingue(b) { // por que o botão está desabilitado agora ("" = pode mandar)
  if (Expediente.fora(Ceu.agora().h)) return "Fora do expediente: o ringue está fechado.";
  if (b.trabalho) return /^waiting_/.test(b.trabalho.status) ? `${b.nome} está esperando você agora.` : `${b.nome} está trabalhando agora.`;
  if (situacao(b) === "fora") return `${b.nome} não está no escritório agora.`;
  if (estado.social.cena) return estado.social.cena.tipo === "greve" ? "Tem greve na Sala comunal; o ringue espera." : "Já tem briga no ringue; espere acabar.";
  return "";
}
// seletor do par: só quem está livre e no escritório (o servidor confere de novo); Esc fecha e o foco volta ao botão
function abrirRingue(b, origem) {
  const d = $("dlg-ringue"); if (!d.showModal) return;
  ringueDe = b.id; ringueOrigem = origem;
  const livres = [...mundo.bonecos.values()].filter(o => o.id !== b.id && situacao(o) === "livres").sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
  textoSe($("ringue-texto"), `Escolha quem enfrenta ${b.nome}. A briga começa em uns 15 segundos e aparece em todas as telas. É só diversão: não muda nada no trabalho dos agentes.`);
  $("ringue-lista").replaceChildren(...(livres.length ? livres.map(o => {
    const l = elem("label", "ringue-op"), i = elem("input"); i.type = "radio"; i.name = "rival"; i.value = o.id;
    l.append(i, mini(o.ap), elem("span", "ringue-nome", o.nome), elem("span", "ringue-onde", ondeEsta(o))); return l;
  }) : [elem("p", "suave", `Ninguém livre agora para enfrentar ${b.nome}.`)]));
  $("ringue-aviso").textContent = "";
  $("ringue-mandar").disabled = !livres.length;
  d.showModal();
  ($("ringue-lista").querySelector("input") || $("ringue-cancelar")).focus();
}
function aplicarCena(cena) { // a resposta do POST já traz a cena: a tela não espera a próxima leitura (que traz a mesma, pelo id)
  estado.social = { ...estado.social, cena };
  Vida.social(mundo, { v: 1, cena, eventos: [] });   // sem o "agora": o vida.js usa o desvio de relógio da última leitura
  renderFicha();
}
const ERROS_RINGUE = { origem: "Não deu para mandar desta página. Recarregue e tente de novo.", formato: "Não deu para mandar agora. Recarregue a página e tente de novo.",
  pedido: "Não deu para mandar agora. Recarregue a página e tente de novo." };
function textoErroRingue(r) {
  if (r.status === 0) return "Sem conexão com o escritório. Tente de novo.";
  const e = r.d && r.d.erro;
  return ERROS_RINGUE[e] || mensagemDe(r, r.status === 429 ? "O ringue já teve brigas demais hoje; volta amanhã."
    : r.status === 409 ? "O ringue não está livre agora. Tente daqui a pouco." : "Não deu para mandar pro ringue agora. Tente de novo.");
}
$("form-ringue").addEventListener("submit", async ev => {
  ev.preventDefault();
  const bt = $("ringue-mandar"), aviso = $("ringue-aviso"), rival = $("form-ringue").querySelector("input[name=rival]:checked");
  if (bt.disabled || bt.getAttribute("aria-disabled") === "true") return;   // sem envio duplo
  if (!rival) { aviso.textContent = "Escolha quem vai enfrentar."; return; }
  bt.setAttribute("aria-disabled", "true"); bt.textContent = "Mandando…"; aviso.textContent = "";
  const a = ringueDe, r = Brincar.demo ? Brincar.brigaDemo(a, rival.value) : await postarResposta("api/social/briga", { a, b: rival.value });   // demonstração: local, sem POST
  bt.removeAttribute("aria-disabled"); bt.textContent = "Mandar pro ringue";
  if (r.status === 401) { location.href = "/entrar"; return; }
  if (estado && estado.social && r.d && r.d.cena && typeof r.d.cena === "object") aplicarCena(r.d.cena);   // o 200 e o 409 "ocupado" trazem a cena
  if (r.status === 200) {
    textoSe($("social-anuncio"), `Gongo! ${nomeAgente(a)} e ${nomeAgente(rival.value)} vão para o ringue.`);
    $("dlg-ringue").close(); return;
  }
  if (r.d && r.d.erro === "modo_serio" && estado && estado.social) { estado.social.serio = true; renderFicha(); }
  aviso.textContent = textoErroRingue(r);
});
// ---------- placar do ringue (adendo da fatia 1c): ranking semanal, com o campeão da semana passada
const placarDaTela = () => (!naSimulacao() && estado && estado.social && estado.social.serio !== true && estado.social.placar) || null;   // null: "Ringue fechado"
let vencedorDito = null;
function anunciarVencedor() { // um aviso educado por cena, só quando o resultado chegou nesta tela
  const cs = mundo.cenaSocial;
  if (!cs || cs.fase !== "resultado" || !cs.vencedor || cs.id === vencedorDito) return;
  vencedorDito = cs.id;
  textoSe($("social-anuncio"), `${nomeAgente(cs.vencedor)} venceu ${nomeAgente(cs.vencedor === cs.a ? cs.b : cs.a)} no ringue.`);
}
let entregaDita = null, motoOuvida = null;
function anunciarEntrega() { // um aviso e um som por entrega, quando o pedido chega nesta tela (a campainha é do vida.js)
  const e = mundo.entrega;
  if (e && e.item === "pizza" && e.entregador && e.id !== motoOuvida) { motoOuvida = e.id; Som.evento("moto"); }   // o motoboy estacionou
  if (!e || e.fase !== "entregue" || e.id === entregaDita) return;
  entregaDita = e.id;
  setTimeout(() => Som.evento(`entrega_${e.item}`), 900);   // depois do "dim-dom"
  textoSe($("social-anuncio"), `Chegou o pedido da greve${typeof e.pedido === "string" && e.pedido ? `: ${paraLer(e.pedido)}` : ""}!`);
}
let placarOrigem = null, placarVez = 0, placarTimer = 0;
const semanaDe = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${Number(m[3])}/${Number(m[2])}` : ""; };
function abrirPlacar() {
  const d = $("dlg-placar"); if (!d.showModal || d.open) return;
  placarOrigem = document.activeElement;
  d.showModal(); $("placar-fechar").focus();
  carregarPlacar();
  clearInterval(placarTimer); placarTimer = setInterval(() => { if (d.open && !document.hidden) carregarPlacar(); }, 60000);   // a cada 60 s enquanto aberto
}
async function carregarPlacar() {
  const n = ++placarVez, aviso = $("placar-aviso"), corpo = $("placar-corpo");
  if (!socialLigada()) { $("placar-semana").textContent = ""; corpo.replaceChildren(); $("placar-tabela").hidden = true; $("placar-anterior").hidden = true; aviso.textContent = "Ringue fechado: o placar não aparece agora."; return; }
  let r = null, d = null;
  if (Brincar.demo) { r = { ok: true, status: 200 }; d = Brincar.placarDemo(); }   // demonstração: placar local, nada vai ao servidor
  else {
    aviso.textContent = "Carregando o placar…";
    try { r = await fetch(Andar.com("api/social/placar"), { cache: "no-store", credentials: "same-origin" }); d = await r.json().catch(() => null); } catch (e) { r = null; }
    if (n !== placarVez || !$("dlg-placar").open) return;
    if (r && r.status === 401) { location.href = "/entrar"; return; }
  }
  if (!r || !r.ok || !d || !Array.isArray(d.ranking)) { aviso.textContent = "Não deu para ler o placar agora. Tente de novo daqui a pouco."; return; }
  const num = v => Math.max(0, Math.round(Number(v) || 0)), linhas = d.ranking.filter(x => x && typeof x.id === "string" && boneco(x.id));
  const sem = semanaDe(d.semana);
  $("placar-semana").textContent = sem ? `Semana que começou na segunda, ${sem}. Só aparece quem está no escritório e já lutou.` : "Só aparece quem está no escritório e já lutou.";
  corpo.replaceChildren(...linhas.map((x, i) => {
    const tr = elem("tr"), seq = Math.round(Number(x.seq) || 0), cel = (txt, cls) => { const td = elem("td", cls, txt); tr.append(td); return td; };
    cel(String(i + 1), "pl-pos"); cel(nomeAgente(x.id), "pl-nome"); cel(String(num(x.v)), "pl-num"); cel(String(num(x.d)), "pl-num");
    const sq = cel("", "pl-seq");
    if (seq >= 2) { sq.append(elem("span", null, "🔥")); sq.firstChild.setAttribute("aria-hidden", "true"); sq.append(` ${seq}`, elem("span", "oculto", " vitórias seguidas")); }
    else if (seq <= -2) { sq.append(`−${-seq}`, elem("span", "oculto", " derrotas seguidas")); }
    else sq.textContent = "—";
    return tr;
  }));
  $("placar-tabela").hidden = !linhas.length;
  aviso.textContent = linhas.length ? "" : "Ninguém lutou nesta semana ainda.";
  const ant = d.anterior && typeof d.anterior.id === "string" && boneco(d.anterior.id) ? d.anterior : null;   // ausente: a linha some
  $("placar-anterior").hidden = !ant;
  if (ant) { // a coroa é enfeite: o leitor de tela lê só o texto
    const coroa = elem("span", null, "👑 "); coroa.setAttribute("aria-hidden", "true");
    $("placar-anterior").replaceChildren(coroa, `Campeão da semana passada: ${nomeAgente(ant.id)} (${num(ant.v)} ${num(ant.v) === 1 ? "vitória" : "vitórias"}, ${num(ant.d)} ${num(ant.d) === 1 ? "derrota" : "derrotas"}).`);
  }
}
// ---------- greve (fatia 2): o aviso em cima do mapa diz o motivo e atende o pedido pelo POST /api/social/greve/atender; no
// mapa, o clique nas plaquinhas faz o mesmo (brincar.js). Some sem social, no modo sério e na Simulação
let greveVista = null;
const salaDaGreve = () => (predio && predio.ringue && predio.ringue.sala && predio.ringue.sala.nome) || "Sala comunal";
const motivoGreve = g => (window.Vida && Vida.textoGreve ? String(Vida.textoGreve(Math.max(0, Math.round(Number(g.motivo) || 0))) || "") : "");
// "MAIS CAFÉ" -> "Mais café": o leitor de tela não soletra; sem a pontuação do fim ("PUFE JÁ!"), que a frase já põe a dela
const paraLer = t => (t.charAt(0) + t.slice(1).toLowerCase()).replace(/[!.]+$/, "");
function vigiarGreve() {
  const c = socialLigada() && estado.social.cena, g = c && c.tipo === "greve" && typeof c.id === "string" ? c : null, caixa = $("aviso-greve");
  if (!g) {
    if (!caixa.hidden && caixa.contains(document.activeElement)) tela.focus({ preventScroll: true });   // o foco não some com o aviso
    caixa.hidden = true; $("pular-greve").hidden = true; greveVista = null; return;
  }
  const motivo = motivoGreve(g), n = Array.isArray(g.participantes) ? g.participantes.length : 0;
  textoSe($("greve-motivo"), motivo ? `“${motivo}”` : "");
  if (motivo) $("greve-motivo").setAttribute("aria-label", paraLer(motivo)); else $("greve-motivo").removeAttribute("aria-label");   // em maiúsculas, alguns leitores soletram
  textoSe($("greve-texto"), `Greve na ${salaDaGreve()}`);
  caixa.hidden = false; $("pular-greve").hidden = false;
  if (g.id !== greveVista) { // um aviso por greve
    greveVista = g.id;
    textoSe($("social-anuncio"), `Greve na ${salaDaGreve()}! ${n > 1 ? `${n} agentes cruzaram os braços` : "Um agente cruzou os braços"}${motivo ? ` e ${n > 1 ? "pedem" : "pede"}: ${paraLer(motivo)}` : ""}.`);
  }
}
async function atenderGreve() {
  const c = socialLigada() && estado.social.cena, bt = $("greve-atender");
  if (!c || c.tipo !== "greve" || bt.getAttribute("aria-disabled") === "true") return;   // sem envio duplo
  bt.setAttribute("aria-disabled", "true");
  const r = Brincar.demo ? Brincar.atenderDemo(c.id) : await postarResposta("api/social/greve/atender", { id: c.id });   // demonstração: local
  bt.removeAttribute("aria-disabled");
  if (r.status === 401) { location.href = "/entrar"; return; }
  if (r.status === 200 || r.status === 404) { // 404: outra tela já atendeu, ou deu a hora; os grevistas se dispersam na hora
    if (estado.social && estado.social.cena && estado.social.cena.id === c.id) estado.social = { ...estado.social, cena: null };
    Vida.social(mundo, { v: 1, cena: null, eventos: [] });   // sem o "agora": o vida.js usa o desvio de relógio da última leitura
    vigiarGreve();
    textoSe($("social-anuncio"), r.status === 200 ? "Pedido atendido! A greve acabou." : "Essa greve já tinha acabado.");
    return;
  }
  if (r.d && r.d.erro === "modo_serio") { // o modo sério foi ligado em outra tela: os grevistas levantam já, e o leitor de tela sabe por quê
    if (estado.social) estado.social = { ...estado.social, serio: true, cena: null };
    Vida.social(mundo, { v: 1, serio: true, cena: null, eventos: [] });
    vigiarGreve();
    textoSe($("social-anuncio"), mensagemDe(r, "O modo sério está ligado: a vida social está pausada."));
    return;
  }
  textoSe($("social-anuncio"), r.status === 0 ? "Sem conexão com o escritório. Tente de novo." : mensagemDe(r, "Não deu para atender o pedido agora. Tente de novo."));
}
$("greve-atender").addEventListener("click", atenderGreve);
$("pular-greve").addEventListener("click", ev => { // atalho do topo (logo depois do "Ir para o conteúdo"): leva o foco direto ao botão
  ev.preventDefault();
  if ($("aviso-greve").hidden) return;
  $("greve-atender").scrollIntoView({ block: "nearest" }); $("greve-atender").focus();
});
$("placar-fechar").addEventListener("click", () => $("dlg-placar").close());
$("dlg-placar").addEventListener("click", ev => { if (ev.target === $("dlg-placar")) $("dlg-placar").close(); });   // clique no fundo escurecido
$("dlg-placar").addEventListener("close", () => { // Esc ou Fechar: para de reler e o foco volta para quem abriu
  clearInterval(placarTimer); placarVez++;
  const o = placarOrigem; placarOrigem = null;
  (o && o.isConnected && o !== document.body ? o : tela).focus();
});
$("ringue-cancelar").addEventListener("click", () => $("dlg-ringue").close());
$("dlg-ringue").addEventListener("click", ev => { if (ev.target === $("dlg-ringue")) $("dlg-ringue").close(); });   // clique no fundo escurecido
$("dlg-ringue").addEventListener("close", () => { // o foco volta ao botão; a ficha pode ter sido refeita enquanto o diálogo estava aberto,
  const o = ringueOrigem; ringueOrigem = null; ringueDe = null;   // e depois de um envio o botão novo vem desabilitado: o foco cai na ficha
  const bt = o && o.isConnected ? o : $("ficha").querySelector(".ringue");
  if ($("ficha").hidden) tela.focus(); else (bt && !bt.disabled ? bt : $("ficha")).focus();
});

// ---------- conversa do trabalho atual (contrato L, fase 1): só leitura pelo GET /api/conversa; texto puro, sem markdown
// nem autolink. Aparece no lugar da ficha; o nome de pessoas nunca vem do servidor, então quem não é agente aparece como "Pessoa".
const conversaLigada = () => !!config && !souMembro() && (config.conversas === "ler" || config.conversas === "responder") && !Brincar.demo
  && !["data", "hora", "clima"].some(k => new URLSearchParams(location.search).has(k));   // escondida na demonstração e na Simulação
const ERROS_CONVERSA = { 404: "Esta conversa não está disponível agora: a tarefa pode ter terminado.", 429: "Muitas leituras de conversa agora. Tente de novo em um minuto.",
  503: "O agentes.chat pediu uma pausa nas leituras. Tente de novo daqui a pouco.", 502: "O agentes.chat não respondeu agora. Tente de novo daqui a pouco." };
let pedidoConversa = 0;
function abrirConversa(b) {
  const c = $("conversa"), t = b.trabalho;
  const topo = elem("div", "conversa-topo"), nomes = elem("div");
  const volta = elem("button", "fechar", "←"); volta.type = "button"; volta.setAttribute("aria-label", "Voltar à ficha"); volta.addEventListener("click", () => fecharConversa(true));
  const h = elem("h2", null, "Conversa"); h.id = "conversa-titulo";
  nomes.append(h, elem("p", null, `${b.nome} · tarefa atual`));
  const x = elem("button", "fechar", "×"); x.type = "button"; x.setAttribute("aria-label", "Fechar a conversa"); x.addEventListener("click", () => { fecharFicha(); focoNoMapa(); });
  topo.append(volta, nomes, x);
  const aviso = elem("p", "conversa-estado"); aviso.setAttribute("role", "status");
  const lista = elem("ol", "conversa-lista"); lista.setAttribute("aria-label", "Mensagens, da mais antiga para a mais nova"); lista.tabIndex = 0;
  const pe = elem("div", "conversa-pe");
  const atualizar = elem("button", "botao fantasma", "Atualizar"); atualizar.type = "button"; atualizar.addEventListener("click", () => carregarConversa(b));
  const responder = elem("a", "botao", "Responder no agentes.chat"); responder.href = t.url; responder.target = "_blank"; responder.rel = "noopener";
  pe.append(atualizar, responder);
  c.replaceChildren(topo, aviso, lista, pe);
  $("ficha").hidden = true; c.hidden = false; c.focus({ preventScroll: true });
  carregarConversa(b);
}
function fecharConversa(voltar) {
  const c = $("conversa"); if (c.hidden) return;
  c.hidden = true; c.replaceChildren(); pedidoConversa++;   // uma leitura que ainda volte é descartada
  if (!voltar) return;
  if (boneco(selecionado)) { assinaturaFicha = ""; renderFicha(); $("ficha").hidden = false; ($("ficha").querySelector(".ver-conversa") || $("ficha")).focus(); }
  else focoNoMapa();   // o agente saiu da leitura enquanto a conversa estava aberta
}
function focoNoMapa() { tela.focus(); }
async function carregarConversa(b) {
  const n = ++pedidoConversa, c = $("conversa"), aviso = c.querySelector(".conversa-estado"), lista = c.querySelector(".conversa-lista"), bt = c.querySelector(".conversa-pe button");
  aviso.className = "conversa-estado"; aviso.textContent = "Carregando a conversa…"; lista.setAttribute("aria-busy", "true"); bt.disabled = true;
  let r = null, d = null;
  try { r = await fetch(Andar.com(`api/conversa?agente=${encodeURIComponent(b.id)}`), { cache: "no-store", credentials: "same-origin" }); d = await r.json().catch(() => null); }
  catch (e) { r = null; }
  if (n !== pedidoConversa) return;   // fechou ou pediu de novo enquanto esperava
  lista.removeAttribute("aria-busy"); bt.disabled = false;
  if (r && r.status === 401) { location.href = "/entrar"; return; }
  if (!r || !r.ok || !d || !Array.isArray(d.mensagens)) {
    const doServidor = d && typeof d.erro === "string" && d.erro.length <= 200 ? d.erro.charAt(0).toUpperCase() + d.erro.slice(1).replace(/\.?$/, ".") : "";
    aviso.className = "conversa-estado ruim"; aviso.textContent = doServidor || (r && ERROS_CONVERSA[r.status]) || "Não deu para ler a conversa agora. Tente de novo.";
    return;   // o que já estava na lista fica à vista
  }
  lista.replaceChildren(...d.mensagens.map(itemMensagem));
  const q = d.mensagens.length, lida = typeof d.atualizado === "string" && !isNaN(Date.parse(d.atualizado)) ? ` · lida às ${horaDe(d.atualizado)}` : "";
  aviso.textContent = q ? `${q} ${q === 1 ? "mensagem" : "mensagens"}${lida}` : "Ainda não há mensagens nesta conversa.";
  lista.scrollTop = lista.scrollHeight;   // a mais nova fica embaixo, à vista
}

// uma mensagem (ficha e página Conversas): texto puro, sempre por textContent
function itemMensagem(m) {
  const agente = m.autor === "agente", li = elem("li", `msg ${agente ? "de-agente" : "de-pessoa"}`), cab = elem("div", "msg-cabeca");
  cab.append(elem("strong", null, agente ? (typeof m.nome === "string" && m.nome ? m.nome : "Agente") : "Pessoa"));
  if (typeof m.hora === "string" && !isNaN(Date.parse(m.hora))) { const tm = elem("time", null, horaDe(m.hora)); tm.dateTime = m.hora; cab.append(tm); }
  const texto = typeof m.texto === "string" ? m.texto : "";
  li.append(cab, elem("p", texto ? "msg-texto" : "msg-texto vazio", texto || "sem texto: cartão ou anexo; veja no agentes.chat"));
  if (m.cortado === true) li.append(elem("p", "msg-nota", "Mensagem cortada; a inteira está no agentes.chat."));
  const anexos = Number.isInteger(m.anexos) && m.anexos > 0 ? m.anexos : 0;
  if (anexos) li.append(elem("p", "msg-nota", anexos === 1 ? "1 anexo, só no agentes.chat" : `${anexos} anexos, só no agentes.chat`));
  return li;
}

// ---------- página Conversas (contrato P) ---------------------------------------------
// A lista do dia vem pronta no /api/estado.conversas: ordenada, 7 campos, sem url nem canal. A conversa abre pelo id
// estável (GET /api/conversa?id=) e só é relida quando o item muda (run_id, status ou fim) com a página à vista, ou
// no "Atualizar": cada leitura conta no teto de 200 por dia, dividido com a ficha. Sem timer próprio.
const GRUPOS_CONV = [["Esperando você", s => /^waiting_/.test(s), "Ninguém esperando você agora."],
  ["Trabalhando", s => s === "running" || s === "still_running", "Ninguém trabalhando agora."],
  ["Terminadas hoje", s => s === "terminou", "Nenhuma tarefa terminou hoje."]];
const LED_CONV = { waiting_approval: "aprovacao", waiting_input: "pergunta", running: "trabalhando", still_running: "trabalhando", terminou: "fora" };
let convAberta = null, convLida = "", convDesenho = "", pedidoConv = 0;   // id aberto; versão do item na última leitura pedida; lista desenhada
const itensConv = () => (estado && Array.isArray(estado.conversas) ? estado.conversas.filter(i => i && typeof i.id === "string") : []);
const versaoConv = it => `${it.run_id}|${it.status}|${it.terminou_em}`;
const nomeConv = it => { const b = boneco(it.agente_id); return b ? b.nome : ((estado.agentes || []).find(a => a.id === it.agente_id) || {}).nome || "Agente"; };
const rotuloConv = it => (typeof it.rotulo === "string" && it.rotulo) || "Tarefa sem título";
const celularConv = () => matchMedia("(max-width: 760px)").matches;
function situacaoConv(it) {
  const desde = horaDe(it.desde), ate = horaDe(it.terminou_em);
  if (it.status === "terminou") return `Terminou${ate ? ` às ${ate}` : ""}${desde ? ` · começou às ${desde}` : ""}`;
  const t = { waiting_approval: "Esperando sua aprovação", waiting_input: "Esperando sua resposta", still_running: "Trabalhando há um tempo" }[it.status] || "Trabalhando";
  return desde ? `${t} · desde ${desde}` : t;
}
function fotoConv(it) {
  const b = boneco(it.agente_id);
  if (b) return mini(b.ap);
  const v = elem("span", "mini"); v.setAttribute("aria-hidden", "true"); return v;
}

// chamada a cada leitura do estado, ao entrar na tela e quando a aba volta a ficar visível
function paginaConversas() {
  const ligada = conversaLigada(), pronta = ligada && !!estado, itens = pronta ? itensConv() : [];
  $("conv-breve").hidden = ligada;   // desligada, demonstração e Simulação: o "em breve" de antes
  $("conv-reconectar").hidden = !(ligada && config.conversas === "responder" && config.pode_responder === false && !config.previa);   // a prévia nunca tem escrita
  $("conv-pagina").hidden = !itens.length; $("conv-vazio").hidden = !pronta || itens.length > 0;
  const n = f => itens.filter(i => f(i.status)).length, term = n(GRUPOS_CONV[2][1]);
  textoSe($("conv-resumo"), !ligada ? "Ler e responder os agentes por aqui ainda não está disponível." : !pronta ? "Carregando as conversas…"
    : !itens.length ? "Hoje · nenhuma conversa ainda"
    : `Hoje · ${n(GRUPOS_CONV[0][1])} esperando você · ${n(GRUPOS_CONV[1][1])} trabalhando · ${term} ${term === 1 ? "terminada" : "terminadas"}`);
  if (!pronta) return;
  // a lista só é refeita quando algo nela muda (o foco no item continua no lugar)
  const desenho = itens.map(i => `${i.id}|${versaoConv(i)}|${i.rotulo}|${i.desde}|${nomeConv(i)}`).join("\n") + `|${convAberta}`;
  if (desenho !== convDesenho) { convDesenho = desenho; desenharListaConv(itens); }
  if (!convAberta) { if (!$("conv-aberta").childElementCount) escolhaConv(); return; }
  const it = itens.find(i => i.id === convAberta);
  if (!it) { fecharConvPagina("Essa conversa saiu da lista de hoje (a lista recomeça à meia-noite e quando o serviço reinicia)."); return; }
  const st = $("conv-aberta").querySelector(".cp-status"); if (st) textoSe(st, situacaoConv(it));
  pintarCaixa(it);
  // o item mudou (tarefa nova, outro status, terminou): relê, mas só com a página à vista. A conversa só é montada de
  // novo quando a estrutura muda (virou terminada ou voltou a viver); no resto, o cabeçalho acompanha e a lista atual
  // fica até a leitura nova dar certo (numa pausa, a última leitura continua à vista)
  if (versaoConv(it) !== convLida && !document.hidden && !$("v-conversas").hidden) {
    if ($("conv-aberta").dataset.fim !== String(it.status === "terminou")) remontarConvAberta(it); else ajustarConvAberta(it);
    carregarConvPagina(it);
  }
}

function desenharListaConv(itens) {
  const lista = $("conv-lista"), focado = lista.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  lista.replaceChildren(...GRUPOS_CONV.map(([titulo, filtro, vazio]) => {
    const sel = itens.filter(i => filtro(i.status)), g = elem("section", "cp-grupo"), h = elem("h2", null, titulo);
    h.append(elem("b", null, String(sel.length))); g.append(h);
    if (!sel.length) { g.append(elem("p", "cp-vazio-grupo", vazio)); return g; }
    const ul = elem("ul");
    for (const it of sel) {
      const b = elem("button", "cp-item"), f = elem("span", "cp-foto"), rot = elem("span", "cp-rot"), nome = nomeConv(it);
      b.type = "button"; b.dataset.id = it.id;
      if (it.id === convAberta) b.setAttribute("aria-current", "true");
      f.append(fotoConv(it), elem("i", `led ${LED_CONV[it.status] || "trabalhando"}`));
      if (it.status === "waiting_approval") rot.append(elem("b", "selo-tipo aprovacao", "Aprovação"));
      if (it.status === "waiting_input") rot.append(elem("b", "selo-tipo pergunta", "Pergunta"));
      rot.append(elem("span", null, rotuloConv(it)));
      const hora = it.status === "terminou" ? (it.terminou_em ? `até ${horaDe(it.terminou_em)}` : "") : horaDe(it.desde);
      b.append(f, elem("span", "cp-nome", nome), elem("span", "cp-hora", hora), rot);
      b.setAttribute("aria-label", `${nome}: ${rotuloConv(it)}. ${situacaoConv(it)}`);
      b.addEventListener("click", () => abrirConvPagina(it.id));
      const li = elem("li"); li.append(b); ul.append(li);
    }
    g.append(ul); return g;
  }));
  if (focado) { const b = lista.querySelector(`[data-id="${CSS.escape(focado)}"]`); if (b) b.focus({ preventScroll: true }); }
}
// setas para cima e para baixo andam pela lista (o Tab também)
$("conv-lista").addEventListener("keydown", ev => {
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
  const bs = [...$("conv-lista").querySelectorAll(".cp-item")], i = bs.indexOf(document.activeElement);
  if (i < 0) return;
  ev.preventDefault(); bs[Math.max(0, Math.min(bs.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)))].focus();
});

function telaConv(t) { $("conv-pagina").dataset.tela = $("v-conversas").dataset.tela = t; }   // celular: lista ou conversa
function escolhaConv(nota) { // nada aberto: no computador, o convite à direita (no celular, só a lista aparece)
  const e = elem("div", "cp-escolha"), ic = elem("span", "ic ic-grande"); ic.dataset.icone = "balao"; ic.setAttribute("aria-hidden", "true");
  e.append(ic, elem("h2", null, "Escolha uma conversa"), elem("p", null, nota || "As que esperam você ficam em cima. A lista é só de hoje e recomeça à meia-noite."));
  $("conv-aberta").replaceChildren(e); pintarIcones(e);
}
function abrirConvPagina(id) {
  const it = itensConv().find(i => i.id === id); if (!it) return;
  convAberta = id; telaConv("conversa");
  for (const b of $("conv-lista").querySelectorAll(".cp-item")) { if (b.dataset.id === id) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); }
  convDesenho = convDesenho.replace(/\|[^|]*$/, `|${id}`);   // a lista já está certa: não precisa refazer
  montarConvAberta(it); carregarConvPagina(it);
  const sec = $("conv-aberta");
  if (celularConv()) sec.scrollIntoView({ block: "start" });
  sec.focus({ preventScroll: true });
}
function fecharConvPagina(nota) {
  if (!convAberta) return;
  const id = convAberta; convAberta = null; convLida = ""; pedidoConv++;   // uma leitura que ainda volte é descartada
  telaConv("lista"); escolhaConv(nota);
  for (const b of $("conv-lista").querySelectorAll(".cp-item[aria-current]")) b.removeAttribute("aria-current");
  convDesenho = convDesenho.replace(/\|[^|]*$/, "|null");
  const b = $("conv-lista").querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (b && celularConv()) { b.scrollIntoView({ block: "center" }); b.focus({ preventScroll: true }); }   // volta ao item de onde saiu
}
function montarConvAberta(it) {
  const sec = $("conv-aberta"), fim = it.status === "terminou", nome = nomeConv(it);
  const topo = elem("div", "cp-topo"), v = elem("button", "cp-voltar", "←"), txt = elem("div"), h = elem("h2", null, `${nome} · ${rotuloConv(it)}`);
  v.type = "button"; v.setAttribute("aria-label", "Voltar às conversas"); v.addEventListener("click", () => fecharConvPagina());
  h.id = "conv-aberta-titulo"; txt.append(h, elem("p", "cp-status", situacaoConv(it)));
  topo.append(v, fotoConv(it), txt);
  const partes = [topo];
  if (fim) {
    const f = elem("p", "cp-fim"), t = elem("span"), ate = horaDe(it.terminou_em);
    t.append(elem("strong", null, `Tarefa terminada${ate ? ` às ${ate}` : ""}. `), "A conversa mostra só até o fim da tarefa; o que veio depois no canal não aparece aqui.");
    f.append(elem("i", "led fora"), t); partes.push(f);
  }
  const aviso = elem("p", "cp-aviso"); aviso.setAttribute("role", "status"); aviso.hidden = true;
  const est = elem("p", "conversa-estado"); est.setAttribute("role", "status");
  const lista = elem("ol", "conversa-lista"); lista.setAttribute("aria-label", "Mensagens, da mais antiga para a mais nova"); lista.tabIndex = 0;
  const pe = elem("div", "cp-pe");
  pe.append(caixaResposta(it));
  const ac = elem("div", "cp-acoes"), at = elem("button", "botao fantasma cp-atualizar", "Atualizar");
  at.type = "button"; at.addEventListener("click", () => {
    if (at.getAttribute("aria-disabled") === "true") return;   // carregando ou na pausa
    const i = itensConv().find(x => x.id === convAberta); if (i) carregarConvPagina(i);
  });
  const ext = elem("a", "botao secundario cp-externo", it.status === "waiting_approval" ? "Revisar no agentes.chat" : fim ? "Abrir no agentes.chat" : "Responder no agentes.chat");
  ext.target = "_blank"; ext.rel = "noopener"; ext.hidden = true;   // o link chega com a leitura (a lista não tem url)
  ac.append(at, ext); pe.append(ac);
  partes.push(aviso, est, lista, pe);
  sec.replaceChildren(...partes); sec.dataset.fim = String(fim); sec.dataset.run = "";
  pintarCaixa(it);
}
function remontarConvAberta(it) { // o foco que estava dentro da conversa volta para a peça equivalente (ou para a conversa)
  const sec = $("conv-aberta"), ativo = sec.contains(document.activeElement) ? document.activeElement : null;
  const classe = ativo && ["cp-atualizar", "cp-externo", "cp-voltar", "conversa-lista", "cp-texto", "cp-enviar"].find(c => ativo.classList.contains(c));
  const ta = sec.querySelector(".cp-texto"), rascunho = ta ? ta.value : "";   // o texto que estava sendo escrito não se perde
  montarConvAberta(it);
  if (rascunho) { sec.querySelector(".cp-texto").value = rascunho; contarResposta(); }
  if (ativo) (classe && sec.querySelector(`.${classe}:not([hidden]):not(:disabled)`) || sec).focus({ preventScroll: true });
}
function ajustarConvAberta(it) { // mesma estrutura: só o título, o status, a caixa e o rótulo do link
  const sec = $("conv-aberta"), h = sec.querySelector("#conv-aberta-titulo");
  if (h) textoSe(h, `${nomeConv(it)} · ${rotuloConv(it)}`);
  pintarCaixa(it);
}
async function carregarConvPagina(it) {
  const n = ++pedidoConv, sec = $("conv-aberta"), est = sec.querySelector(".conversa-estado"), aviso = sec.querySelector(".cp-aviso");
  const lista = sec.querySelector(".conversa-lista"), bt = sec.querySelector(".cp-atualizar"), ext = sec.querySelector(".cp-externo");
  if (!est) return;
  convLida = versaoConv(it);   // mesmo se falhar: a releitura automática só volta quando o item mudar de novo (orçamento)
  est.textContent = "Carregando a conversa…"; lista.setAttribute("aria-busy", "true"); bt.setAttribute("aria-disabled", "true");
  pintarCaixa(it);
  let r = null, d = null;
  try { r = await fetch(Andar.com(`api/conversa?id=${encodeURIComponent(it.id)}`), { cache: "no-store", credentials: "same-origin" }); d = await r.json().catch(() => null); }
  catch (e) { r = null; }
  if (n !== pedidoConv) return;   // fechou ou pediu de novo enquanto esperava
  lista.removeAttribute("aria-busy"); bt.removeAttribute("aria-disabled");
  const atual = itensConv().find(x => x.id === it.id) || it;
  if (r && r.status === 401) { if (!sec.querySelector(".cp-texto").value) location.href = "/entrar"; else avisoEnvio("ruim", "Sua sessão acabou. Copie o texto e entre de novo."); return; }   // com rascunho, não some com ele
  const tinha = lista.childElementCount > 0;
  if (!r || !r.ok || !d || !Array.isArray(d.mensagens)) {
    const doServidor = d && typeof d.erro === "string" && d.erro.length <= 200 ? d.erro.charAt(0).toUpperCase() + d.erro.slice(1).replace(/\.?$/, ".") : "";
    const pausa = !!r && (r.status === 503 || r.status === 429), dia = pausa && r.status === 429 && /hoje/i.test(doServidor);
    aviso.hidden = false; aviso.className = `cp-aviso${dia ? " neutro" : pausa ? "" : " ruim"}`;   // pausa: âmbar; teto do dia: neutro
    aviso.textContent = (doServidor || (r && ERROS_CONVERSA[r.status]) || "Não deu para ler a conversa agora. Tente de novo.")
      + (tinha ? " A conversa abaixo é a última leitura." : "") + (dia ? " Dá para ler no agentes.chat." : "");
    est.textContent = tinha ? est.dataset.ultima || "" : "";
    if (pausa) { bt.setAttribute("aria-disabled", "true"); setTimeout(() => { if (n === pedidoConv) bt.removeAttribute("aria-disabled"); }, 60000); }   // espera antes de pedir de novo
    pintarCaixa(atual);
    return;   // o que já estava na lista fica à vista
  }
  aviso.hidden = true;
  if (typeof d.url === "string" && /^https:\/\//.test(d.url)) { ext.href = d.url; ext.hidden = false; }
  sec.dataset.run = it.run_id;   // o envio leva o run_id da conversa que está à vista
  pintarCaixa(atual);
  const ta = sec.querySelector(".cp-texto");
  if (sec.dataset.focarTexto && !ta.disabled && (document.activeElement === sec || document.activeElement === document.body)) ta.focus({ preventScroll: true });
  delete sec.dataset.focarTexto;
  const fim = d.ate != null, itens = d.mensagens.map(itemMensagem);   // ate: terminada, já cortada no fim da tarefa (A1)
  if (fim && itens.length) { const ate = horaDe(it.terminou_em); itens.push(elem("li", "cp-corte", `Fim da tarefa${ate ? ` · ${ate}` : ""}`)); }
  lista.replaceChildren(...itens);
  const q = d.mensagens.length, lida = typeof d.atualizado === "string" && !isNaN(Date.parse(d.atualizado)) ? ` · lida às ${horaDe(d.atualizado)}` : "";
  est.textContent = est.dataset.ultima = q ? `${q} ${q === 1 ? "mensagem" : "mensagens"}${lida}`
    : fim ? "As mensagens desta tarefa já saíram das 20 mais recentes do canal; veja no agentes.chat." : "Ainda não há mensagens nesta conversa.";
  lista.scrollTop = lista.scrollHeight;   // a mais nova fica embaixo, à vista
}
// a aba voltou a ficar visível: se o item aberto mudou enquanto ela estava escondida, relê agora
// a aba voltou (o navegador segura o setInterval de aba escondida): relê já, e um pedido respondido em outro aparelho sai
document.addEventListener("visibilitychange", () => { if (!document.hidden) buscar(); });

// ---------- resposta pela página Conversas (fase R) -------------------------------------
// O modo resposta vive no servidor (1 h renovada a cada envio, teto de 8 h, só nesta sessão do navegador): o navegador só
// mostra o tempo que o /api/estado manda e a contagem local preenche os 10 s entre as leituras. A senha abre o modo e
// nunca é guardada. Uma caixa só, na página; a ficha leva até ela. Os erros das rotas novas vêm como {erro, mensagem}.
const RESPOSTA_MAX = 2000;   // depois da limpeza do servidor; o corpo do POST vai até 8 KB
const respostaLigada = () => conversaLigada() && config.conversas === "responder" && config.pode_responder === true;
let modoAte = 0, modoMudou = 0;   // performance.now() em que o modo fecha (0: fechado); quando ele mudou aqui por último
function modoDoServidor(m, pedido) {
  if (pedido < modoMudou) return;   // leitura pedida antes de abrir ou fechar aqui: já está velha
  const resta = m && Number.isFinite(m.resta_s) && Number.isFinite(m.teto_s) ? Math.min(m.resta_s, m.teto_s) : 0;
  modoAte = resta > 0 ? performance.now() + resta * 1000 : 0;
  pintarSelo();
}
const modoAberto = () => modoAte > performance.now();
function pintarSelo() {
  const s = $("modo-resposta"), resta = modoAte - performance.now(), aberto = resta > 0 && respostaLigada();
  if (!aberto && !s.hidden && s.contains(document.activeElement)) $("principal").focus({ preventScroll: true });   // o foco não cai no body
  s.hidden = !aberto; document.body.classList.toggle("modo-aberto", aberto);   // celular: a conversa aberta desconta o selo
  if (aberto) textoSe($("modo-tempo"), resta < 60000 ? "fecha em menos de 1 min" : `fecha em ${Math.floor(resta / 60000)} min`);
}
setInterval(pintarSelo, 1000);
$("modo-fechar").addEventListener("click", async () => {
  const bt = $("modo-fechar");
  if (bt.getAttribute("aria-disabled") === "true") return;
  bt.setAttribute("aria-disabled", "true");
  const r = await postarResposta("api/conversa/modo/fechar", {});
  bt.removeAttribute("aria-disabled");
  if (r.status !== 200) { $("modo-anuncio").textContent = r.status === 401 ? "Sua sessão acabou; o modo resposta já está fechado." : "Não deu para fechar o modo agora. Tente de novo."; if (r.status !== 401) return; }
  else $("modo-anuncio").textContent = "Modo resposta fechado. O próximo envio pede a senha.";
  modoMudou = performance.now(); modoAte = 0;
  const ta = $("conv-aberta").querySelector(".cp-texto");
  if (ta && !ta.disabled && !$("v-conversas").hidden) ta.focus({ preventScroll: true }); else $("principal").focus({ preventScroll: true });
  pintarSelo();
});

async function postarResposta(url, corpo) {   // POST same-origin com JSON exato (o navegador manda o Origin); status 0: sem conexão
  try {
    const r = await fetch(Andar.com(url), { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    return { status: r.status, d: await r.json().catch(() => null) };
  } catch (e) { return { status: 0, d: null }; }
}
const mensagemDe = (r, padrao) => (r.d && typeof r.d.mensagem === "string" && r.d.mensagem && r.d.mensagem.length <= 300 ? r.d.mensagem.charAt(0).toUpperCase() + r.d.mensagem.slice(1).replace(/\.?$/, ".") : padrao);
function chaveEnvio() {   // uma nova por mensagem (vira a idempotency_key no servidor)
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;   // uuid4 fora de contexto seguro
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// diálogo da senha: resolve true quando o servidor abriu o modo; o campo é limpo logo depois de ler
let senhaFim = null;
function pedirSenha() {
  const d = $("dlg-senha");
  if (!d.showModal) return Promise.resolve(false);
  if (senhaFim) return Promise.resolve(false);   // já está aberto
  $("senha-aviso").textContent = ""; $("senha-campo").value = ""; $("senha-usuario").value = (estado && estado.usuario) || "";
  d.showModal(); $("senha-campo").focus();
  return new Promise(res => { senhaFim = res; });
}
function fecharSenha(ok) {
  const f = senhaFim; senhaFim = null;
  $("senha-campo").value = "";
  if ($("dlg-senha").open) $("dlg-senha").close();
  if (f) f(ok);
}
$("dlg-senha").addEventListener("close", () => fecharSenha(false));   // Esc (cancel do próprio <dialog>)
$("senha-cancelar").addEventListener("click", () => fecharSenha(false));
$("form-senha").addEventListener("submit", async ev => {
  ev.preventDefault();
  const campo = $("senha-campo"), bt = $("senha-abrir"), aviso = $("senha-aviso"), senha = campo.value;
  if (bt.getAttribute("aria-disabled") === "true") return;
  campo.value = "";
  if (!senha) { aviso.textContent = "Digite a senha do escritório."; campo.focus(); return; }
  bt.setAttribute("aria-disabled", "true"); bt.textContent = "Abrindo…"; aviso.textContent = "";
  const r = await postarResposta("api/conversa/modo", { senha });
  bt.removeAttribute("aria-disabled"); bt.textContent = "Abrir e enviar";
  if (r.status === 200 && r.d) { modoMudou = performance.now(); modoDoServidor(r.d, modoMudou); fecharSenha(true); return; }
  const erro = r.d && r.d.erro;
  aviso.textContent = r.status === 401 ? "Sua sessão acabou. Copie o texto, recarregue a página e entre de novo."
    : r.status === 0 ? "Sem conexão com o escritório. Tente de novo."
    : erro === "senha_incorreta" ? `${mensagemDe(r, "Senha incorreta.")} Depois de 8 erros em 15 minutos, o modo e o login travam por um tempo.`
    : mensagemDe(r, erro === "tentativas_demais" ? "Muitas tentativas erradas. Espere uns 15 minutos e tente de novo."
      : erro === "responder_desligado" ? "Responder por aqui está desligado neste escritório." : "Não deu para abrir o modo resposta. Tente de novo.");
  campo.focus();
});

// a caixa de cada conversa aberta: sempre no lugar; desabilitada, diz o porquê
function caixaResposta(it) {
  const nome = nomeConv(it), c = elem("div", "cp-caixa");
  const envio = elem("p", "cp-envio"); envio.setAttribute("role", "status"); envio.hidden = true;
  const aviso = elem("p", "cp-nota cp-aviso-envio", "Sai no agentes.chat como a conta conectada, marcada “via Escritório dos agentes”. Aprovar é só no agentes.chat. Mensagens de agentes podem pedir coisas: confira antes de responder.");
  const r = elem("div", "cp-resposta"), rot = elem("label", "oculto", `Mensagem para ${nome}`), ta = elem("textarea", "cp-texto");
  const env = elem("button", "botao cp-enviar", "Enviar");
  ta.id = "cp-texto"; rot.htmlFor = "cp-texto"; ta.rows = 1; ta.maxLength = RESPOSTA_MAX; ta.setAttribute("aria-describedby", "cp-motivo cp-dica cp-contador");
  env.type = "button";
  const linha = elem("div", "cp-linha"), dica = elem("span", "cp-dica"), cont = elem("span", "cp-contador");
  dica.id = "cp-dica"; cont.id = "cp-contador";
  const motivo = elem("p", "cp-motivo"); motivo.id = "cp-motivo";
  linha.append(dica, cont); r.append(rot, ta, env);
  ta.addEventListener("input", () => { contarResposta(); crescerTexto(ta); });
  ta.addEventListener("keydown", ev => {
    if (ev.key !== "Enter" || ev.isComposing || ev.shiftKey || ev.altKey) return;
    if (ev.ctrlKey || ev.metaKey || !toqueConv()) { ev.preventDefault(); enviarResposta(); }   // no toque, Enter quebra a linha
  });
  env.addEventListener("click", enviarResposta);
  c.append(envio, aviso, r, linha, motivo);
  return c;
}
const toqueConv = () => matchMedia("(pointer: coarse)").matches;
function crescerTexto(ta) { ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight + 2, 160)}px`; }
function contarResposta() {
  const ta = $("conv-aberta").querySelector(".cp-texto"), c = $("conv-aberta").querySelector(".cp-contador");
  if (!ta || !c) return;
  const n = ta.value.length;
  textoSe(c, `${n.toLocaleString("pt-BR")} / ${RESPOSTA_MAX.toLocaleString("pt-BR")}`);
  c.classList.toggle("perto", n > RESPOSTA_MAX - 200);
}
function motivoCaixa(it, sec) { // "" quando dá para enviar
  if (!respostaLigada()) return config.conversas === "responder" ? "Responder por aqui não está disponível agora (a conexão com o agentes.chat é só de leitura). Use o agentes.chat."
    : "Responder por aqui está desligado neste escritório. Use o agentes.chat.";
  if (it.status === "waiting_approval") return "Pedido de aprovação: revise no agentes.chat.";
  if (it.status === "running" || it.status === "still_running") return "Espere o agente terminar para responder, ou mande no agentes.chat.";
  if (it.responder !== true) return "Esta conversa só recebe mensagens no agentes.chat (por enquanto, só as conversas diretas aceitam resposta por aqui).";
  if (sec.dataset.run !== it.run_id) return sec.querySelector(".conversa-lista[aria-busy]") ? "Carregando a conversa…" : "A conversa mudou. Atualize para responder.";
  return "";
}
function pintarCaixa(it) {
  const sec = $("conv-aberta"), ta = sec.querySelector(".cp-texto");
  if (!ta) return;
  const motivo = motivoCaixa(it, sec), pode = !motivo, enviando = sec.dataset.enviando === "1";
  const env = sec.querySelector(".cp-enviar"), ext = sec.querySelector(".cp-externo"), dica = sec.querySelector(".cp-dica");
  if (!pode && !enviando && document.activeElement === ta) sec.focus({ preventScroll: true });   // a caixa vai desabilitar: o foco não cai no body
  if (!enviando) { ta.disabled = !pode; env.disabled = !pode; }
  ta.placeholder = pode ? `Escreva para ${nomeConv(it)}…` : "Indisponível nesta conversa";   // o motivo inteiro fica logo abaixo
  textoSe(sec.querySelector(".cp-motivo"), motivo); sec.querySelector(".cp-motivo").hidden = pode;
  sec.querySelector(".cp-aviso-envio").hidden = sec.querySelector(".cp-linha").hidden = !pode;
  textoSe(dica, toqueConv() ? "Toque em Enviar para mandar" : "Enter envia · Shift+Enter quebra a linha");
  contarResposta();
  if (ext) textoSe(ext, pode ? "Mandar imagem ou arquivo no agentes.chat" : it.status === "waiting_approval" ? "Revisar no agentes.chat" : it.status === "terminou" ? "Abrir no agentes.chat" : "Responder no agentes.chat");
}
function avisoEnvio(tipo, texto, link) { // link: "Abrir no agentes.chat" na thread, quando o envio só pode sair por lá
  const p = $("conv-aberta").querySelector(".cp-envio"); if (!p) return;
  p.className = `cp-envio ${tipo}`; p.textContent = texto; p.hidden = !texto;
  if (link) { const a = elem("a", null, "Abrir no agentes.chat"); a.href = link; a.target = "_blank"; a.rel = "noopener"; p.append(" ", a); }
}
const ERROS_ENVIO = { 400: "A mensagem não foi aceita. Confira o texto (de 1 a 2.000 caracteres) e tente de novo.",
  403: "Responder por aqui está desligado neste escritório.", 404: "Essa conversa saiu da lista de hoje. Mande no agentes.chat.",
  409: "A conversa mudou desde que você abriu. Atualize para ver o estado atual.", 429: "Limite de envios: até 5 por minuto e 50 por dia. Tente de novo daqui a pouco.",
  503: "O agentes.chat pediu uma pausa nos envios. Tente de novo em alguns minutos.", 502: "O agentes.chat não confirmou o envio; ela pode ter saído. Confira a conversa antes de mandar de novo.",
  0: "Sem resposta do escritório; a mensagem pode ter saído. Confira a conversa antes de mandar de novo." };
// a última tentativa sem 200: o mesmo envio (mesmo item, run_id e texto) repete a chave, para um 502 ou uma queda de
// conexão seguidos de um novo clique não duplicarem a mensagem; chave nova só depois de um 200 ou com outro texto ou item
let tentativaResp = null;
async function enviarResposta() {
  const sec = $("conv-aberta"), ta = sec.querySelector(".cp-texto"), env = sec.querySelector(".cp-enviar");
  const it = itensConv().find(x => x.id === convAberta);
  if (!ta || !it || sec.dataset.enviando === "1" || ta.disabled) return;   // sem envio duplo
  const texto = ta.value.trim();
  if (!texto) { avisoEnvio("ruim", "Escreva a mensagem antes de enviar."); ta.focus(); return; }
  if (!modoAberto() && !(await pedirSenha())) { ta.focus(); return; }   // cancelou a senha: o texto fica
  const t = tentativaResp, mesmo = t && t.id === it.id && t.run_id === sec.dataset.run && t.texto === texto;
  const corpo = { id: it.id, run_id: sec.dataset.run, texto, chave: mesmo ? t.chave : chaveEnvio() };
  tentativaResp = { ...corpo };
  const ocupado = sim => {
    sec.dataset.enviando = sim ? "1" : ""; ta.readOnly = sim; textoSe(env, sim ? "Enviando…" : "Enviar");
    if (sim) env.setAttribute("aria-disabled", "true"); else env.removeAttribute("aria-disabled");   // aria-disabled: o foco fica no botão
  };
  ocupado(true); avisoEnvio("", "");
  let r = await postarResposta("api/conversa/responder", corpo);
  if (r.status === 403 && r.d && r.d.erro === "modo_fechado") { // o modo venceu no servidor: senha de novo e o MESMO envio, com a mesma chave
    modoMudou = performance.now(); modoAte = 0; pintarSelo();
    ocupado(false);
    if (!(await pedirSenha())) { avisoEnvio("neutro", "O modo resposta fechou. A mensagem não saiu; ela continua na caixa."); ta.focus(); return; }
    ocupado(true);
    r = await postarResposta("api/conversa/responder", corpo);
  }
  if (r.status === 200) tentativaResp = null;
  if (convAberta !== it.id) return;   // saiu da conversa enquanto enviava: a caixa é outra
  ocupado(false);
  if (r.status === 200) {
    if (r.d) { modoMudou = performance.now(); modoDoServidor(r.d, modoMudou); }
    ta.value = ""; crescerTexto(ta); contarResposta();
    avisoEnvio("ok", `Mensagem enviada às ${horaDe(new Date().toISOString())}. Para ver a resposta, use Atualizar (ou abra no agentes.chat).`);
    buscar();   // o servidor já tirou o pedido de "Esperando você": o painel e o mapa acompanham sem esperar os 10 s
    ta.focus({ preventScroll: true });
    const reler = () => { const atual = itensConv().find(x => x.id === it.id); if (atual && convAberta === it.id) carregarConvPagina(atual); };
    reler();
    setTimeout(() => { if (!document.hidden && !$("v-conversas").hidden) reler(); }, 20000);   // uma releitura a mais por envio (teto do dia: 50 envios)
    return;
  }
  if (r.status === 401) { avisoEnvio("ruim", "Sua sessão acabou. Copie o texto e entre de novo; a mensagem não saiu."); return; }
  const erro = r.d && r.d.erro;
  if (erro === "modo_fechado") { modoMudou = performance.now(); modoAte = 0; pintarSelo(); }
  const neutro = r.status === 429 || r.status === 503;
  const ext = $("conv-aberta").querySelector(".cp-externo"), soLa = erro === "sem_thread" || erro === "tipo_nao_liberado";   // T1: canal só no agentes.chat
  avisoEnvio(neutro || soLa ? "neutro" : "ruim", mensagemDe(r, soLa ? "Mande esta no agentes.chat." : ERROS_ENVIO[r.status] || "A mensagem não saiu. Tente de novo."),
    soLa && ext && !ext.hidden ? ext.href : "");
  if (r.status === 409 || r.status === 404) buscar();   // o estado novo ajusta a caixa (e o motivo, se ela fechar)
  ta.focus({ preventScroll: true });
}
// ficha do agente: o item de hoje que aceita resposta (o da tarefa atual; sem tarefa, o último terminado)
function itemParaResponder(b) {
  if (!respostaLigada()) return null;
  const t = b.trabalho;
  return itensConv().find(i => i.agente_id === b.id && i.responder === true && (!t || i.run_id === t.run_id)) || null;
}
function irParaResposta(id) {
  fecharFicha();
  if (location.hash !== "#conversas") { location.hash = "#conversas"; rota(); }
  if (convAberta !== id) abrirConvPagina(id);
  const sec = $("conv-aberta"), ta = sec.querySelector(".cp-texto");
  if (ta && !ta.disabled) ta.focus({ preventScroll: true }); else { sec.dataset.focarTexto = "1"; sec.focus({ preventScroll: true }); }   // abre o texto quando a leitura chegar
}

// ---------- busca por nome -----------------------------------------------------------
let buscaIds = null, buscaAtivo = -1;
const normalizar = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function resultadosBusca(q) {
  if (!mundo || !q) return [];
  const n = normalizar(q);
  return [...mundo.bonecos.values()].filter(b => normalizar(`${b.nome} ${b.handle} ${b.funcao}`).includes(n))
    .sort((a, b) => (normalizar(a.nome).startsWith(n) ? 0 : 1) - (normalizar(b.nome).startsWith(n) ? 0 : 1) || a.nome.localeCompare(b.nome)).slice(0, 8);
}
function desenharBusca() {
  const inp = $("busca"), lista = $("busca-lista"), q = inp.value.trim(), rs = resultadosBusca(q);
  buscaIds = q ? new Set(rs.map(b => b.id)) : null;       // no mapa, quem não bate fica apagado
  if (!q) { lista.hidden = true; inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); return; }
  buscaAtivo = Math.min(Math.max(buscaAtivo, 0), rs.length - 1);
  lista.replaceChildren(...rs.map((b, i) => {
    const li = elem("li"); li.id = `busca-op-${i}`; li.setAttribute("role", "option"); li.setAttribute("aria-selected", String(i === buscaAtivo));
    const txt = elem("span", "txt"), nome = elem("strong");
    const k = normalizar(b.nome).indexOf(normalizar(q));
    if (k >= 0) nome.append(b.nome.slice(0, k), elem("mark", null, b.nome.slice(k, k + q.length)), b.nome.slice(k + q.length)); else nome.textContent = b.nome;
    txt.append(nome, elem("span", null, `${textoEstado(b)} · ${ondeEsta(b)}`));
    li.append(mini(b.ap), txt);
    li.addEventListener("pointerdown", ev => ev.preventDefault());   // não tira o foco do campo antes do clique
    li.addEventListener("click", () => escolherBusca(b));
    return li;
  }));
  if (!rs.length) { const li = elem("li", "vazio", `Ninguém com “${q}”.`); li.setAttribute("role", "option"); li.setAttribute("aria-disabled", "true"); lista.append(li); }
  lista.hidden = false; inp.setAttribute("aria-expanded", "true");
  if (rs.length) inp.setAttribute("aria-activedescendant", `busca-op-${buscaAtivo}`); else inp.removeAttribute("aria-activedescendant");
}
function escolherBusca(b) {
  $("busca").value = ""; buscaIds = null; desenharBusca();
  irParaEscritorio();
  focarAgente(b, { seguir: true, foco: true });
}
$("busca").addEventListener("input", () => { buscaAtivo = 0; desenharBusca(); });
$("busca").addEventListener("keydown", ev => {
  const rs = resultadosBusca($("busca").value.trim());
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); if (rs.length) { buscaAtivo = (buscaAtivo + (ev.key === "ArrowDown" ? 1 : rs.length - 1)) % rs.length; desenharBusca(); } }
  else if (ev.key === "Enter" && rs[buscaAtivo]) { ev.preventDefault(); escolherBusca(rs[buscaAtivo]); }
  else if (ev.key === "Escape" && $("busca").value) { ev.stopPropagation(); $("busca").value = ""; desenharBusca(); }   // vazio: o Esc segue e fecha a gaveta
});
$("busca").addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== $("busca")) { $("busca-lista").hidden = true; $("busca").setAttribute("aria-expanded", "false"); } }, 120));
$("busca").addEventListener("focus", () => { if ($("busca").value.trim()) desenharBusca(); });

// ---------- acontecendo agora (eventos) ---------------------------------------------
// O servidor manda eventos[] com horário. Sem eles (versão antiga), deduzimos pela diferença entre leituras.
const FRASES_EVENTO = { comecou: "começou uma tarefa", pediu_aprovacao: "pediu a sua aprovação", pediu_resposta: "fez uma pergunta", voltou_a_trabalhar: "voltou a trabalhar", terminou: "terminou uma tarefa" };
let eventosLocais = [], statusAnterior = null;
const vistosEvento = new Set();
function deduzirEventos(e) {
  const agora = new Map((e.trabalhos || []).map(t => [t.agente_id, t.status]));
  const handle = id => ((e.agentes || []).find(a => a.id === id) || {}).handle;
  if (statusAnterior) for (const id of new Set([...agora.keys(), ...statusAnterior.keys()])) {
    const a = statusAnterior.get(id), d = agora.get(id); if (a === d || (/running/.test(a) && /running/.test(d))) continue;
    const tipo = !d ? "terminou" : d === "waiting_approval" ? "pediu_aprovacao" : d === "waiting_input" ? "pediu_resposta" : a ? "voltou_a_trabalhar" : "comecou";
    eventosLocais.unshift({ em: e.atualizado || new Date().toISOString(), tipo, agente: handle(id) });
  }
  statusAnterior = agora; eventosLocais = eventosLocais.slice(0, 50);
  return eventosLocais;
}
const eventosDe = e => (Array.isArray(e.eventos) ? e.eventos : deduzirEventos(e));
// ---------- aprovações: esperando você, resolvidos hoje e todos (busca e abas) ---------
// "resolvidos" vem do diário do servidor (só hoje, em memória). Sem ele (demonstração ou servidor antigo),
// deduzimos pela troca de estado de cada agente entre leituras.
const DESFECHOS = { voltou_a_trabalhar: ["Voltou a trabalhar", "ok"], terminou: ["Terminou", "ok"], outro_pedido: ["Pediu outra coisa", "info"] };
const FMT_DIA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
let resolvidosLocais = [], pedidosAnteriores = null;
function deduzirResolvidos(e) {
  const handle = id => ((e.agentes || []).find(a => a.id === id) || {}).handle;
  const agora = new Map((e.trabalhos || []).map(t => [t.agente_id, t]));
  if (pedidosAnteriores) for (const [id, p] of pedidosAnteriores) {
    const t = agora.get(id); if (t && t.status === p.status) continue;
    const desfecho = !t ? "terminou" : /^waiting_/.test(t.status) ? "outro_pedido" : "voltou_a_trabalhar";
    resolvidosLocais.unshift({ run_id: p.run_id || id, agente: handle(id), tipo: p.status === "waiting_input" ? "pergunta" : "aprovacao", rotulo: p.rotulo || "",
      pediu_em: desdeDe(p), resolvido_em: e.atualizado || new Date().toISOString(), desfecho, desde_inicio: false });
  }
  pedidosAnteriores = new Map([...agora].filter(([, t]) => /^waiting_/.test(t.status)));
  resolvidosLocais = resolvidosLocais.slice(0, 50);
  return resolvidosLocais;
}
let resolvidosDaLeitura = null, leituraDosResolvidos = null;
function resolvidosHoje() {   // da leitura atual (a dedução roda uma vez por leitura) e só os de hoje em São Paulo
  if (leituraDosResolvidos !== estado) { leituraDosResolvidos = estado; resolvidosDaLeitura = Array.isArray(estado.resolvidos) ? estado.resolvidos : deduzirResolvidos(estado); }
  const hoje = FMT_DIA.format(new Date());
  // item com data inválida fica de fora (nunca derruba o painel); agente que saiu da organização também, como no "Acontecendo agora"
  return resolvidosDaLeitura.filter(r => { const em = r && Date.parse(r.resolvido_em); return Number.isFinite(em) && Object.hasOwn(DESFECHOS, r.desfecho) && porHandle(r.agente) && FMT_DIA.format(new Date(em)) === hoje; });
}
function duracao(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`;
}
function metaPedido(meta) {   // "Dev · esperando há 6 min, desde 10:24" (o tempo anda sem refazer a linha)
  const d = meta.dataset.desde, ha = tempoDesde(d);
  textoSe(meta, `${meta.dataset.sala ? meta.dataset.sala + " · " : ""}esperando ${ha === "agora" ? "agora" : ha}${d ? `, desde ${horaDe(d)}` : ""}`);
}
function linhaResolvido(r) {
  const b = porHandle(r.agente), nome = b ? b.nome : r.agente || "Agente", sala = salaDoAgente(r.agente);
  const [texto, tom] = DESFECHOS[r.desfecho], li = elem("li"), linha = elem(b ? "button" : "div", "linha-resolvido");
  const ms = Date.parse(r.resolvido_em) - Date.parse(r.pediu_em), espera = Number.isFinite(ms) ? ` · esperou ${r.desde_inicio ? "pelo menos " : ""}${duracao(ms)}` : "";
  const txt = elem("span", "txt");
  txt.append(elem("strong", null, `${nome} · ${r.rotulo || "Pedido sem descrição"}`),
    elem("span", "sub", `${sala ? sala + " · " : ""}${r.tipo === "pergunta" ? "pergunta" : "aprovação"}${espera} · hoje ${horaDe(r.resolvido_em)}`));
  const selo = elem("span", `selo-desfecho ${tom}`), ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), p = document.createElementNS(ns, "path");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  p.setAttribute("d", tom === "ok" ? "m5 12 5 5 9-10" : "M8 12h8"); svg.append(p); selo.append(svg, texto);
  linha.append(mini(aparencia(r.agente)), txt, selo);
  if (b) { linha.type = "button"; linha.append(elem("span", "oculto", " · ver no mapa")); linha.addEventListener("click", () => { const q = porHandle(r.agente); if (q) { irParaEscritorio(); focarAgente(q, { seguir: true, foco: true }); } }); }
  li.append(linha);
  return li;
}
let abaAprov = "esperando", chaveAprov = "";
function desenharAprovacoes(esperando, nomeDe, handleDe) {
  const q = normalizar($("busca-pedidos").value.trim()), res = resolvidosHoje();
  const bate = (...txt) => !q || normalizar(txt.join(" ")).includes(q);
  const esp = esperando.filter(t => bate(nomeDe(t.agente_id), t.rotulo, salaDoAgente(handleDe(t.agente_id))));
  const rs = res.filter(r => bate((porHandle(r.agente) || {}).nome || r.agente, r.rotulo, salaDoAgente(r.agente)));
  const n = { esperando: esperando.length, resolvidos: res.length, todos: esperando.length + res.length };
  for (const b of document.querySelectorAll("#abas-aprov [data-aba]")) textoSe(b.querySelector(".n"), String(n[b.dataset.aba]));
  textoSe($("resumo-aprov"), esperando.length ? `${esperando.length} esperando você. Aprovar acontece no agentes.chat; o botão abre o pedido certo.` : "Nada esperando você agora. Aprovar acontece no agentes.chat; o botão abre o pedido certo.");
  const vistos = (abaAprov === "resolvidos" ? 0 : esp.length) + (abaAprov === "esperando" ? Math.min(3, rs.length) : rs.length);   // só o que a aba mostra
  textoSe($("aprov-busca-total"), q ? (vistos ? `${vistos} ${vistos === 1 ? "pedido" : "pedidos"} com “${$("busca-pedidos").value.trim()}”` : `Nenhum pedido com “${$("busca-pedidos").value.trim()}”.`) : "");
  // mesma lista: só o "há quanto tempo" anda (refazer as linhas tiraria o foco de quem está nelas)
  const chave = [abaAprov, q, ...esp.map(t => [t.run_id, t.agente_id, t.status, t.rotulo, t.url, desdeDe(t)].join("|")), ...rs.map(r => `${r.run_id}|${r.resolvido_em}|${r.desfecho}`)].join("¦");
  if (chave === chaveAprov) { for (const m of $("aprov-esperando").querySelectorAll(".meta")) metaPedido(m); return; }
  chaveAprov = chave;
  const mostraEsp = abaAprov !== "resolvidos";
  $("aprov-esperando").replaceChildren(...esp.map(t => cartaoPedido(t, nomeDe(t.agente_id), handleDe(t.agente_id))));
  $("aprov-esperando").hidden = !mostraEsp || !esp.length;
  $("aprov-vazio").hidden = !mostraEsp || esperando.length > 0 || !!q;
  if (!$("aprov-mascote").firstChild) $("aprov-mascote").append(mini(Avatar.padrao("tudo-decidido")));
  const lista = abaAprov === "esperando" ? rs.slice(0, 3) : rs;
  textoSe($("t-hist"), abaAprov === "esperando" ? "Resolvidos há pouco" : "Resolvidos hoje");
  $("ver-historico").hidden = abaAprov !== "esperando" || rs.length <= 3;
  $("aprov-hist").hidden = abaAprov === "esperando" && !lista.length;
  $("lista-resolvidos").replaceChildren(...lista.map(linhaResolvido));
  if (!lista.length) $("lista-resolvidos").append(elem("li", "vazio-linha", q ? "Nenhum pedido resolvido com essa busca." : "Nada resolvido hoje ainda."));
}
function escolherAba(aba, foco) {
  abaAprov = aba;
  for (const b of document.querySelectorAll("#abas-aprov [data-aba]")) {
    const sel = b.dataset.aba === aba; b.setAttribute("aria-selected", String(sel)); b.tabIndex = sel ? 0 : -1;
    if (sel) { $("painel-aprov").setAttribute("aria-labelledby", b.id); if (foco) b.focus(); }
  }
  if (estado) desenharPainel();
}
for (const b of document.querySelectorAll("#abas-aprov [data-aba]")) b.addEventListener("click", () => escolherAba(b.dataset.aba));
$("abas-aprov").addEventListener("keydown", ev => {   // abas: setas, Home e End (padrão ARIA de abas)
  const abas = [...document.querySelectorAll("#abas-aprov [data-aba]")], i = abas.findIndex(b => b.dataset.aba === abaAprov);
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: abas.length - 1 }[ev.key];
  if (j === undefined) return;
  ev.preventDefault(); escolherAba(abas[(j + abas.length) % abas.length].dataset.aba, true);
});
$("ver-historico").addEventListener("click", () => escolherAba("resolvidos", true));
$("busca-pedidos").addEventListener("input", () => { if (estado) desenharPainel(); });

let eventosTodos = false;   // "Ver tudo": 5 linhas fechado, 15 aberto
function desenharEventos() {
  const lista = $("eventos"), todos = eventosDe(estado).filter(v => FRASES_EVENTO[v.tipo] && porHandle(v.agente)).slice(0, 15);
  const evs = eventosTodos ? todos : todos.slice(0, 5);
  $("agora-n").textContent = todos.length || "";
  $("agora-tudo").hidden = todos.length <= 5;
  $("agora-tudo").textContent = eventosTodos ? "Ver menos" : "Ver tudo"; $("agora-tudo").setAttribute("aria-expanded", String(eventosTodos));
  if (!evs.length) { // sem eventos: diz isso sem negar quem está esperando você
    const n = (estado.trabalhos || []).filter(t => /^waiting_/.test(t.status)).length, chaveVazio = `vazio:${n}`;
    if (lista.dataset.chave === chaveVazio) return;
    lista.dataset.chave = chaveVazio;
    const li = elem("li", "vazio-linha", n ? "Sem novidades agora · " : "Sem novidades agora. Quando alguém começar, terminar ou pedir algo, aparece aqui.");
    if (n) { const a = elem("a", "link-suave espera", `${n} esperando você`); a.href = "#aprovacoes"; li.append(a); }
    lista.replaceChildren(li); return;
  }
  const chave = v => `${v.em}|${v.tipo}|${v.agente}|${v.run_id || ""}`;
  if (lista.dataset.chave === evs.map(chave).join(",")) { // mesma lista: só o "há quanto tempo" anda
    for (const q of lista.querySelectorAll("time")) { const txt = tempoDesde(q.dateTime); if (q.textContent !== txt) q.textContent = txt; }
    return;
  }
  lista.dataset.chave = evs.map(chave).join(",");
  const primeira = !vistosEvento.size;
  lista.replaceChildren(...evs.map(v => {
    const b = porHandle(v.agente), li = elem("li", !primeira && !vistosEvento.has(chave(v)) ? "novo" : null), bt = elem("button", "linha-ir");
    vistosEvento.add(chave(v));
    bt.type = "button"; bt.addEventListener("click", () => { const q = porHandle(v.agente); if (q) focarAgente(q, { seguir: true, foco: true }); });
    const quando = elem("time", null, tempoDesde(v.em)); quando.dateTime = v.em; quando.title = horaDe(v.em);
    const txt = elem("span", "txt"), frase = elem("span", "quem");
    frase.append(elem("strong", null, b.nome), ` ${FRASES_EVENTO[v.tipo]}`);
    txt.append(frase, quando);
    bt.append(mini(b.ap), txt, elem("span", "botao fantasma ver-mapa", "Ver no mapa"));
    li.append(bt); return li;
  }));
}
$("agora-tudo").addEventListener("click", () => { eventosTodos = !eventosTodos; $("eventos").dataset.chave = ""; desenharEventos(); });

// ---------- conexão: ao vivo, aviso do agentes.chat e sem conexão --------------------
// estado.conexao (escritorio.py): o que o pé da lateral diz, o texto da faixa e o que ela oferece.
// "recusada" e "pausa" mostram o texto do servidor (nosso, em pt-BR; o do agentes.chat fica só no log)
const CONEXAO = {
  carregando:  { rotulo: "Conectando…" },
  conectado:   { rotulo: "Conectado" },
  sem_conexao: { rotulo: "Não conectado", texto: "O escritório ainda não está conectado ao agentes.chat.", conectar: "Conectar ao agentes.chat" },
  recusada:    { rotulo: "Conexão recusada", texto: "O agentes.chat recusou a leitura: confira se a conta conectada é da organização e se o plano permite apps externos.", doServidor: true, conectar: "Reconectar" },
  pausa:       { rotulo: "Em pausa", texto: "O agentes.chat pediu uma pausa. Mostrando a última leitura.", doServidor: true, tentar: true },
  falha:       { rotulo: "agentes.chat sem resposta", texto: "O agentes.chat não respondeu agora. Mostrando a última leitura.", tentar: true },
};
const capitular = t => t.charAt(0).toUpperCase() + t.slice(1).replace(/\.?$/, ".");
// o link que o "Copiar o link" leva: o endereço configurado (ESCRITORIO_BASE), para onde o agentes.chat devolve
const linkConectar = () => Andar.com((typeof config?.base === "string" && config.base ? config.base : location.origin) + "/oauth/conectar");
// aberto por um endereço diferente da BASE: o retorno do OAuth cai na BASE, não aqui
function enderecoTrocado() {
  if (typeof config?.base !== "string" || !config.base) return "";
  let origem; try { origem = new URL(config.base).origin; } catch (e) { return ""; }
  return origem === location.origin ? "" : `Este escritório está configurado para ${config.base}, mas foi aberto por ${location.origin}. O agentes.chat vai devolver você para ${config.base}: ajuste ESCRITORIO_BASE no servidor.`;
}
let falhou = false;
function mostrarConexao() {
  const at = $("atualizado"), faixa = $("faixa-erro"), aoVivo = $("ao-vivo");
  if (falhou) {
    textoSe(at, "Sem conexão com o servidor"); at.classList.add("erro"); aoVivo.classList.add("erro");
    estadoUsuario("Sem conexão", true);
    faixa.hidden = false; faixa.classList.remove("aviso-ambar"); $("faixa-base").hidden = true;
    textoSe($("faixa-erro-txt"), predio ? "Sem conexão. Mostrando a última leitura e tentando de novo a cada 10 s." : "Não consegui carregar o escritório. Tentando de novo a cada 10 s.");
    acoesDaFaixa({ tentar: true });
    return;
  }
  if (!estado) return;
  const erro = typeof estado.erro === "string" ? estado.erro : "";
  const chave = Object.hasOwn(CONEXAO, estado.conexao) ? estado.conexao : erro ? "falha" : "conectado";   // sem o campo: demonstração
  const c = CONEXAO[chave], ruim = !!c.texto, troca = enderecoTrocado();
  const texto = c.texto ? (c.doServidor && erro ? capitular(erro) : c.texto) : "";   // textContent: o texto do servidor nunca vira HTML
  at.classList.toggle("erro", ruim); aoVivo.classList.toggle("erro", ruim);
  textoSe(at, texto || (chave === "carregando" ? "Conectando ao agentes.chat…" : `Ao vivo · atualizado ${tempoDesde(estado.atualizado)}`));   // role=status: só anuncia quando muda
  estadoUsuario(c.rotulo, ruim);
  faixa.hidden = !ruim && !troca; faixa.classList.add("aviso-ambar");
  $("faixa-base").hidden = !troca; textoSe($("faixa-base"), troca);   // o endereço trocado vem antes de tudo
  textoSe($("faixa-erro-txt"), texto);
  acoesDaFaixa(c);
}
// sem conexão ou recusada: "Conectar" (na mesma aba) e "Copiar o link" no lugar do "Tentar agora"
function acoesDaFaixa(c) {
  const conectar = $("conectar");
  conectar.hidden = $("copiar-link").hidden = !c.conectar;
  if (c.conectar) textoSe(conectar, c.conectar);
  else $("faixa-link").hidden = true;
  $("tentar").hidden = !c.tentar;
}
$("copiar-link").addEventListener("click", async () => {
  const bt = $("copiar-link"), link = linkConectar();
  let ok = !!navigator.clipboard;   // fora de https (ou de 127.0.0.1) o navegador não oferece a área de transferência
  if (ok) try { await navigator.clipboard.writeText(link); } catch (e) { ok = false; }
  if (ok) { bt.textContent = "Copiado"; setTimeout(() => { bt.textContent = "Copiar o link"; }, 1600); return; }
  const campo = $("faixa-link-campo"); campo.value = link; $("faixa-link").hidden = false;   // sem cópia: o endereço fica à vista, já selecionado
  campo.focus(); campo.select();
});
$("faixa-link-campo").addEventListener("focus", ev => ev.target.select());
// pé da lateral: quem entrou e o estado da conexão
function estadoUsuario(texto, ruim) {
  const e = $("usuario-estado"); if (e.textContent !== texto) e.textContent = texto;
  e.classList.toggle("ruim", ruim);
  const nome = estado && typeof estado.usuario === "string" && estado.usuario ? estado.usuario : "Você";
  if ($("usuario-nome").textContent !== nome) { $("usuario-nome").textContent = nome; $("usuario-ini").textContent = nome.trim().charAt(0).toUpperCase(); }
}
$("tentar").addEventListener("click", () => { $("faixa-erro-txt").textContent = "Tentando…"; buscar(); });

// ---------- som --------------------------------------------------------------------
// painel de som: liga/desliga geral, volume e cada tipo de som
const CATEGORIAS = [["teclado", "Teclado de quem digita"], ["conversa", "Conversas (simlês)"], ["jogos", "Jogos"], ["avisos", "Avisos de aprovação"], ["clima", "Chuva e trovão"], ["ambiente", "Portas e ambiente"]];
function montarPainelSom() {
  const p = $("painel-som"), c = Som.config;
  p.replaceChildren();
  const linha = (rotulo, input) => { const l = elem("label", "linha-som"); l.append(input, elem("span", null, rotulo)); return l; };
  const geral = elem("input"); geral.type = "checkbox"; geral.checked = c.ligado; geral.addEventListener("change", () => { Som.ajustar({ ligado: geral.checked }); atualizarBotaoSom(); });
  p.append(elem("h3", null, "Sons do escritório"), linha("Som ligado", geral));
  const vol = elem("input"); vol.type = "range"; vol.min = "0"; vol.max = "1"; vol.step = "0.05"; vol.value = c.volume; vol.setAttribute("aria-label", "Volume");
  vol.addEventListener("input", () => Som.ajustar({ volume: +vol.value }));
  const lv = elem("label", "linha-som volume"); lv.append(elem("span", null, "Volume"), vol); p.append(lv);
  for (const [k, rot] of CATEGORIAS) { const i = elem("input"); i.type = "checkbox"; i.checked = c[k]; i.addEventListener("change", () => Som.ajustar({ [k]: i.checked })); p.append(linha(rot, i)); }
}
function atualizarBotaoSom() {
  const on = Som.ligado;
  $("som").setAttribute("aria-pressed", String(on));
  $("som").setAttribute("aria-label", on ? "Sons ligados: abrir ajustes" : "Sons desligados: abrir ajustes");
}
function fecharPainelSom(devolverFoco) { const p = $("painel-som"); if (p.hidden) return; p.hidden = true; $("som").setAttribute("aria-expanded", "false"); if (devolverFoco) $("som").focus(); }
if (window.Simular) { $("simular").hidden = false; $("simular").addEventListener("click", () => Simular.abrir()); }   // simular.js: data, hora e clima (só visual)
$("som").addEventListener("click", ev => {
  ev.stopPropagation();
  const p = $("painel-som"), abrir = p.hidden;
  if (abrir) { montarPainelSom(); p.hidden = false; $("som").setAttribute("aria-expanded", "true"); p.querySelector("input").focus(); } else fecharPainelSom();
});
document.addEventListener("click", ev => { if (!$("painel-som").contains(ev.target)) fecharPainelSom(); });
atualizarBotaoSom();

// ---------- câmera: mouse, toque (um dedo arrasta, dois dão pinça) e teclado ----------
tela.addEventListener("wheel", ev => {
  if (!predio) return; ev.preventDefault(); TV.tocou();
  const antes = paraMundo(ev.clientX, ev.clientY);
  cam.alvo = null; seguir = null; cam.k = limitarK(cam.k * Math.exp(-ev.deltaY * 0.0015));
  const depois = paraMundo(ev.clientX, ev.clientY);
  cam.x += antes.x - depois.x; cam.y += antes.y - depois.y;
}, { passive: false });
// agente mais perto do ponto (no mundo) e selo "!"/"?" que foi tocado
function agenteEm(p, raio) {
  let perto = null, dist = raio;
  for (const b of mundo.bonecos.values()) { if (!visivel(b)) continue; const d = Math.hypot(b.x - p.x, b.y - 9 - p.y); if (d < dist) { dist = d; perto = b; } }
  return perto;
}
function seloEm(p) { return [...mundo.bonecos.values()].find(b => b.selo && visivel(b) && Math.hypot(b.selo.x - p.x, b.selo.y - p.y) < b.selo.r) || null; }
function esperaVoce(b) { return !!(b.trabalho && b.trabalho.url && /^waiting_/.test(b.trabalho.status)); }

const dedos = new Map();   // pointerId -> último ponto na tela
let arrasto = null, pinca = null;
tela.addEventListener("pointerdown", ev => {
  tela.setPointerCapture(ev.pointerId); TV.tocou();
  dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (dedos.size === 2) { // começa a pinça: guarda a distância e o ponto do mundo sob o meio dos dedos
    const [a, b] = [...dedos.values()];
    pinca = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k, meio: paraMundo((a.x + b.x) / 2, (a.y + b.y) / 2) };
    if (arrasto) arrasto.moveu = true;
  } else if (dedos.size === 1) arrasto = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y, moveu: false, tipo: ev.pointerType };
});
tela.addEventListener("pointermove", ev => {
  if (!dedos.has(ev.pointerId)) return;
  dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinca && dedos.size >= 2) {
    const [a, b] = [...dedos.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    cam.alvo = null; seguir = null;
    cam.k = limitarK(pinca.k * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinca.d));
    const agora = paraMundo(mx, my); cam.x += pinca.meio.x - agora.x; cam.y += pinca.meio.y - agora.y;
    return;
  }
  if (!arrasto) return;
  const dx = ev.clientX - arrasto.x, dy = ev.clientY - arrasto.y;
  if (Math.hypot(dx, dy) > (arrasto.tipo === "touch" ? 8 : 4)) arrasto.moveu = true;
  if (arrasto.moveu) { cam.alvo = null; seguir = null; cam.x = arrasto.cx - (dx * dpr) / cam.k; cam.y = arrasto.cy - (dy * dpr) / cam.k; tela.style.cursor = "grabbing"; }
});
function soltarDedo(ev) {
  dedos.delete(ev.pointerId);
  if (dedos.size < 2) pinca = null;
  if (dedos.size === 1) { const [p] = [...dedos.values()]; arrasto = { x: p.x, y: p.y, cx: cam.x, cy: cam.y, moveu: true }; }   // o dedo que ficou continua arrastando
}
tela.addEventListener("pointercancel", ev => { soltarDedo(ev); if (!dedos.size) arrasto = null; });
tela.addEventListener("pointerup", ev => {
  const toque = arrasto && !arrasto.moveu && dedos.size === 1;
  soltarDedo(ev); tela.style.cursor = "";
  if (dedos.size) return;
  arrasto = null;
  if (!toque || !mundo) return;
  const p = paraMundo(ev.clientX, ev.clientY);
  const selo = seloEm(p);
  if (selo && esperaVoce(selo)) { window.open(selo.trabalho.url, "_blank", "noopener"); return; }   // aprovar continua só no agentes.chat
  const perto = agenteEm(p, ev.pointerType === "touch" ? 16 : 12);
  if (perto) { focarAgente(perto); return; }
  const s = [...predio.salas, ...predio.baixo].find(r => r.placaRet && p.x >= r.placaRet.x && p.x <= r.placaRet.x + r.placaRet.w + 20 && p.y >= r.placaRet.y && p.y <= r.placaRet.y + r.placaRet.h);
  if (s) { focarSala(s); return; }
  if (Brincar.tocar(p, ev.pointerType)) return;   // objeto do mapa (TV, café, sino…)
  fecharFicha();
  Vida.irAte(mundo, p);   // o chão: o meu boneco anda até lá (na TV e com "Aparecer" desligado não há boneco)
});
// cartão rápido ao passar o mouse (no toque, a ficha faz esse papel)
tela.addEventListener("pointermove", ev => {
  const card = $("cartao-agente");
  if (ev.pointerType !== "mouse" || !mundo || (arrasto && arrasto.moveu)) { card.hidden = true; return; }
  const p = paraMundo(ev.clientX, ev.clientY);
  const perto = seloEm(p) || agenteEm(p, 11), objeto = Brincar.sobre(p);
  tela.style.cursor = perto || objeto ? "pointer" : "";
  mostrarCartao(perto, ev.clientX, ev.clientY);
});
// cartão rápido de um agente perto do ponteiro (null esconde)
function mostrarCartao(perto, cx, cy) {
  const card = $("cartao-agente");
  if (!perto || perto.id === selecionado) { card.hidden = true; return; }
  card.replaceChildren(mini(perto.ap), elem("strong", null, perto.nome), elem("span", `chip ${classeDe(perto)}`, textoEstado(perto)),
    elem("p", null, perto.trabalho ? perto.trabalho.rotulo : ondeEsta(perto)));
  card.append(elem("p", "dica", esperaVoce(perto) ? "Toque no selo para abrir o pedido; no agente, para ver o cartão" : "Clique para abrir o cartão"));
  const r = $("palco").getBoundingClientRect();
  card.style.left = `${Math.min(cx - r.left + 14, r.width - 254)}px`; card.style.top = `${Math.max(8, cy - r.top - 20)}px`;
  card.hidden = false;
}
tela.addEventListener("pointerleave", () => { $("cartao-agente").hidden = true; Brincar.sobre({ x: -1e9, y: -1e9 }); });
tela.addEventListener("dblclick", ev => { const s = predio && salaEm(paraMundo(ev.clientX, ev.clientY)); if (s) { fecharFicha(); focarSala(s); } });
$("zoom-mais").addEventListener("click", () => moverCamera({ x: cam.x, y: cam.y, k: cam.k * 1.4 }));
$("zoom-menos").addEventListener("click", () => { seguir = null; moverCamera({ x: cam.x, y: cam.y, k: cam.k / 1.4 }); });
$("ver-tudo").addEventListener("click", () => { fecharFicha(); marcarSala(null); verTudo(); });
function telaCheia(ligar) {
  const c = $("palco-cartao"); if (ligar === c.classList.contains("cheio")) return;
  c.classList.toggle("cheio", ligar); document.body.classList.toggle("travado", ligar);
  $("tela-cheia").setAttribute("aria-pressed", String(ligar)); $("tela-cheia").setAttribute("aria-label", ligar ? "Sair da tela cheia" : "Mapa em tela cheia");
  $("tela-cheia").querySelector(".ic").replaceChildren(iconeSvg(ligar ? "recolher" : "expandir"));
  ajustarEscala();
  if (!ligar && window.innerWidth <= 760) $("abrir-cheia").focus();   // o botão de sair some com a tela cheia: o foco não cai no body
}
$("tela-cheia").addEventListener("click", () => telaCheia(!$("palco-cartao").classList.contains("cheio")));
$("abrir-cheia").addEventListener("click", () => { telaCheia(true); $("tela-cheia").focus(); });   // celular: o foco vai para o botão que sai da tela cheia
document.addEventListener("keydown", ev => {
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === "k") { ev.preventDefault(); irParaBusca(); return; }
  if (ev.key === "Escape") {
    if ($("dlg-senha").open || $("dlg-ringue").open || $("dlg-placar").open) return;   // o próprio <dialog> fecha com o Esc
    if (!$("painel-som").hidden) { fecharPainelSom(true); return; }
    if (gavetaAberta()) { fecharGaveta(true); return; }
    if (!$("conversa").hidden) { fecharConversa(true); return; }
    if (!$("v-conversas").hidden && convAberta && celularConv()) { fecharConvPagina(); return; }
    if (!$("ficha").hidden) { fecharFicha(); tela.focus(); return; }
    if (TV.ligada) { TV.desligar(); return; }
    if ($("palco-cartao").classList.contains("cheio")) { telaCheia(false); return; }
  }
  if (!predio || $("v-escritorio").hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (["+", "=", "-", "0"].includes(ev.key)) TV.tocou();
  if (ev.key === "/" && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); irParaBusca(); }
  else if (ev.key === "+" || ev.key === "=") moverCamera({ x: cam.x, y: cam.y, k: cam.k * 1.3 });
  else if (ev.key === "-") { seguir = null; moverCamera({ x: cam.x, y: cam.y, k: cam.k / 1.3 }); }
  else if (ev.key === "0") { fecharFicha(); verTudo(); }
});
// ---------- visitantes: quem mais está olhando (o /api/estado manda os outros, sem a própria sessão) ----------
let aparecer = true;   // "Aparecer no escritório", por navegador (ligado por padrão)
try { aparecer = localStorage.getItem("escritorio:aparecer") !== "nao"; } catch (e) { /* aba anônima: vale o padrão */ }
$("aparecer").checked = aparecer;
$("aparecer").addEventListener("change", () => {
  aparecer = $("aparecer").checked;
  try { localStorage.setItem("escritorio:aparecer", aparecer ? "sim" : "nao"); } catch (e) { /* fica só nesta visita */ }
  mostrarOlhando(); buscar();   // o servidor fica sabendo já na próxima leitura (quem desliga some em até 45 s)
});
// as pessoas da equipe no mapa (vida.js); a TV e quem desligou "Aparecer" leem sem marcar presença. Na prévia não há conta
addEventListener("aovivo", mostrarOlhando);   // a cada leitura das pessoas do andar
function ligarAoVivo() { if (!Brincar.demo && !config.previa) Vida.aoVivo({ invisivel: () => TV.invisivel || !aparecer }); }
// os outros vêm das pessoas deste andar no mapa (vida.js); antes da 1ª leitura e na prévia, do /api/estado
function mostrarOlhando() {
  const lista = estado && Array.isArray(estado.visitantes) ? estado.visitantes : null, noMapa = Vida.olhando();
  $("olhando").hidden = (noMapa === null && !lista) || Brincar.demo;   // servidor antigo ou demonstração: sem a linha
  if ($("olhando").hidden) return;
  const outros = Math.min(noMapa ?? lista.length, 50), n = outros + (aparecer ? 1 : 0);
  textoSe($("olhando-txt"), aparecer && n === 1 ? "Só você está olhando" : !n ? "Ninguém mais olhando" : `${n} ${n === 1 ? "pessoa olhando" : "pessoas olhando"}`);
}

// ---------- modo TV (tv.js): a câmera e as notícias que o diretor usa ----------------
function salasComGente() { // salas com alguém visível dentro, na ordem do prédio
  const n = new Map();
  for (const b of mundo.bonecos.values()) { if (!visivel(b)) continue; const s = salaEm(b); if (s) n.set(s, (n.get(s) || 0) + 1); }
  return [...predio.salas, ...predio.baixo].filter(s => n.has(s)).map(s => ({ sala: s, n: n.get(s) }));
}
function seguirAgente(handle, ja) {
  const b = porHandle(handle); if (!b || !visivel(b)) return false;
  seguir = b.id;
  moverCamera({ x: b.x, y: b.y - 10, k: 3.2 * dpr }, ja);
  return true;
}
function ligarTV() {
  TV.iniciar({
    estado: () => estado,
    eventos: est => eventosDe(est).filter(v => FRASES_EVENTO[v.tipo] && porHandle(v.agente)),
    cena: () => { const c = socialLigada() && estado.social.cena; return c && typeof c.id === "string" && (c.tipo === "briga" || c.tipo === "greve") ? c : null; },
    salaDaCena: () => (predio.ringue && predio.ringue.sala) || null,
    salasComGente, seguirAgente, enquadrar,
    temAgente: h => !!porHandle(h),
    agente: h => { const b = porHandle(h); return b ? { nome: b.nome, ap: b.ap } : null; },
    frase: tipo => FRASES_EVENTO[tipo] || "",
    verTudo: ja => verTudo(ja),
    soltar: () => { seguir = null; },
    irAoMapa: () => { if (location.hash && location.hash !== "#escritorio") { history.replaceState(history.state, "", "#escritorio"); rota(); } },
    aoLigar: () => Timelapse.preferir(),   // a TV fica com a gravação do time-lapse
    fecharFicha, telaCheia, mini,
  });
}
// time-lapse (timelapse.js): o prédio inteiro, sem mexer na câmera de quem olha (redesenha do jeito que estava antes de a tela pintar)
function fotografar(out, largura) {
  if (!predio || !mundo || !tela.width) return false;
  const antes = { x: cam.x, y: cam.y, k: cam.k, alvo: cam.alvo }, seg = seguir, t = performance.now();
  cam.alvo = null; seguir = null; Object.assign(cam, { x: predio.W / 2, y: predio.H / 2, k: encaixe() });
  desenharCena(t);
  out.width = largura; out.height = Math.round((largura * tela.height) / tela.width);
  out.getContext("2d").drawImage(tela, 0, 0, out.width, out.height);
  Object.assign(cam, antes); seguir = seg;
  desenharCena(t);
  return true;
}
function marcarSala(s) { for (const b of $("salas").querySelectorAll("button")) b.setAttribute("aria-current", String(!!s && b.dataset.sala === s.nome)); }

// ---------- relógio e atualizações de 1 s -----------------------------------------
// faixa acima do mapa enquanto o escritório está fechado; segue a hora do mapa (?hora, Simulação, demonstração)
function mostrarExpediente(h) {
  const fora = Expediente.fora(h), f = $("faixa-fora");
  if (f.hidden === !fora) return;
  f.hidden = !fora;
  textoSe($("faixa-fora-txt"), `Fora do expediente · abre às ${Expediente.proximaAbertura()}`);
  $("faixa-fora-mudar").hidden = Brincar.demo;   // na demonstração o Personalizar não abre
}
// "Mudar o horário" da faixa e a placa do expediente no mapa (brincar.js): abrem o Personalizar já no campo "Abre às"
// (o rota() troca a tela no mesmo hashchange, antes)
function abrirExpediente() { addEventListener("hashchange", () => $("m-abre").focus(), { once: true }); location.hash = "#personalizar"; }
$("faixa-fora-mudar").addEventListener("click", ev => { ev.preventDefault(); abrirExpediente(); });

setInterval(() => {
  const c = Ceu.agora(), mo = Vida.momento();
  const f = (festa ? ` · ${festa.nome}` : "") + (mo ? ` · ${{ daily: "hora da daily", almoco: "almoço", cafe: "pausa do café" }[mo.nome]}` : "");
  const completo = `${c.hora} · ${c.periodo} · ${Clima.texto()}${f}`, curto = Clima.texto(true);
  const vivo = falhou ? "Sem conexão" : estado && estado.erro ? "Última leitura" : "Ao vivo";
  $("relogio").textContent = `${vivo} · ${innerWidth <= 760 ? `${c.hora}${curto ? " · " + curto : ""}` : completo}`;
  $("relogio").title = completo;
  mostrarExpediente(c.h);
  if (!predio || !mundo || document.hidden) return;
  atualizarEstados(); atualizarSalas(); mostrarConexao();
  if (!$("ficha").hidden) renderFicha();
}, 1000);

// ---------- menu lateral: fixo no computador (dá para recolher); gaveta no celular -------
const menuLargo = matchMedia("(min-width: 901px)");
let lateralRecolhida = false, focoAntesDaGaveta = null;
try { lateralRecolhida = localStorage.getItem("escritorio:lateral") === "recolhida"; } catch (e) { /* aba anônima ou armazenamento bloqueado */ }
function gavetaAberta() { return document.body.classList.contains("gaveta-aberta"); }
function aplicarLateral() {
  document.body.classList.toggle("lateral-recolhida", lateralRecolhida && menuLargo.matches);
  if (menuLargo.matches) fecharGaveta();
  medirFaixa();
  $("abrir-menu").setAttribute("aria-label", menuLargo.matches ? "Mostrar o menu" : "Abrir o menu");
  ajustarEscala();
}
function recolherLateral(recolher) {
  lateralRecolhida = recolher;
  try { localStorage.setItem("escritorio:lateral", recolher ? "recolhida" : "fixa"); } catch (e) { /* fica só nesta visita */ }
  aplicarLateral();
  (recolher ? $("abrir-menu") : $("recolher")).focus();
}
function abrirGaveta(naBusca) {
  focoAntesDaGaveta = document.activeElement;
  document.body.classList.add("gaveta-aberta"); $("veu").hidden = false;
  $("abrir-menu").setAttribute("aria-expanded", "true");
  $("principal").inert = $("topo").inert = true;   // o resto da página fica fora do Tab e do leitor de tela
  (naBusca ? $("busca") : $("fechar-menu")).focus();
}
function fecharGaveta(devolverFoco) {
  if (!gavetaAberta()) return;
  document.body.classList.remove("gaveta-aberta"); $("veu").hidden = true;
  $("abrir-menu").setAttribute("aria-expanded", "false");
  $("principal").inert = $("topo").inert = false;
  if (devolverFoco) (focoAntesDaGaveta && focoAntesDaGaveta.isConnected && focoAntesDaGaveta !== document.body ? focoAntesDaGaveta : $("abrir-menu")).focus();
}
// Ctrl K, "/" e a lupa da barra: o campo "Ir para…" da lateral (abre a gaveta ou mostra o menu recolhido)
function irParaBusca() {
  if (!menuLargo.matches) { if (!gavetaAberta()) abrirGaveta(true); else $("busca").focus(); return; }
  if (lateralRecolhida) recolherLateral(false);
  $("busca").focus();
}
// escolher sala ou agente na lateral leva ao mapa (e fecha a gaveta antes, para o foco ir à ficha)
function irParaEscritorio() {
  fecharGaveta();
  if (location.hash && location.hash !== "#escritorio") { location.hash = "#escritorio"; rota(); }   // já mostra o mapa: o foco vai para a ficha
}
// faixa de demonstração ou de prévia presa no topo: a lateral fixa começa embaixo dela
function medirFaixa() {
  const f = document.querySelector("body > .faixa-demo");
  document.documentElement.style.setProperty("--faixa", `${f && menuLargo.matches ? f.offsetHeight : 0}px`);
}
$("abrir-menu").addEventListener("click", () => (menuLargo.matches ? recolherLateral(false) : abrirGaveta(false)));
$("recolher").addEventListener("click", () => recolherLateral(true));
$("fechar-menu").addEventListener("click", () => fecharGaveta(true));
$("veu").addEventListener("click", () => fecharGaveta(true));
$("topo-busca").addEventListener("click", irParaBusca);
menuLargo.addEventListener("change", aplicarLateral);
for (const id of ["t-salas", "t-agentes"]) $(id).addEventListener("click", () => {   // seções recolhíveis da lateral
  const b = $(id), abrir = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", String(abrir)); $(b.getAttribute("aria-controls")).hidden = !abrir;
});
aplicarLateral();

// ---------- andares: o elevador do prédio -----------------------------------------------
// Cada workspace do agentes.chat é um andar, com a sua conexão e os seus times. O /api/config traz "andares" (o principal
// primeiro) e "andar" (o atual). Com um andar só, o elevador fica escondido e a tela é a de sempre. Trocar de andar não
// recarrega a página: relê o config, zera o que era do outro andar e o prédio é refeito na próxima leitura do estado.
let andares = [], chaveElevador = "", trocando = false;
function lerAndares(c) {   // só ids e nomes conferidos; texto vem do servidor e entra por textContent
  const lista = c && Array.isArray(c.andares) ? c.andares : [];
  return lista.filter(a => a && Andar.valido(a.id) && typeof a.nome === "string" && a.nome && a.nome.length <= 80)
    .map(a => ({ id: a.id, nome: a.nome, conexao: typeof a.conexao === "string" ? a.conexao : "" })).slice(0, 7);
}
const nomeDoAndar = id => (andares.find(a => a.id === id) || { nome: "principal" }).nome;
const anunciarAndar = t => { $("modo-anuncio").textContent = t; };
function mostrarElevador() {
  andares = lerAndares(config);
  const varios = andares.length >= 2 && !Brincar.demo;
  // os links do escritório que levam ao OAuth e ao modo construção seguem o andar atual
  const principal = Andar.atual === Andar.PRINCIPAL;
  for (const a of document.querySelectorAll("[data-conectar]")) a.setAttribute("href", "/oauth/conectar" + (principal ? "" : `?andar=${Andar.atual}`));
  if (!Brincar.demo) for (const a of document.querySelectorAll("#as-construcao a, #m-construcao a")) a.setAttribute("href", "construir.html" + (principal ? "" : `#andar=${Andar.atual}`));
  const chave = JSON.stringify(andares);
  const atual = andares.find(a => a.id === Andar.atual) || andares[0];
  for (const caixa of document.querySelectorAll("[data-elevador]")) {
    caixa.hidden = !varios;
    if (!varios) continue;
    const sel = caixa.querySelector("select");
    if (chave !== chaveElevador || sel.options.length !== andares.length) {   // sem refazer a lista aberta a cada leitura
      sel.replaceChildren(...andares.map(a => { const o = elem("option", null, a.conexao && a.conexao !== "conectado" ? `${a.nome} · ${Andar.rotuloConexao(a.conexao)}` : a.nome); o.value = a.id; return o; }));
    }
    sel.value = atual.id;
    caixa.querySelector(".elevador-led").dataset.conexao = atual.conexao;
    const estadoAndar = caixa.querySelector(".elevador-estado"); if (estadoAndar) { textoSe(estadoAndar, Andar.rotuloConexao(atual.conexao)); estadoAndar.dataset.conexao = atual.conexao; }
    sel.title = `Andar ${atual.nome}: ${Andar.rotuloConexao(atual.conexao)}`;
  }
  chaveElevador = chave;
  document.body.classList.toggle("com-andares", varios);
}
for (const sel of document.querySelectorAll("[data-elevador] select")) sel.addEventListener("change", () => trocarAndar(sel.value));
// só a lista de andares (a conexão de cada um muda sem o config do andar atual mudar)
async function recarregarAndares() {
  if (Brincar.demo || trocando) return;
  try { const c = await json("api/config"); config.andares = c.andares; config.andar = c.andar; mostrarElevador(); }
  catch (e) { if (e instanceof AndarInvalido) voltarAoPrincipal(); }
}
setInterval(() => { if (!document.hidden && andares.length >= 2) recarregarAndares(); }, 60000);

// o endereço leva #andar=<id> enquanto se está no mapa (as outras telas usam o # para a rota; o andar continua guardado)
function marcarAndarNaUrl() {
  const h = location.hash, base = location.pathname + location.search;
  if (Andar.atual !== Andar.PRINCIPAL) { if (!h || h === "#escritorio" || Andar.doHash(h)) history.replaceState(history.state, "", `${base}#andar=${Andar.atual}`); }
  else if (Andar.doHash(h)) history.replaceState(history.state, "", base);
}
function sairDoAndarInvalido() { Andar.limpar(); marcarAndarNaUrl(); }   // 404 {"codigo":"andar"}: o guardado não vale mais
function voltarAoPrincipal() { trocarAndar(Andar.PRINCIPAL, "Esse andar não está mais disponível. Você voltou para o andar principal."); }

// zera o que era do andar de antes: ficha, conversa aberta, eventos e pedidos deduzidos, social e greve
function reiniciarAndar() {
  Vida.aoVivo(null);   // as pessoas e o seq são do andar de antes
  assinatura = ""; selecionado = null;
  eventosLocais = []; statusAnterior = null; vistosEvento.clear();
  resolvidosLocais = []; pedidosAnteriores = null; resolvidosDaLeitura = leituraDosResolvidos = null; chaveAprov = "";
  convAberta = null; convLida = ""; convDesenho = ""; pedidoConv++; pedidoConversa++; $("conv-aberta").replaceChildren();
  amizades = null; pedidoAmizades++; cenaVista = null; releitura = releituraPlacar = 0; greveVista = null;
  if ($("dlg-placar").open) $("dlg-placar").close();
  Jornal.reiniciar();
  if (window.Ajustes) Ajustes.esquecerAndar();
}
async function trocarAndar(id, aviso) {
  if (Brincar.demo || trocando || !Andar.valido(id)) { mostrarElevador(); return; }
  const anterior = Andar.atual;
  if (id === anterior) { mostrarElevador(); return; }
  trocando = true;
  Andar.definir(id);
  try {
    const c = await json("api/config");   // com o andar novo; falhando, nada do andar de antes é mexido
    reiniciarAndar();
    config = c; Expediente.definir(c.expediente); aplicarConfig();
    marcarAndarNaUrl();
    if (!$("v-personalizar").hidden) Ajustes.abrir(config);
    trocando = false;
    await buscar();
    ligarAoVivo();
    anunciarAndar(aviso || `Você está no andar ${nomeDoAndar(id)}.`);
  } catch (e) {
    trocando = false;
    if (id === Andar.PRINCIPAL) { falhou = true; mostrarConexao(); setTimeout(() => location.reload(), 10000); return; }   // como a carga inicial
    Andar.definir(anterior); mostrarElevador();
    anunciarAndar(e instanceof AndarInvalido ? "Esse andar não está mais disponível." : "Não deu para ir para esse andar agora. Tente de novo.");
    if (e instanceof AndarInvalido) recarregarAndares();
  }
}

// ---------- telas (rotas pelo #) ---------------------------------------------------
function rota() {
  if (gavetaAberta()) { fecharGaveta(); $("principal").focus({ preventScroll: true }); }   // item do menu na gaveta: o foco vai ao conteúdo
  const r = (location.hash || "#escritorio").slice(1);
  const TELAS = ["escritorio", "conversas", "aprovacoes", "jornal", "personalizar", "novidades", "ajuda"];
  // na demonstração o Personalizar não existe: ele grava a marca no servidor de verdade
  const valida = TELAS.includes(r) && !(r === "personalizar" && Brincar.demo) && !(r === "conversas" && souMembro()) ? r : "escritorio";
  for (const v of TELAS) $(`v-${v}`).hidden = v !== valida;
  if (valida === "personalizar" && window.Personalizar) { Personalizar.abrir(config); if (window.Ajustes) Ajustes.abrir(config); }
  if (valida === "conversas") paginaConversas();
  if (valida === "jornal") Jornal.abrir();
  if (valida === "novidades") Novidades.abrir(); else Novidades.fechar();
  document.querySelectorAll("[data-rota]").forEach(a => { if (a.dataset.rota === valida) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (valida !== "escritorio") { TV.desligar(); telaCheia(false); }
  else ajustarEscala();
}

// ajuda: procurar nas perguntas, com o termo destacado, a contagem e "Copiar" nos comandos de terminal
const faqOriginal = new Map();
function prepararPergunta(d, q) {
  if (!faqOriginal.has(d)) faqOriginal.set(d, d.innerHTML);
  d.innerHTML = faqOriginal.get(d);   // conteúdo fixo do próprio index.html
  const ok = !q || normalizar(d.textContent).includes(q);
  if (q && ok) { // <mark> em cada ocorrência, ignorando acentos e maiúsculas
    const nos = [], w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) nos.push(w.currentNode);
    for (const no of nos) {
      const txt = no.nodeValue, mapa = [];
      let norm = "";
      for (let i = 0; i < txt.length; i++) for (const ch of normalizar(txt[i])) { norm += ch; mapa.push(i); }
      let ini = norm.indexOf(q); if (ini < 0) continue;
      const frag = document.createDocumentFragment(); let ultimo = 0;
      for (; ini >= 0; ini = norm.indexOf(q, ini + q.length)) {
        const a = mapa[ini], b = mapa[ini + q.length - 1] + 1;
        frag.append(txt.slice(ultimo, a), elem("mark", null, txt.slice(a, b))); ultimo = b;
      }
      frag.append(txt.slice(ultimo)); no.replaceWith(frag);
    }
  }
  for (const c of d.querySelectorAll("code.cmd")) {
    const bt = elem("button", "copiar"); bt.type = "button"; bt.setAttribute("aria-label", `Copiar o comando: ${c.textContent}`);
    const ic = elem("span", "ic"); ic.append(iconeSvg("copiar")); bt.append(ic, elem("span", null, "Copiar"));
    bt.addEventListener("click", async () => {
      let ok2 = true; try { await navigator.clipboard.writeText(c.textContent); } catch (e) { ok2 = false; }
      bt.lastChild.textContent = ok2 ? "Copiado" : "Selecione e copie"; setTimeout(() => { bt.lastChild.textContent = "Copiar"; }, 1600);
    });
    c.after(bt);
  }
  return ok;
}
function buscarNaAjuda() {
  const q = normalizar($("faq-busca").value.trim());
  let n = 0;
  for (const d of document.querySelectorAll(".faq details")) { const ok = prepararPergunta(d, q); d.hidden = !ok; if (ok) n++; if (q && ok) d.open = true; }
  for (const h of document.querySelectorAll(".faq .faq-grupo, .faq .atalhos")) h.hidden = !!q;
  $("faq-total").hidden = !q;
  $("faq-total").textContent = n ? `${n} ${n === 1 ? "resposta" : "respostas"}` : "Nenhuma pergunta com esse termo.";
}
$("faq-busca").addEventListener("input", buscarNaAjuda);
buscarNaAjuda();

// aviso no celular (avisar.js e sw.js): o toque abre /?agente=<id>; aqui o mapa vai até ele
function irAoAgente(id) {
  if (location.hash && location.hash !== "#escritorio") { location.hash = "#escritorio"; rota(); }
  const b = boneco(id); if (b) focarAgente(b, { seguir: true, foco: true });
}
function irAoAgentePedido() {
  const u = new URL(location.href), id = u.searchParams.get("agente");
  if (!id) return;
  u.searchParams.delete("agente"); history.replaceState(history.state, "", u);   // recarregar não volta a abrir
  irAoAgente(id);
}
Avisar.iniciar({ demo: () => Brincar.demo });
Timelapse.iniciar({
  fotografar,
  podeGravar: () => !!predio && !naSimulacao() && !Brincar.demo && !Expediente.fora(Ceu.agora().h),
  demo: () => Brincar.demo,
});
// jornal (jornal.js): os nomes e as aparências saem desta tela; o resto vem do /api/jornal
Jornal.iniciar({
  agente: id => {
    const b = boneco(id); if (b) return { nome: b.nome, ap: b.ap };
    const a = ((estado && estado.agentes) || []).find(x => x.id === id);
    return a ? { nome: a.nome, ap: aparencia(a.handle) } : null;
  },
  empresa: () => (config && config.empresa) || "",
  demo: () => Brincar.demo,
  socialLigada, mini,
});
// novidades (novidades.js): o histórico de mudanças e o selo "Novo" no menu
Novidades.iniciar();

pintarIcones(document);
window.addEventListener("hashchange", () => { const id = Andar.doHash(location.hash); if (id && id !== Andar.atual) trocarAndar(id); });
window.addEventListener("hashchange", rota);
window.addEventListener("resize", () => { medirFaixa(); ajustarEscala(); });
rota();
iniciar().catch(() => { falhou = true; mostrarConexao(); setTimeout(() => location.reload(), 10000); });
// PWA (ícone na tela de início): o sw.js não guarda nada; sem ele (http fora do localhost, servidor antigo), o app abre igual
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  // toque no aviso com esta aba aberta: o sw.js foca a aba e manda ir ao agente
  navigator.serviceWorker.addEventListener("message", ev => { if (ev.data && ev.data.tipo === "agente" && typeof ev.data.agente === "string") irAoAgente(ev.data.agente); });
}
