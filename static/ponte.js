// Ponte local (Firmópolis, onda 2): os terminais deste computador no mapa. Quem lê é o navegador, direto da ponte em
// 127.0.0.1:47820 (ponte/ deste repositório), pelo WebSocket do contrato v1; nada passa pelo servidor do escritório.
// Liga só depois de a pessoa colar o token (Personalizar > Ponte local), que fica neste navegador (localStorage). A
// ponte confere o Origin (ponte setup --origem) e o token, que vai como subprotocolo "token.<hex>" (o navegador não
// manda Authorization no WebSocket). Desligada ou caída, tenta de novo espaçando até 1 minuto, sem aviso na tela.
// Os dados da ponte só vão para a tela por textContent e pelo canvas, sempre conferidos e cortados aqui.
// Espelho: sem a ponte local ligada, lê do servidor (GET /api/ponte, a ponte de outra máquina espelhada lá) a cada 3 s
// enquanto ele disser "ativo" e alimenta o mesmo estado, com a mesma conferência. A ponte local sempre tem prioridade.
// Responder pelo escritório: os pedidos de permissão (a ferramenta e um resumo mascarado) chegam da ponte local
// ("pendente"/"resolvido" no /ws) ou do servidor (no GET /api/ponte, só para quem decide). Permitir/Negar vai pelo /ws
// (pedido local) ou por POST /api/ponte/decidir (pedido do espelho). Quem decide é o servidor que diz ("decidir": true no
// /api/ponte); só então a página manda "atender" à ponte local, enquanto está visível.
// Perguntas (fase 2): o terminal na pergunta vira um pedido do tipo "pergunta", e a resposta (uma linha, até 1000
// caracteres visíveis, sem barra invertida: textoResposta) vai pelo /ws ("responder") ou pelo mesmo POST, com "texto".
// A ponte a digita no terminal (Maestri) ou responde pela API do OpenCode; recusada, ela diz o motivo ("recusado").
"use strict";
const Ponte = (() => {
  const URL_PONTE = "ws://127.0.0.1:47820/ws", PROTOCOLO = "firmopolis.v1", CHAVE = "firmopolis.ponte";
  const MAX = 48, ESPERA_MIN = 3000, ESPERA_MAX = 60000, MAX_WS = 32, MAX_DIA = 200;
  const URL_SRV = "api/ponte", SRV_ATIVO = 3000, SRV_PARADO = 30000, SRV_ERRO = 60000;
  const ESTADOS = { ocupado: "ocupado", ocioso: "livre", esperando_permissao: "aprovacao", esperando_resposta: "pergunta", erro: "erro" };
  const PROVEDORES = { claude_code: "Claude Code", codex: "Codex", open_code: "OpenCode", antigravity_cli: "agy", minimax_code: "MiniMax" };
  const MAX_PEND = 16, PRAZO_MAX = 600000;
  const st = { ws: null, token: "", situacao: "desligada", falhas: 0, timer: 0, moradores: new Map(), workspaces: new Map(), dia: new Map(), v: 0,
    servidor: false, srvTimer: 0, srvLido: "", espelho: null, pendentes: new Map(), decide: false };

  const tokenOk = t => typeof t === "string" && /^[0-9a-f]{64}$/.test(t);
  function lerToken() { try { const t = localStorage.getItem(CHAVE); return tokenOk(t) ? t : ""; } catch (e) { return ""; } }
  function gravarToken(t) { try { if (t) localStorage.setItem(CHAVE, t); else localStorage.removeItem(CHAVE); } catch (e) { /* aba anônima: vale só nesta visita */ } }

  const texto = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");
  // um morador do contrato v1 vira o terminalzinho do mapa: só o que a tela usa, conferido
  function terminal(m) {
    if (!m || typeof m !== "object" || !texto(m.id, 200) || !Object.hasOwn(ESTADOS, m.estado)) return null;
    const provedor = Object.hasOwn(PROVEDORES, m.provedor) ? PROVEDORES[m.provedor] : "Terminal";
    const at = m.atividade && typeof m.atividade === "object" ? texto(m.atividade.ferramenta, 40) : "";
    return { id: texto(m.id, 200), nome: texto(m.nome, 40) || provedor, provedor, estado: ESTADOS[m.estado],
      projeto: texto(m.projeto, 60), atividade: at, gerente: m.gerente === true, papel: texto(m.papel, 40),
      workspace: texto(m.workspace_id, 200), band: texto(m.band_id, 200), solto: m.solto === true,
      ajudantes: Number.isInteger(m.ajudantes) ? Math.max(0, Math.min(99, m.ajudantes)) : 0,
      desde: typeof m.desde === "string" && m.desde.length < 64 && Number.isFinite(Date.parse(m.desde)) ? m.desde : "" };
  }
  // os workspaces do Maestri (o cartão mostra os nomes): id → { nome, bands: Map(id → nome) }, com teto
  function guardarWorkspaces(lista) {
    st.workspaces.clear();
    for (const w of Array.isArray(lista) ? lista.slice(0, MAX_WS) : []) {
      if (!w || typeof w !== "object" || !texto(w.id, 200)) continue;
      const bands = new Map();
      for (const b of Array.isArray(w.bands) ? w.bands.slice(0, MAX_WS) : []) if (b && typeof b === "object" && texto(b.id, 200)) bands.set(texto(b.id, 200), texto(b.nome, 60));
      st.workspaces.set(texto(w.id, 200), { nome: texto(w.nome, 60), bands });
    }
  }
  // a linha do dia de cada terminal (o histórico de hoje, sem o alvo): só hora, estado e ferramenta, os 200 mais novos
  function anotar(id, ts, estado, ferramenta) {
    let l = st.dia.get(id);
    if (!l) { if (st.dia.size >= MAX_DIA) return; st.dia.set(id, l = []); }
    l.push({ ts, estado, ferramenta });
    if (l.length > MAX_DIA) l.splice(0, l.length - MAX_DIA);
  }
  function guardarDia(eventos) {
    st.dia.clear();
    const ok = (Array.isArray(eventos) ? eventos : []).filter(e => e && typeof e === "object" && texto(e.morador_id, 200) && Object.hasOwn(ESTADOS, e.estado)
      && typeof e.ts === "string" && Number.isFinite(Date.parse(e.ts)));
    const ord = ok.map(e => ({ id: texto(e.morador_id, 200), ts: Date.parse(e.ts), estado: ESTADOS[e.estado], ferramenta: texto(e.ferramenta, 40) })).sort((a, b) => a.ts - b.ts);
    for (const e of ord) anotar(e.id, e.ts, e.estado, e.ferramenta);
  }
  function esquecer() { const tinha = st.moradores.size; st.moradores.clear(); st.workspaces.clear(); st.dia.clear(); return tinha; }
  function mudou() { st.v++; window.dispatchEvent(new CustomEvent("ponte")); }
  function guardarSnapshot(d) {
    st.moradores.clear(); guardarWorkspaces(d.workspaces);
    for (const m of d.moradores.slice(0, MAX)) { const t = terminal(m); if (t) st.moradores.set(t.id, t); }
  }
  // ---------- pedidos de permissão: id → { id, morador, ferramenta, resumo, ate (ms), local } ----------------------
  const ID_PEDIDO = /^[A-Za-z0-9_-]{22}$/;
  // o texto do pedido: controle, C1, bidi e largura zero (\p{Cc} e \p{Cf}) viram uma marca visível, como ‹U+202E›
  const ENGANOSO = /[\p{Cc}\p{Cf}]/gu;
  const visivel = (v, max) => (typeof v === "string"
    ? v.replace(/\t/g, " ").replace(ENGANOSO, c => `‹U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}›`).trim().slice(0, max) : "");
  // completo: a ponte disse que o resumo conta o pedido inteiro e nada mudou aqui; senão, a tela só oferece Negar.
  // Na pergunta: o resumo é o texto dela (quando o agente o dá) e via, por onde a resposta chega (maestri ou opencode)
  function pedido(p, ate, local) {
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !ID_PEDIDO.test(p.id) || !texto(p.morador_id, 200) || !Number.isFinite(ate)) return null;
    const ferramenta = visivel(p.ferramenta, 80), resumo = visivel(p.resumo, 300), pergunta = p.tipo === "pergunta";
    return { id: p.id, morador: texto(p.morador_id, 200), tipo: pergunta ? "pergunta" : "permissao", ferramenta, resumo,
      via: pergunta ? (p.via === "opencode" ? "opencode" : "maestri") : "",
      completo: !pergunta && p.completo === true && !!ferramenta && !!resumo && ferramenta === p.ferramenta && resumo === p.resumo,
      ate: Math.min(ate, Date.now() + PRAZO_MAX), local, enviando: false, erro: "" };
  }
  // a resposta de uma pergunta, como a ponte confere (decisao.ValidarTexto): recusa, nunca troca. Só letras, marcas,
  // números, pontuação, símbolos e espaços (nada de quebra de linha, tab, ESC, bidi, largura zero...), sem a barra
  // invertida (o maestri lê \n e \e como teclas), sem começar com "-", até 1000 caracteres; sem os espaços das pontas. null: recusada
  const MAX_TEXTO = 1000, PROIBIDO = /[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]|\\/u;
  const textoResposta = v => { if (typeof v !== "string" || [...v].length > MAX_TEXTO || PROIBIDO.test(v)) return null; const t = v.trim(); return t && !t.startsWith("-") ? t : null; };
  const AVISO_TEXTO = "Uma linha só, até 1000 caracteres, sem começar com hífen, sem barra invertida nem caracteres invisíveis.";
  const RECUSAS = { texto: AVISO_TEXTO, estado: "O terminal não está mais esperando uma resposta.",
    encerrado: "Essa pergunta já foi respondida ou venceu.", limite: "Respostas demais; espere um pouco." };
  function guardarPedido(p) {
    if (!p || p.ate <= Date.now() || (!st.pendentes.has(p.id) && st.pendentes.size >= MAX_PEND)) return false;
    const antes = st.pendentes.get(p.id);
    st.pendentes.set(p.id, antes ? { ...p, enviando: antes.enviando, erro: antes.erro } : p);
    return !antes;
  }
  function esquecerPedidos(local) {
    let tirou = false;
    for (const [id, p] of st.pendentes) if (p.local === local) { st.pendentes.delete(id); tirou = true; }
    return tirou;
  }
  // a página só se diz "atendendo" à ponte local se quem está nela decide e ela está visível
  function atender() {
    if (st.decide && st.ws && st.ws.readyState === 1 && !document.hidden) { try { st.ws.send('{"v":1,"tipo":"atender"}'); } catch (e) { /* caiu */ } }
  }
  // responde a pergunta id; true: foi (o "resolvido" ou a recusa chegam depois, pelo /ws, no pedido local)
  async function responder(id, valor) {
    const p = st.pendentes.get(id);
    if (!p || p.tipo !== "pergunta" || p.enviando) return false;
    const t = textoResposta(valor);
    if (!t) { p.erro = AVISO_TEXTO; mudou(); return false; }
    p.enviando = true; p.erro = ""; mudou();
    if (p.local) {
      if (st.ws && st.ws.readyState === 1) { try { st.ws.send(JSON.stringify({ v: 1, tipo: "responder", id, texto: t })); return true; } catch (e) { /* cai abaixo */ } }
      p.enviando = false; p.erro = "A ponte deste computador não respondeu."; mudou(); return false;
    }
    let ok = false;
    try {
      const url = window.Andar ? Andar.com("api/ponte/decidir") : "api/ponte/decidir";
      const r = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, acao: "responder", texto: t }) });
      const d = r.ok ? {} : await r.json().catch(() => ({}));
      ok = r.ok;
      if (r.ok || r.status === 410) st.pendentes.delete(id);
      else { p.enviando = false; p.erro = r.status === 429 ? RECUSAS.limite : r.status === 400 ? AVISO_TEXTO : r.status === 409 && d.erro === "estado" ? RECUSAS.estado : "Não deu certo agora. Responda no terminal."; }
    } catch (e) { p.enviando = false; p.erro = "Sem conexão com o servidor."; }
    mudou();
    return ok;
  }
  async function decidir(id, acao) {
    const p = st.pendentes.get(id);
    if (!p || p.tipo !== "permissao" || p.enviando || (acao !== "permitir" && acao !== "negar") || (acao === "permitir" && !p.completo)) return;
    p.enviando = true; p.erro = ""; mudou();
    if (p.local) {
      if (st.ws && st.ws.readyState === 1) { try { st.ws.send(JSON.stringify({ v: 1, tipo: "decidir", id, acao })); return; } catch (e) { /* cai abaixo */ } }
      p.enviando = false; p.erro = "A ponte deste computador não respondeu."; mudou(); return;   // o "resolvido" tira o pedido
    }
    try {
      const url = window.Andar ? Andar.com("api/ponte/decidir") : "api/ponte/decidir";
      const r = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, acao }) });
      if (r.ok || r.status === 410) st.pendentes.delete(id);   // 410: já respondido (no terminal, por outra pessoa) ou venceu
      else { p.enviando = false; p.erro = r.status === 429 ? "Respostas demais; espere um pouco." : r.status === 409 ? "Só dá para negar daqui; para permitir, responda no terminal." : "Não deu certo agora. Responda no terminal."; }
    } catch (e) { p.enviando = false; p.erro = "Sem conexão com o servidor."; }
    mudou();
  }
  function receber(d) {
    if (!d || typeof d !== "object" || d.v !== 1) return;
    if (d.tipo === "pendente") {
      const p = pedido(d.pendente, d.pendente && typeof d.pendente.expira_em === "string" ? Date.parse(d.pendente.expira_em) : NaN, true);
      if (guardarPedido(p)) mudou();
      return;
    }
    if (d.tipo === "resolvido") { if (typeof d.id === "string" && st.pendentes.delete(d.id)) mudou(); return; }
    if (d.tipo === "recusado") {   // a ponte recusou a resposta deste navegador: o motivo aparece no pedido
      const p = typeof d.id === "string" && st.pendentes.get(d.id);
      if (p) { p.enviando = false; p.erro = RECUSAS[d.motivo] || "Não deu certo agora. Responda no terminal."; mudou(); }
      return;
    }
    if (d.tipo === "snapshot" && Array.isArray(d.moradores)) { guardarSnapshot(d); mudou(); }
    else if (d.tipo === "dia") { guardarDia(d.eventos); mudou(); }
    else if (d.tipo === "morador") {
      const t = terminal(d.morador), antes = t && st.moradores.get(t.id);
      if (t && (antes || st.moradores.size < MAX)) {
        if (!antes || antes.estado !== t.estado || antes.atividade !== t.atividade) anotar(t.id, Date.now(), t.estado, t.atividade);   // a linha do dia segue viva
        st.moradores.set(t.id, t); mudou();
      }
    } else if (d.tipo === "saiu" && st.moradores.delete(texto(d.id, 200))) mudou();
  }

  function situar(s) { if (st.situacao !== s) { st.situacao = s; mostrar(); } }
  function conectar() {
    clearTimeout(st.timer); st.timer = 0;
    if (!st.token || st.ws) return;
    let ws;
    try { ws = new WebSocket(URL_PONTE, [PROTOCOLO, "token." + st.token]); } catch (e) { return religar(); }
    st.ws = ws; situar(st.falhas ? st.situacao : "conectando");
    ws.onopen = () => { st.falhas = 0; st.servidor = false; st.srvLido = ""; esquecerPedidos(false); situar("ligada"); atender(); };   // o snapshot local vem a seguir
    ws.onmessage = e => { if (typeof e.data === "string" && e.data.length < 4 << 20) { try { receber(JSON.parse(e.data)); } catch (x) { /* ignora */ } } };
    ws.onclose = () => {
      if (st.ws !== ws) return;
      st.ws = null;
      if (esquecerPedidos(true)) mudou();   // os pedidos da ponte local saem (o terminal segue com o dele)
      if (!st.servidor && esquecer()) mudou();   // ponte caiu: os terminais saem do mapa (os do espelho ficam)
      religar(); lerServidor();
    };
  }
  function religar() {
    if (!st.token) return;
    st.falhas++; situar("sem-ponte");
    const espera = Math.min(ESPERA_MAX, ESPERA_MIN * 2 ** Math.min(st.falhas - 1, 5));
    st.timer = setTimeout(conectar, document.hidden ? Math.max(espera, 30000) : espera);
  }
  function desligar() {
    clearTimeout(st.timer); st.timer = 0; st.falhas = 0;
    const ws = st.ws; st.ws = null; if (ws) ws.close();
    esquecerPedidos(true);
    if (!st.servidor && esquecer()) mudou();
    situar("desligada"); lerServidor();
  }
  // ---------- espelho: a ponte de outra máquina, pelo servidor ------------------------------------------------
  // os pedidos do espelho: o servidor diz quantos segundos faltam (o relógio do celular pode estar errado)
  function pedidosDoServidor(lista) {
    const vistos = new Set();
    let mudouAlgo = false;
    for (const x of Array.isArray(lista) ? lista.slice(0, MAX_PEND) : []) {
      const resta = x && Number.isFinite(x.resta_s) ? Math.max(0, Math.min(600, x.resta_s)) : NaN;
      const p = pedido(x, Date.now() + resta * 1000, false);
      if (!p) continue;
      vistos.add(p.id);
      if (guardarPedido(p)) mudouAlgo = true;
    }
    for (const [id, p] of st.pendentes) if (!p.local && !vistos.has(id) && !p.enviando) { st.pendentes.delete(id); mudouAlgo = true; }
    return mudouAlgo;
  }
  function aplicarServidor(d) {
    if (d && typeof d === "object" && typeof d.espelho === "string" && d.espelho !== st.espelho) { st.espelho = d.espelho; mostrarEspelho(); }
    if (d && typeof d === "object") {
      const decide = d.decidir === true;
      if (decide !== st.decide) { st.decide = decide; atender(); mudou(); }
    }
    if (!d || d.ativo !== true || !Array.isArray(d.moradores) || st.situacao === "ligada") {
      if (esquecerPedidos(false)) mudou();
      if (st.servidor) { st.servidor = false; st.srvLido = ""; if (esquecer()) mudou(); mostrar(); }
      return false;
    }
    if (pedidosDoServidor(st.decide ? d.pendentes : [])) mudou();
    const lido = JSON.stringify([d.moradores, d.workspaces, d.dia]);   // sem a idade: só o que muda a tela
    if (lido !== st.srvLido || !st.servidor) {
      st.srvLido = lido; guardarSnapshot(d); guardarDia(d.dia);
      if (!st.servidor) { st.servidor = true; mostrar(); }
      mudou();
    }
    return true;
  }
  async function lerServidor() {
    clearTimeout(st.srvTimer); st.srvTimer = 0;
    atender();   // a cada volta (no máximo 30 s): a ponte local conta 60 s
    let espera = SRV_PARADO;
    if (st.situacao !== "ligada" && !(window.Brincar && Brincar.demo)) {
      try {
        const r = await fetch(window.Andar ? Andar.com(URL_SRV) : URL_SRV, { cache: "no-store", credentials: "same-origin" });
        const texto = r.ok ? await r.text() : "";
        if (!r.ok || texto.length > 4 << 20) { espera = SRV_ERRO; aplicarServidor(null); }
        else if (aplicarServidor(JSON.parse(texto))) espera = SRV_ATIVO;
      } catch (e) { espera = SRV_ERRO; }
    }
    clearTimeout(st.srvTimer);
    st.srvTimer = setTimeout(lerServidor, document.hidden ? Math.max(espera, 30000) : espera);
  }

  function ligar(token) { desligar(); st.token = token; gravarToken(token); conectar(); }

  // ---------- Personalizar > Ponte local ----------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const SITUACOES = {
    desligada: ["Desligada. Cole o token para ver os terminais deste computador no mapa.", ""],
    conectando: ["Procurando a ponte em 127.0.0.1…", ""],
    ligada: ["Ligada: os terminais deste computador estão no mapa.", "ok"],
    "sem-ponte": ["A ponte não respondeu. Ela está rodando? Se o token ou o endereço mudou, rode o comando acima de novo. Tentando de novo sozinho.", "ruim"],
    servidor: ["Pelo servidor: os terminais da máquina com o espelho ligado estão no mapa.", "ok"] };
  const situacao = () => (st.situacao !== "ligada" && st.servidor ? "servidor" : st.situacao);
  function mostrar() {
    const a = $("pt-estado"); if (!a) return;
    const s = situacao(), [t, tipo] = SITUACOES[s] || SITUACOES.desligada;
    const n = st.moradores.size;
    a.textContent = (s === "ligada" || s === "servidor") && n ? `${t} Agora: ${n} ${n === 1 ? "terminal" : "terminais"}.` : t;
    a.className = "aviso-form" + (tipo ? ` ${tipo}` : "");
    $("pt-desligar").hidden = !st.token;
    $("pt-ligar").textContent = st.token ? "Trocar token" : "Ligar";
  }
  function montarCartao() {
    const form = $("form-ponte"); if (!form) return;
    $("pt-comando").textContent = `ponte setup --aplicar --origem ${location.origin}`;
    form.addEventListener("submit", e => {
      e.preventDefault();
      const t = $("pt-token").value.trim().toLowerCase();
      if (!tokenOk(t)) { const a = $("pt-estado"); a.textContent = "O token tem 64 letras e números (0 a 9, a a f). Copie de novo do terminal."; a.className = "aviso-form ruim"; $("pt-token").focus(); return; }
      $("pt-token").value = ""; ligar(t);
    });
    $("pt-desligar").addEventListener("click", () => { desligar(); st.token = ""; gravarToken(""); $("pt-token").focus(); });
    window.addEventListener("ponte", mostrar);
    mostrar();
    if (!$("pt-espelho")) return;
    $("pt-esp-gerar").addEventListener("click", () => {
      if (st.espelho === "tela" && !confirm("A chave atual para de valer na hora. Gerar outra?")) return;
      pedirChave("gerar");
    });
    $("pt-esp-desligar").addEventListener("click", () => { if (confirm("Desligar o espelho? A ponte da outra máquina para de aparecer.")) pedirChave("desligar"); });
  }
  // o admin do prédio gera a chave do espelho; o comando com a chave aparece só nesta resposta, nunca de novo
  const ESPELHOS = { variavel: "Ligado pela variável ESCRITORIO_PONTE_CHAVE do servidor: a chave fica com quem administra o servidor.",
    tela: "Ligado. Gerar outra chave faz a atual parar de valer na hora.", "": "Desligado. Gere a chave e rode o comando na máquina dos terminais." };
  function mostrarEspelho(aviso, tipo) {
    const caixa = $("pt-espelho"); if (!caixa) return;
    caixa.hidden = st.espelho === null;
    const a = $("pt-esp-estado");
    a.textContent = aviso || ESPELHOS[st.espelho] || ""; a.className = "aviso-form" + (tipo ? ` ${tipo}` : "");
    $("pt-esp-gerar").hidden = st.espelho === "variavel";
    $("pt-esp-gerar").textContent = st.espelho === "tela" ? "Gerar outra chave" : "Gerar chave";
    $("pt-esp-desligar").hidden = st.espelho !== "tela";
  }
  async function pedirChave(acao) {
    const cmd = $("pt-esp-comando");
    try {
      const r = await fetch("api/ponte/chave", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return mostrarEspelho(typeof d.mensagem === "string" ? d.mensagem.slice(0, 200) : "Não deu certo agora.", "ruim");
      st.espelho = typeof d.espelho === "string" ? d.espelho : st.espelho;
      cmd.textContent = typeof d.comando === "string" ? d.comando.slice(0, 400) : ""; cmd.hidden = !cmd.textContent;
      const ch = $("pt-esp-chave"), rot = $("pt-esp-chave-rot");   // a chave fica fora do comando: não vai ao histórico do shell
      ch.textContent = typeof d.chave === "string" && /^[0-9a-f]{64}$/.test(d.chave) ? d.chave : ""; ch.hidden = rot.hidden = !ch.textContent;
      mostrarEspelho(cmd.textContent ? "Rode isto na máquina dos terminais (a chave aparece só agora; não mande para ninguém):" : "", "ok");
      if (!cmd.textContent) mostrarEspelho();
    } catch (e) { mostrarEspelho("Sem conexão com o servidor.", "ruim"); }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    atender();
    if (st.token && !st.ws && st.falhas) { st.falhas = 1; conectar(); }
    if (st.servidor) lerServidor();
  });
  function iniciar() {
    montarCartao();
    st.token = lerToken();   // também na demonstração: a ponte é deste computador, não o servidor
    if (st.token) conectar();
    lerServidor();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();

  const ws = id => st.workspaces.get(id);
  return { terminais: () => [...st.moradores.values()], versao: () => st.v, situacao,
    // responder pelo escritório: os pedidos ainda no prazo de um terminal, se quem está aqui decide
    podeDecidir: () => st.decide,
    pendentes: id => (st.decide ? [...st.pendentes.values()].filter(p => p.morador === id && p.ate > Date.now()).map(p => ({ ...p })) : []),
    decidir, responder, textoResposta, MAX_TEXTO,
    dia: id => (st.dia.get(id) || []).map(e => ({ ...e })),
    workspace: id => (ws(id) ? ws(id).nome : ""), band: (wsId, bandId) => (ws(wsId) && ws(wsId).bands.get(bandId)) || "",
    // as salas em uso: o nome do workspace de cada terminal vivo, sem repetir (as bands costumam ter nome genérico, "Banda #2")
    bands: () => [...new Set([...st.moradores.values()].map(m => (ws(m.workspace) ? ws(m.workspace).nome : "")).filter(Boolean))] };
})();
window.Ponte = Ponte;
