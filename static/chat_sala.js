"use strict";
// Chat da sala (B2): o painel de texto da sala onde a pessoa está no escritório. Não faz polling: o vida.js dispara no
// window "aovivo" (detail = resposta do /api/ao-vivo) a cada leitura e "minha-sala" (detail {sala, nome, andar}) quando a
// minha sala muda; {sala: null, nome: null} ao trocar de andar, ligar a TV ou desligar "Aparecer" (o painel fecha e limpa).
// O seq do evento é o da entrada na sala: mensagem de seq menor é da sala de antes (um GET atrasado) e fica de fora. O envio vai para POST /api/sala/enviar?andar=<id> {texto}; quem decide a sala é o servidor. Quem chega numa
// sala não vê o que foi dito antes: trocar de sala ou de andar limpa o painel. Nome e texto só por textContent.
const ChatSala = (() => {
  const TEXTO_MAX = 500, GUARDAR = 50;   // o servidor guarda 50 por sala; o painel não precisa de mais
  // o detail do "minha-sala" como o painel usa: com sala e nome, há chat; sem um dos dois (corredor, null), não há
  function daSala(d) {
    const sala = d && typeof d.sala === "string" ? d.sala : "", nome = d && typeof d.nome === "string" ? d.nome.trim() : "";
    return sala && nome ? { sala, nome } : { sala: "", nome: "" };
  }
  // o texto como o servidor vai aceitar (presenca.limpar_texto): sem controle nem invisível, só a quebra de linha
  const limpar = t => String(t).replace(/\r\n/g, "\n").replace(/(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu, "").trim();
  function validar(texto) {   // mensagem do problema, ou null
    const limpo = limpar(texto);
    if (!limpo) return "Escreva a mensagem.";
    if ([...limpo].length > TEXTO_MAX) return `A mensagem passa de ${TEXTO_MAX} caracteres.`;
    return null;
  }
  // quem sou eu nas mensagens: o "eu" do /api/ao-vivo (no saguão, um id opaco no lugar do login); servidor sem o "eu", o
  // login da sessão. O "usuario" das mensagens é só chave: nunca vai para a tela
  const euDe = (d, login) => (d && typeof d.eu === "string" && d.eu ? d.eu : typeof login === "string" ? login : null);
  const deMim = (m, eu) => !!m && typeof m.usuario === "string" && eu != null && m.usuario === eu;
  // as mensagens que ainda não estão no painel, em ordem de seq (a leitura repete o que já veio e o envio já pôs a minha),
  // a partir do seq em que entrei na sala
  function novas(mensagens, vistos, desde = 0) {
    if (!Array.isArray(mensagens)) return [];
    return mensagens.filter(m => m && Number.isInteger(m.seq) && m.seq >= desde && !vistos.has(m.seq) && typeof m.texto === "string")
      .sort((a, b) => a.seq - b.seq);
  }


  // ---- 1.6: o painel de conversa da equipe. Os limites são os do store (conversas_equipe.py)
  const SALA_MAX = 80, ANEXO_MAX = 25 * 1024 * 1024, NOME_ARQUIVO_MAX = 120, SUGESTOES = 6;
  const EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏", "👀"];
  const IMAGENS = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);   // só estas aparecem em <img>
  const canalDaSala = s => (typeof s === "string" && s.length >= 1 && s.length <= SALA_MAX ? `sala:${s}` : "");
  // o histórico na tela: junta por id em ordem; a versão que chegou depois (apagada, reação nova) troca a de antes
  function mesclar(atuais, chegaram) {
    const porId = new Map(atuais.map(m => [m.id, m]));
    for (const m of Array.isArray(chegaram) ? chegaram : []) if (m && Number.isInteger(m.id)) porId.set(m.id, m);
    return [...porId.values()].sort((a, b) => a.id - b.id);
  }
  const maisAntiga = ms => (ms.length ? ms[0].id : null);
  // menção: o "@termo" que está sendo escrito logo antes do cursor (no começo ou depois de espaço), ou null
  function mencaoEmCurso(texto, cursor) {
    const m = /(^|\s)@([a-z0-9._-]*)$/i.exec(String(texto).slice(0, cursor));
    return m ? { inicio: m.index + m[1].length, termo: m[2] } : null;
  }
  const semAcento = t => String(t).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // quem sugerir: só da lista do andar que o servidor deu, sem mim; casa o começo do login ou de uma palavra do nome
  function sugestoes(termo, pessoas, eu, max = SUGESTOES) {
    const t = semAcento(termo);
    return (Array.isArray(pessoas) ? pessoas : []).filter(p => p && typeof p.usuario === "string" && p.usuario !== eu &&
      (p.usuario.startsWith(t) || semAcento(typeof p.nome === "string" ? p.nome : "").split(/\s+/).some(w => w.startsWith(t)))).slice(0, max);
  }
  function completarMencao(texto, inicio, cursor, usuario) {
    const antes = `${texto.slice(0, inicio)}@${usuario} `;
    return { texto: antes + texto.slice(cursor), cursor: antes.length };
  }
  // o texto em pedaços para o textContent: "@login" de alguém do andar vira destaque
  function partes(texto, logins) {
    const saida = [], re = /(^|\s)@([a-z0-9][a-z0-9._-]{1,30}[a-z0-9])/g;   // o login termina em letra ou número: "@ana." não leva o ponto
    let de = 0, m;
    while ((m = re.exec(texto))) {
      const ini = m.index + m[1].length, fim = ini + 1 + m[2].length;
      if (!logins.has(m[2])) continue;
      if (ini > de) saida.push({ texto: texto.slice(de, ini) });
      saida.push({ texto: texto.slice(ini, fim), mencao: m[2] });
      de = fim;
    }
    if (de < texto.length || !saida.length) saida.push({ texto: texto.slice(de) });
    return saida;
  }
  function tamanho(b) {
    const un = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (b >= 1024 && i < un.length - 1) { b /= 1024; i++; }
    return `${i ? String(Math.round(b * 10) / 10).replace(".", ",") : b} ${un[i]}`;
  }
  function conferirArquivo(f) {   // o que dá para dizer antes de subir; o tipo quem decide é o servidor, pelos bytes
    if (!f || !f.size) return "O arquivo está vazio.";
    if (f.size > ANEXO_MAX) return "O arquivo passa de 25 MB.";
    if (typeof f.name !== "string" || !f.name || f.name.length > NOME_ARQUIVO_MAX) return "O nome do arquivo passa de 120 caracteres.";
    return null;
  }
  const ehImagem = t => IMAGENS.has(t);
  function alternarReacao(reacoes, emoji) {   // a minha liga ou desliga já; a próxima leitura traz a contagem de verdade
    const r = reacoes.map(x => ({ ...x })), achou = r.find(x => x.emoji === emoji);
    if (!achou) return [...r, { emoji, n: 1, eu: true }];
    achou.n += achou.eu ? -1 : 1; achou.eu = !achou.eu;
    return r.filter(x => x.n > 0);
  }
  const prazo = dias => (!Number.isInteger(dias) || dias >= 365 ? "1 ano" : `${dias} dias`);
  const textoRetencao = dias => `As mensagens ficam guardadas por ${prazo(dias)}.`;
  // a sala do andar e o Geral do saguão ficam guardados e quem chega lê o que foi dito antes: o aviso fixo no canal
  const avisoHistorico = (dias, predio) => `Esta conversa fica guardada por ${prazo(dias)} e todo o ${predio ? "prédio" : "andar"} pode ler.`;
  const avisoDM = empresa => `As mensagens diretas ${empresa ? `da ${empresa}` : "desta empresa"} podem ser lidas pela administração da empresa.`;
  const data = em => { const d = new Date(em); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { timeZone: "UTC" }); };
  function linhaAcessos(datas) {   // D10: as duas pontas veem quando a administração abriu a DM (as 3 últimas)
    const ds = (Array.isArray(datas) ? datas : []).map(data).filter(Boolean).slice(-3);
    if (!ds.length) return "";
    const lista = ds.length === 1 ? ds[0] : `${ds.slice(0, -1).join(", ")} e ${ds[ds.length - 1]}`;
    return `A administração da empresa abriu esta conversa em ${lista}.`;
  }
  function hora(em) {
    const d = new Date(em);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const contagem = n => (!n ? "" : n > 9 ? "9+" : String(n));
  // as abas do painel pelo config.equipe: sem DM (o saguão) só o Geral; num andar, Geral, a sala onde estou e Diretas
  // (quem só lê, o admin do prédio no andar de uma empresa, fica sem Diretas)
  function abas(eq, onde) {
    const saida = [{ id: "geral", rotulo: "Geral" }], canal = canalDaSala(onde && onde.sala);
    if (!eq || !eq.dm) return saida;
    if (canal && onde.nome) saida.push({ id: canal, rotulo: onde.nome });
    return eq.pode_escrever === false ? saida : [...saida, { id: "diretas", rotulo: "Diretas" }];
  }
  // o que a vista mostra: escrever só num canal e só para quem pode (pode_escrever); anexo e menção conforme o
  // config.equipe (o saguão não tem); menção não faz sentido na DM; o botão da auditoria só na lista de Diretas e só para
  // o admin do andar
  function controles(eq, vista) {
    const e = eq || {}, canal = (vista === "geral" || vista.startsWith("sala:") || vista.startsWith("dm:")) && e.pode_escrever !== false;
    return { escrever: canal, anexar: canal && !!e.anexo, mencionar: canal && !!e.mencao && !vista.startsWith("dm:"),
      auditoria: vista === "diretas" && !!e.auditoria };
  }
  const puro = { abas, controles, daSala, validar, limpar, novas, euDe, deMim, TEXTO_MAX, EMOJIS, canalDaSala, mesclar, maisAntiga, mencaoEmCurso,
    sugestoes, completarMencao, partes, tamanho, conferirArquivo, ehImagem, alternarReacao, textoRetencao, avisoHistorico, avisoDM, linhaAcessos, contagem };

  if (typeof document === "undefined") return puro;

  const criar = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  };
  const sensivel = e => { e.setAttribute("data-sensivel", ""); return e; };   // nome e texto: o modo apresentação (apresentacao.js) esconde
  const urlAnexo = (andar, id, baixar, auditoria) => Andar.com(`api/anexo?id=${id}${baixar ? "&baixar=1" : ""}${auditoria ? "&auditoria=1" : ""}`, andar);
  // uma mensagem do store na tela. ctx: {eu, logins (Set do andar), andar, moderar (admin do andar: apaga em canal, nunca em DM),
  // ler (sem reagir nem apagar: a auditoria e o admin do prédio no andar de uma empresa), auditoria (o anexo da DM lido pela administração)}
  function elMensagem(m, ctx) {
    const mim = deMim(m, ctx.eu), li = criar("li", "chat-sala-msg" + (mim ? " de-mim" : "") + (m.apagada ? " apagada" : ""));
    li.dataset.id = String(m.id);
    const cabeca = criar("p", "chat-sala-cabeca"), quando = criar("time", null, hora(m.em));
    if (typeof m.em === "string") quando.dateTime = m.em;
    cabeca.append(sensivel(criar("strong", null, mim ? "Você" : (typeof m.nome === "string" && m.nome ? m.nome : "Alguém"))), quando);
    li.append(cabeca);
    if (m.apagada) { li.append(criar("p", "chat-sala-texto", "Mensagem apagada.")); return li; }
    if (typeof m.texto === "string" && m.texto) {
      const p = sensivel(criar("p", "chat-sala-texto"));
      for (const parte of partes(m.texto, ctx.eu ? new Set([...ctx.logins, ctx.eu]) : ctx.logins))   // a lista do andar vem sem mim
        p.append(parte.mencao ? criar("span", "chat-sala-mencao" + (parte.mencao === ctx.eu ? " a-mim" : ""), parte.texto) : parte.texto);
      li.append(p);
    }
    if (m.anexo && Number.isInteger(m.anexo.id)) li.append(elAnexo(m.anexo, ctx.andar, ctx.auditoria));
    if (ctx.ler) return li;   // só lê
    const reacoes = criar("div", "chat-sala-reacoes");
    for (const r of Array.isArray(m.reacoes) ? m.reacoes : []) {
      const b = criar("button", "chat-sala-reacao", `${r.emoji} ${r.n}`);
      b.type = "button"; b.dataset.emoji = r.emoji;
      b.setAttribute("aria-pressed", String(!!r.eu));
      b.setAttribute("aria-label", `${r.emoji}: ${r.n} ${r.n === 1 ? "reação" : "reações"}${r.eu ? ", inclusive a sua" : ""}`);
      reacoes.append(b);
    }
    const acoes = criar("div", "chat-sala-acoes"), reagir = criar("button", "chat-sala-reagir", "Reagir");
    reagir.type = "button"; reagir.setAttribute("aria-haspopup", "true");
    acoes.append(reagir);
    if (mim || (ctx.moderar && !String(m.canal).startsWith("dm:"))) {
      const apagar = criar("button", "chat-sala-apagar", "Apagar");
      apagar.type = "button";
      acoes.append(apagar);
    }
    li.append(reacoes, acoes);
    return li;
  }
  // imagem (só os 4 tipos) aparece; todo o resto é nome, tamanho e "Baixar" (o servidor manda como attachment). Na
  // auditoria, só o "Baixar": cada carga do anexo grava uma linha no registro, e a lista é redesenhada a cada leitura
  function elAnexo(a, andar, auditoria) {
    const caixa = sensivel(criar("div", "chat-sala-anexo")), nome = typeof a.nome === "string" ? a.nome : "arquivo";
    if (ehImagem(a.tipo) && !auditoria) {
      const img = criar("img", "chat-sala-previa"), src = urlAnexo(andar, a.id);
      img.src = src; img.alt = nome; img.loading = "lazy"; img.decoding = "async";
      img.addEventListener("error", () => {   // o 429 do teto ou a rede: tenta de novo uma vez só
        if (img.dataset.denovo) return;
        img.dataset.denovo = "1"; setTimeout(() => { img.src = src; }, 1500);
      });
      caixa.append(img);
    }
    const info = criar("p", "chat-sala-arquivo");
    info.append(criar("span", "chat-sala-arquivo-nome", nome), criar("span", "chat-sala-arquivo-tam", Number.isInteger(a.tamanho) ? tamanho(a.tamanho) : ""));
    const baixar = criar("a", "chat-sala-baixar", "Baixar");
    baixar.href = urlAnexo(andar, a.id, true, auditoria); baixar.setAttribute("download", "");
    baixar.setAttribute("aria-label", `Baixar ${nome}`);
    caixa.append(info, baixar);
    return caixa;
  }

  // ---- na página. Do index.html vêm a caixa, a pílula e o painel do chat da sala. Com o store desligado (config.equipe
  // null) o painel é o chat da sala de sempre; ligado, vira o painel de conversa da equipe, montado aqui dentro do mesmo
  // <section>. Quem decide é o primeiro /api/config: os dois modos não convivem na mesma página.
  const $ = id => document.getElementById(id);
  const caixa = $("chat-sala"), abrir = $("chat-sala-abrir"), painel = $("chat-sala-painel"), contador = $("chat-sala-n");
  if (!caixa) return { ...puro, elMensagem };
  const tv = () => !!(window.TV && TV.invisivel) || document.body.classList.contains("tv");
  const cfg = () => (typeof config !== "undefined" ? config : null);   // app.js
  const login = () => (typeof estado !== "undefined" && estado && typeof estado.usuario === "string" ? estado.usuario : null);   // app.js
  let euAoVivo = null;   // o "eu" da última leitura do /api/ao-vivo (no saguão, o id opaco)
  const eu = () => euDe({ eu: euAoVivo }, login());
  const aberto = () => !painel.hidden;

  // ======== o chat da sala de sempre (store desligado): só na memória, só quem está na sala
  function classico() {
    const titulo = $("chat-sala-titulo"), lista = $("chat-sala-lista"), vazio = $("chat-sala-vazio"), form = $("chat-sala-form"),
      campo = $("chat-sala-campo"), enviar = $("chat-sala-enviar"), aviso = $("chat-sala-aviso"), fechar = $("chat-sala-fechar");
    let sala = "", nomeSala = "", andar = "", desde = 0, vistos = new Set(), naoLidas = 0, enviando = false, avisoTempo = 0;

    function mostrarAviso(texto, ruim = true) {
      clearTimeout(avisoTempo);
      aviso.textContent = texto; aviso.classList.toggle("ruim", ruim); aviso.hidden = !texto;
      if (texto && !ruim) avisoTempo = setTimeout(() => mostrarAviso(""), 4000);
    }
    function contar() {
      contador.textContent = naoLidas > 9 ? "9+" : String(naoLidas);
      contador.hidden = !naoLidas || aberto();
      abrir.setAttribute("aria-label", naoLidas && !aberto() ? `Chat da sala ${nomeSala}, ${naoLidas} mensagens novas` : `Chat da sala ${nomeSala}`);
    }
    function esvaziar() {   // quem chega não vê histórico
      vistos = new Set(); naoLidas = 0; lista.replaceChildren(); vazio.hidden = false; mostrarAviso(""); contar();
    }
    function por(m, minha = false) {
      vistos.add(m.seq);
      const mim = minha || deMim(m, eu());
      const li = document.createElement("li"), cabeca = document.createElement("p"), quem = document.createElement("strong"),
        quando = document.createElement("time"), texto = document.createElement("p");
      li.className = "chat-sala-msg" + (mim ? " de-mim" : "");
      cabeca.className = "chat-sala-cabeca"; texto.className = "chat-sala-texto";
      quem.textContent = mim ? "Você" : (typeof m.nome === "string" && m.nome ? m.nome : "Alguém");
      quando.textContent = hora(m.em); if (typeof m.em === "string") quando.dateTime = m.em;
      texto.textContent = m.texto;
      quem.setAttribute("data-sensivel", ""); texto.setAttribute("data-sensivel", "");
      cabeca.append(quem, quando); li.append(cabeca, texto);
      const noFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
      lista.append(li);
      while (lista.children.length > GUARDAR) lista.firstElementChild.remove();
      vazio.hidden = true;
      if (noFim || mim) lista.scrollTop = lista.scrollHeight;
      if (!mim && !aberto()) naoLidas++;
    }
    function atualizar() {   // sem sala (corredor), na TV ou no modo foto o painel some
      const pode = !!sala && !tv();
      caixa.hidden = !pode;
      if (!pode) { painel.hidden = true; abrir.hidden = false; abrir.setAttribute("aria-expanded", "false"); return; }
      titulo.textContent = nomeSala;
      contar();
    }
    function abrirPainel() {
      painel.hidden = false; abrir.setAttribute("aria-expanded", "true"); abrir.hidden = true;
      naoLidas = 0; contar(); lista.scrollTop = lista.scrollHeight; campo.focus();
    }
    function fecharPainel(focar = true) {
      painel.hidden = true; abrir.setAttribute("aria-expanded", "false"); abrir.hidden = false; contar();
      if (focar) abrir.focus();
    }
    async function mandar() {
      if (enviando) return;
      const problema = validar(campo.value);
      if (problema) { mostrarAviso(problema); campo.focus(); return; }
      enviando = true; enviar.disabled = true;
      const texto = limpar(campo.value), salaDoEnvio = sala, andarDoEnvio = andar;
      let r = null, d = null;
      try {
        r = await fetch(Andar.com("api/sala/enviar", andarDoEnvio || Andar.atual), { method: "POST", cache: "no-store", credentials: "same-origin",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto }) });
        d = await r.json().catch(() => null);
      } catch (e) { r = null; }
      enviando = false; enviar.disabled = false;
      if (r && r.status === 401) { location.href = "/entrar"; return; }
      if (!r) { mostrarAviso("Sem conexão. A mensagem não foi."); return; }
      if (r.status === 429) { mostrarAviso("Devagar: espere um segundo para mandar outra."); return; }
      if (!r.ok) { mostrarAviso(d && typeof d.mensagem === "string" ? d.mensagem : `Não deu para mandar (HTTP ${r.status}).`); return; }
      campo.value = ""; mostrarAviso("");
      // a minha aparece já; a próxima leitura do /api/ao-vivo traz a mesma (pelo seq) e não repete
      if (sala === salaDoEnvio && andar === andarDoEnvio && d && Number.isInteger(d.seq) && !vistos.has(d.seq))
        por({ seq: d.seq, texto, em: new Date().toISOString() }, true);
      contar();
    }
    function minhaSala(d) {
      const nova = daSala(d), novoAndar = typeof d.andar === "string" ? d.andar : "";
      if (nova.sala === sala && novoAndar === andar) { if (nova.nome !== nomeSala) { nomeSala = nova.nome; atualizar(); } return; }
      const estavaAberto = aberto() && caixa.contains(document.activeElement);
      sala = nova.sala; nomeSala = nova.nome; andar = novoAndar; desde = Number.isInteger(d.seq) && d.seq > 0 ? d.seq : 0;
      esvaziar(); atualizar();
      if (estavaAberto && caixa.hidden) $("tela")?.focus();   // o foco não fica perdido num painel que sumiu
    }
    function aoVivo(d) {
      if (!sala || tv()) return;
      const chegaram = novas(d.mensagens, vistos, desde);
      for (const m of chegaram) por(m);
      if (chegaram.length) contar();
    }
    abrir.addEventListener("click", abrirPainel);
    fechar.addEventListener("click", () => fecharPainel());
    form.addEventListener("submit", e => { e.preventDefault(); mandar(); });
    campo.addEventListener("input", () => { if (!aviso.hidden && aviso.classList.contains("ruim")) mostrarAviso(""); });
    painel.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); fecharPainel(); } });
    const nada = async () => false;   // sem store não há canal nem DM
    return { minhaSala, aoVivo, atualizar, paraAoVivo: () => "", abrirCanal: nada, abrirDM: nada, abrir: abrirPainel, fechar: fecharPainel };
  }

  // ======== o painel de conversa da equipe (store ligado; contrato da Onda 2)
  function equipe() {
    // as rotas do back: todas aqui, e só aqui
    const ROTAS = {
      historico: (canal, antes) => `api/canal/historico?canal=${encodeURIComponent(canal)}&limite=50${antes ? `&antes=${antes}` : ""}`,
      enviar: "api/canal/enviar", lida: "api/canal/lida", reagir: "api/canal/reagir", apagar: "api/canal/apagar",
      busca: termo => `api/canal/busca?q=${encodeURIComponent(termo)}&limite=20`,
      pessoas: "api/pessoas", dms: "api/dm", abrirDm: "api/dm/abrir", entendi: "api/dm/entendi",
      pares: "api/dm/auditoria/pares", registro: "api/dm/auditoria/registro", auditoria: (canal, antes) => `api/dm/auditoria?canal=${encodeURIComponent(canal)}&limite=50${antes ? `&antes=${antes}` : ""}`,
      anexo: canal => `api/anexo?canal=${encodeURIComponent(canal)}`,
      // o cabeçalho que o back exige nas rotas da auditoria das DMs (o formato final vem do back; muda só aqui)
      cabecalhos: rota => (rota.startsWith("api/dm/auditoria") ? { "X-Escritorio": "1" } : {}),
    };
    const svg = d => {   // ícone de traço, decorativo
      const NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg"), p = document.createElementNS(NS, "path");
      for (const [k, v] of Object.entries({ width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2,
        "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) s.setAttribute(k, v);
      p.setAttribute("d", d); s.append(p);
      return s;
    };
    const botao = (classe, rotulo, icone, texto) => {
      const b = criar("button", classe, texto);
      b.type = "button";
      if (rotulo) b.setAttribute("aria-label", rotulo);
      if (icone) b.prepend(svg(icone));
      return b;
    };
    const atributos = (e, a) => { for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
    const ICONE = { voltar: "M15 6l-6 6 6 6", buscar: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4", fechar: "M6 6l12 12M18 6 6 18",
      enviar: "M4 12 20 4l-6 16-3-7z", anexar: "M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7" };

    // ---- montar
    const ui = {};
    ui.voltar = botao("chat-sala-icone", "Voltar", ICONE.voltar); ui.voltar.hidden = true;
    ui.sobre = criar("p", "chat-sala-sobre", "Conversas da equipe");
    ui.titulo = sensivel(criar("h2", null, "Geral")); ui.titulo.id = "chat-sala-titulo";   // na DM, o nome da pessoa
    const nomes = criar("div"); nomes.append(ui.sobre, ui.titulo);
    ui.buscar = botao("chat-sala-icone", "Buscar nas conversas", ICONE.buscar);
    ui.fechar = botao("chat-sala-icone", "Fechar as conversas", ICONE.fechar);
    // o "Entrar na reunião" da sala aberta (reunioes.js decide se aparece, pelo link da sala); sem o reunioes.js, nada
    ui.entrar = window.Reunioes ? window.Reunioes.entrar("", "") : null;
    const topo = criar("header", "chat-sala-topo"); topo.append(ui.voltar, nomes, ...(ui.entrar ? [ui.entrar] : []), ui.buscar, ui.fechar);
    ui.abas = atributos(criar("nav", "chat-sala-abas"), { "aria-label": "Canais" });
    ui.busca = atributos(criar("form", "chat-sala-busca"), { role: "search" }); ui.busca.hidden = true;
    const rotBusca = criar("label", "oculto", "Buscar nas conversas"); rotBusca.htmlFor = "chat-sala-termo";
    ui.termo = atributos(criar("input"), { enterkeyhint: "search" });
    Object.assign(ui.termo, { id: "chat-sala-termo", type: "search", maxLength: 100, autocomplete: "off", placeholder: "Buscar nas conversas…" });
    ui.busca.append(rotBusca, ui.termo);
    ui.fixo = criar("p", "chat-sala-fixo"); ui.fixo.hidden = true;               // o aviso da DM, o do histórico da sala e o lembrete da auditoria
    ui.registro = criar("p", "chat-sala-registro"); ui.registro.hidden = true;   // D10: quando a administração abriu a DM
    ui.auditar = botao("chat-sala-auditar", null, null, "Auditoria das diretas"); ui.auditar.hidden = true;
    ui.antes = botao("chat-sala-antes", null, null, "Ver mensagens anteriores"); ui.antes.hidden = true;
    ui.vazio = criar("p", "chat-sala-vazio"); ui.vazio.hidden = true;
    ui.lista = sensivel(atributos(criar("ol", "chat-sala-lista"), { "aria-label": "Mensagens" })); ui.lista.tabIndex = 0;
    ui.itens = sensivel(criar("ul", "chat-sala-itens")); ui.itens.hidden = true;
    ui.corpo = criar("div", "chat-sala-corpo"); ui.corpo.append(ui.auditar, ui.antes, ui.vazio, ui.lista, ui.itens);
    ui.retencao = criar("p", "chat-sala-retencao");
    ui.anuncio = atributos(criar("p", "oculto"), { role: "status" });   // a mensagem que chegou, para o leitor de tela
    ui.aviso = atributos(criar("p", "chat-sala-aviso"), { role: "status" }); ui.aviso.hidden = true;
    ui.progresso = criar("div", "chat-sala-progresso"); ui.progresso.hidden = true;
    ui.barraRot = criar("label", null, "Enviando…"); ui.barraRot.htmlFor = "chat-sala-barra";
    ui.barra = criar("progress"); ui.barra.id = "chat-sala-barra"; ui.barra.max = 100; ui.barra.value = 0;
    ui.cancelar = botao("chat-sala-cancelar", null, null, "Cancelar");
    ui.progresso.append(ui.barraRot, ui.barra, ui.cancelar);
    ui.sugestoes = sensivel(atributos(criar("ul", "chat-sala-sugestoes"), { role: "listbox", "aria-label": "Pessoas do andar" }));
    ui.sugestoes.id = "chat-sala-sugestoes"; ui.sugestoes.hidden = true;
    ui.form = criar("form", "chat-sala-form");
    ui.anexar = botao("chat-sala-anexar", "Anexar um arquivo (até 25 MB)", ICONE.anexar);
    ui.arquivo = criar("input"); ui.arquivo.type = "file"; ui.arquivo.hidden = true; ui.arquivo.tabIndex = -1;
    const rotCampo = criar("label", "oculto", "Mensagem"); rotCampo.htmlFor = "chat-sala-campo";
    ui.campo = sensivel(atributos(criar("input"), { enterkeyhint: "send", role: "combobox", "aria-autocomplete": "list", "aria-controls": "chat-sala-sugestoes", "aria-expanded": "false" }));
    Object.assign(ui.campo, { id: "chat-sala-campo", type: "text", maxLength: TEXTO_MAX, autocomplete: "off" });
    ui.enviar = botao("chat-sala-enviar", "Enviar", ICONE.enviar); ui.enviar.type = "submit";
    ui.form.append(ui.anexar, ui.arquivo, rotCampo, ui.campo, ui.enviar);
    ui.emojis = atributos(criar("div", "chat-sala-emojis"), { role: "menu", "aria-label": "Reagir" }); ui.emojis.hidden = true;
    for (const e of EMOJIS) {
      const b = atributos(botao("chat-sala-emoji", `Reagir com ${e}`, null, e), { role: "menuitem" });
      b.dataset.emoji = e; b.tabIndex = -1;
      ui.emojis.append(b);
    }
    // antes da 1ª DM de cada conta em cada andar (E.3): o aviso com "Entendi"
    ui.entendi = atributos(criar("div", "chat-sala-entendi"), { role: "alertdialog", "aria-modal": "true",
      "aria-labelledby": "chat-sala-entendi-t", "aria-describedby": "chat-sala-entendi-d" });
    ui.entendi.hidden = true;
    const et = criar("h3", null, "Antes da sua primeira mensagem direta"); et.id = "chat-sala-entendi-t";
    ui.entendiTexto = criar("p"); ui.entendiTexto.id = "chat-sala-entendi-d";
    ui.agoraNao = botao("botao secundario", null, null, "Agora não"); ui.ok = botao("botao", null, null, "Entendi");
    const acoes = criar("div", "acoes"); acoes.append(ui.agoraNao, ui.ok);
    ui.entendi.append(et, ui.entendiTexto, acoes);
    painel.classList.add("equipe");
    painel.replaceChildren(topo, ui.abas, ui.busca, ui.fixo, ui.registro, ui.corpo, ui.retencao, ui.anuncio, ui.aviso, ui.progresso,
      ui.sugestoes, ui.form, ui.emojis, ui.entendi);
    const rot = abrir.querySelector(".chat-sala-rot");
    if (rot) rot.textContent = "Conversas";

    // ---- estado
    const s = { andar: Andar.atual, onde: { sala: "", nome: "" }, vista: "geral", anterior: "geral", titulo: "", com: "", msgs: [], mais: false,
      v: null, pessoas: [], naoLidas: {}, mencoes: {}, soLer: false, enviando: false, envio: null, opcao: -1, mencao: null, alvo: null,
      entendiFim: null, avisoTempo: 0, buscaTempo: 0 };
    const eq = () => (cfg() && cfg().equipe) || {};
    const ehCanal = v => v === "geral" || v.startsWith("sala:") || v.startsWith("dm:");
    const EX = "ex-membro";
    const nomeDe = u => { if (!u) return EX; const p = s.pessoas.find(x => x.usuario === u); return p && p.nome ? p.nome : u === eu() ? "Você" : u; };

    async function pedir(rota, { metodo = "GET", corpo } = {}) {
      let r = null, d = null;
      try {
        r = await fetch(Andar.com(rota, s.andar), { method: metodo, cache: "no-store", credentials: "same-origin",
          headers: { ...ROTAS.cabecalhos(rota), ...(corpo === undefined ? {} : { "Content-Type": "application/json" }) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
        d = await r.json().catch(() => null);
      } catch (e) { r = null; }
      if (r && r.status === 401) { location.href = "/entrar"; return { ok: false, d: null }; }
      if (!r) mostrarAviso("Sem conexão. Tente de novo.");
      else if (!r.ok) mostrarAviso(d && typeof d.mensagem === "string" ? d.mensagem : `Não deu certo (HTTP ${r.status}).`);
      return { ok: !!r && r.ok, status: r ? r.status : 0, d };
    }
    function mostrarAviso(texto, ruim = true) {
      clearTimeout(s.avisoTempo);
      ui.aviso.textContent = texto; ui.aviso.classList.toggle("ruim", ruim); ui.aviso.hidden = !texto;
      if (texto && !ruim) s.avisoTempo = setTimeout(() => mostrarAviso(""), 4000);
    }
    const somaDe = (o, filtro = () => true) => Object.entries(o).filter(([c]) => filtro(c)).reduce((a, [, n]) => a + (Number.isInteger(n) ? n : 0), 0);
    function contar() {
      const n = somaDe(s.naoLidas), m = somaDe(s.mencoes);
      contador.textContent = contagem(n); contador.hidden = !n || aberto();
      abrir.setAttribute("aria-label", n && !aberto()
        ? `Conversas, ${n} ${n === 1 ? "mensagem nova" : "mensagens novas"}${m ? `, ${m} ${m === 1 ? "menção" : "menções"} a você` : ""}` : "Conversas");
      for (const b of ui.abas.children) {
        const id = b.dataset.id, k = id === "diretas" ? somaDe(s.naoLidas, c => c.startsWith("dm:")) : s.naoLidas[id] || 0, marca = b.querySelector(".chat-sala-aba-n");
        marca.textContent = s.mencoes[id] ? "@" : contagem(k); marca.hidden = !k && !s.mencoes[id];
        b.setAttribute("aria-label", `${b.dataset.rotulo}${k ? `, ${k} não ${k === 1 ? "lida" : "lidas"}` : ""}${s.mencoes[id] ? ", com menção a você" : ""}`);
      }
    }

    // ---- vistas
    function desenharAbas() {
      const atual = s.vista.startsWith("dm:") || s.vista.startsWith("auditoria") ? "diretas" : s.vista;
      ui.abas.replaceChildren(...abas(eq(), s.onde).map(a => {
        const b = botao("chat-sala-aba", null, null, a.rotulo), n = atributos(criar("span", "chat-sala-aba-n"), { "aria-hidden": "true" });
        b.dataset.id = a.id; b.dataset.rotulo = a.rotulo; n.hidden = true; b.append(n);
        if (a.id === atual) b.setAttribute("aria-current", "true");
        return b;
      }));
      ui.abas.hidden = ui.abas.children.length < 2;   // o saguão só tem o Geral: o título já diz
      contar();
    }
    function tituloDa(vista) {
      if (vista === "geral") return Andar.perfil(cfg()).noSaguao ? "Geral do prédio" : "Geral";
      if (vista.startsWith("sala:")) return s.onde.nome || vista.slice(5);
      return { diretas: "Diretas", busca: "Busca", auditoria: "Auditoria das diretas" }[vista] || s.titulo || "Conversa";
    }
    function irPara(vista, titulo = "", com = "") {   // com: o login da outra ponta da DM (para reabrir, ver mandar)
      if (vista !== s.vista && ehCanal(s.vista)) s.anterior = s.vista;
      Object.assign(s, { vista, titulo, com, msgs: [], mais: false, v: null, soLer: false });
      fecharEmojis(); fecharSugestoes();
      const dm = vista.startsWith("dm:"), ler = vista.startsWith("auditoria:"), c = controles(eq(), ler ? "auditoria" : vista), mensagens = ehCanal(vista) || ler;
      ui.titulo.textContent = tituloDa(vista);
      if (ui.entrar) {
        const sala = vista.startsWith("sala:") ? vista.slice(5) : "";
        ui.entrar.dataset.sala = sala; ui.entrar.dataset.nome = sala ? s.onde.nome || sala : "";
        window.Reunioes.pintar();
      }
      ui.sobre.textContent = dm ? "Mensagem direta" : vista.startsWith("auditoria") ? "Administração da empresa" : "Conversas da equipe";
      ui.voltar.hidden = !(dm || vista === "busca" || vista.startsWith("auditoria"));
      ui.busca.hidden = vista !== "busca"; ui.buscar.setAttribute("aria-expanded", String(vista === "busca"));
      ui.form.hidden = !c.escrever; ui.anexar.hidden = !c.anexar; ui.auditar.hidden = !c.auditoria;
      const predio = vista === "geral" && Andar.perfil(cfg()).noSaguao,
        historico = vista.startsWith("sala:") || predio ? avisoHistorico(eq().retencao, predio) : "";
      ui.fixo.textContent = dm ? (eq().aviso_dm || avisoDM(cfg() && cfg().empresa)) : historico;
      ui.fixo.hidden = !ui.fixo.textContent; ui.registro.hidden = true; ui.registro.textContent = "";
      ui.retencao.textContent = mensagens && !historico ? textoRetencao(eq().retencao) : ""; ui.retencao.hidden = !ui.retencao.textContent;
      ui.lista.hidden = !mensagens; ui.itens.hidden = mensagens;
      ui.lista.replaceChildren(); ui.itens.replaceChildren(); ui.antes.hidden = true; ui.vazio.hidden = true;
      ui.campo.placeholder = `Escreva para ${dm ? s.titulo || "a pessoa" : tituloDa(vista)}…`;
      ui.campo.setAttribute("aria-label", `Mensagem para ${dm ? s.titulo || "a pessoa" : tituloDa(vista)}`);
      desenharAbas();
      if (ehCanal(vista)) carregarCanal();
      else if (vista === "diretas") carregarDiretas();
      else if (vista === "auditoria") carregarPares();
      else if (ler) carregarAuditoria();
      else if (vista === "busca") ui.termo.focus();
    }

    // ---- canal: histórico paginado
    function desenharMsgs(rolarFim) {
      const auditoria = s.vista.startsWith("auditoria:"), ctx = { eu: eu(), logins: new Set(s.pessoas.map(p => p.usuario)), andar: s.andar,
        moderar: !!eq().pode_moderar, auditoria, ler: auditoria || eq().pode_escrever === false };
      const noFim = ui.corpo.scrollHeight - ui.corpo.scrollTop - ui.corpo.clientHeight < 40;   // quem rola é o corpo
      ui.lista.replaceChildren(...s.msgs.map(m => elMensagem(m, ctx)));
      ui.vazio.textContent = auditoria ? "Nenhuma mensagem nesta conversa." : "Ninguém escreveu aqui ainda.";
      ui.vazio.hidden = s.msgs.length > 0; ui.antes.hidden = !s.mais;
      if (rolarFim || noFim) ui.corpo.scrollTop = ui.corpo.scrollHeight;
    }
    async function carregarCanal(antes) {
      const vista = s.vista, { ok, d } = await pedir(ROTAS.historico(vista, antes));
      if (vista !== s.vista || !ok || !d || !Array.isArray(d.mensagens)) return;
      if (antes || !s.msgs.length) s.mais = !!d.mais;
      if (!antes && Number.isInteger(d.v)) s.v = d.v;   // a versão do canal na hora do histórico: o /api/ao-vivo parte dela
      s.msgs = mesclar(antes ? s.msgs : [], d.mensagens);
      desenharMsgs(!antes);
      if (vista.startsWith("dm:")) {   // a DM traz o aviso fixo e as datas em que a administração abriu (D10)
        if (typeof d.aviso === "string" && d.aviso) { ui.fixo.textContent = d.aviso; ui.fixo.hidden = false; }
        ui.registro.textContent = linhaAcessos(d.acessos); ui.registro.hidden = !ui.registro.textContent;
      }
      if (!antes) marcarLida();
    }
    function marcarLida() {
      const ultima = s.msgs.length ? s.msgs[s.msgs.length - 1].id : 0;
      if (!ultima || !aberto() || !ehCanal(s.vista)) return;
      const tinha = s.naoLidas[s.vista] || s.mencoes[s.vista];
      delete s.naoLidas[s.vista]; delete s.mencoes[s.vista]; contar();
      if (tinha || s.lida !== `${s.vista}:${ultima}`) { s.lida = `${s.vista}:${ultima}`; pedir(ROTAS.lida, { metodo: "POST", corpo: { canal: s.vista, ate: ultima } }); }
    }

    // ---- diretas, auditoria e busca: listas de botões
    function item(rotulo, detalhe, acao, n = 0) {
      const li = criar("li"), b = botao("chat-sala-item", null, null, null);
      b.append(criar("span", "chat-sala-item-nome", rotulo));
      if (detalhe) b.append(criar("span", "chat-sala-item-det", detalhe));
      if (n) b.append(atributos(criar("span", "chat-sala-n", contagem(n)), { "aria-label": `${n} não ${n === 1 ? "lida" : "lidas"}` }));
      b.addEventListener("click", acao);
      li.append(b);
      return li;
    }
    async function carregarDiretas() {
      const { ok, d } = await pedir(ROTAS.dms);
      if (s.vista !== "diretas" || !ok || !d || !Array.isArray(d.dms)) return;
      const com = new Set(d.dms.map(x => x.outro && x.outro.usuario));
      const minhas = d.dms.map(x => {
        const nome = x.outro ? x.outro.nome || x.outro.usuario : EX;
        return item(nome, x.ultima ? `Última em ${data(x.ultima)}` : "", () => abrirDm(x.canal, nome, x.outro && x.outro.usuario), x.nao_lidas);
      });
      const novas = s.pessoas.filter(p => !com.has(p.usuario)).map(p => item(p.nome || p.usuario, "Começar uma conversa", () => comecarDm(p)));
      ui.itens.replaceChildren(...minhas, ...novas);
      ui.vazio.textContent = "Ainda não há mais ninguém neste andar."; ui.vazio.hidden = minhas.length + novas.length > 0;
    }
    function entendido() {   // E.3: resolve true quando pode seguir para a DM
      if (eq().aviso_dm_entendido) return Promise.resolve(true);
      return new Promise(resolve => {
        ui.entendiTexto.textContent = `${eq().aviso_dm || avisoDM(cfg() && cfg().empresa)} Quando a administração abre uma conversa, fica registrado, e as duas pessoas veem a data.`;
        ui.entendi.hidden = false; ui.ok.focus();
        s.entendiFim = async aceitou => {
          s.entendiFim = null; ui.entendi.hidden = true;
          if (!aceitou) { ui.itens.querySelector("button")?.focus(); resolve(false); return; }
          const r = await pedir(ROTAS.entendi, { metodo: "POST", corpo: {} });
          if (r.ok && cfg() && cfg().equipe) cfg().equipe.aviso_dm_entendido = true;
          resolve(r.ok);
        };
      });
    }
    async function comecarDm(p) {
      if (!(await entendido())) return;
      const { ok, d } = await pedir(ROTAS.abrirDm, { metodo: "POST", corpo: { com: p.usuario } });
      if (ok && d && typeof d.canal === "string") irPara(d.canal, p.nome || p.usuario, p.usuario);
    }
    async function abrirDm(canal, nome, com) {   // sem com: a outra ponta saiu do andar
      if (!(await entendido())) return;
      irPara(canal, nome, com || "");
      if (!com) { s.soLer = true; ui.form.hidden = true; mostrarAviso("A outra pessoa não está mais no andar. A conversa fica só para ler.", false); }
    }
    async function carregarPares() {
      const { ok, d } = await pedir(ROTAS.pares);
      if (s.vista !== "auditoria" || !ok || !d || !Array.isArray(d.pares)) return;
      ui.fixo.textContent = typeof d.lembrete === "string" && d.lembrete ? d.lembrete : "O acesso a esta conversa fica registrado e as duas pessoas veem a data.";
      ui.fixo.hidden = false;
      ui.itens.replaceChildren(...d.pares.map(x => {
        const nome = `${nomeDe(x.u1)} e ${nomeDe(x.u2)}`;
        return item(nome, `${x.mensagens} ${x.mensagens === 1 ? "mensagem" : "mensagens"}, a última em ${data(x.ultima)}`, () => irPara(`auditoria:${x.canal}`, nome));
      }));
      ui.vazio.textContent = "Nenhuma conversa direta neste andar."; ui.vazio.hidden = d.pares.length > 0;
      carregarRegistro();
    }
    // o registro de acessos da auditoria (E.3): quem abriu qual conversa, quando e quantas mensagens; nunca o texto
    async function carregarRegistro() {
      const { ok, d } = await pedir(ROTAS.registro);
      if (s.vista !== "auditoria" || !ok || !d || !Array.isArray(d.registro) || !d.registro.length) return;
      const titulo = criar("li", "chat-sala-secao-li"), h = criar("h3", "chat-sala-secao", "Registro de acessos");
      titulo.append(h);
      ui.itens.append(titulo, ...d.registro.map(x => {
        const li = criar("li", "chat-sala-registro-item"), n = Number.isInteger(x.quantas) ? x.quantas : 0;
        li.append(criar("span", "chat-sala-item-nome", `${nomeDe(x.admin)} abriu a conversa de ${nomeDe(x.u1)} e ${nomeDe(x.u2)}`),
          criar("span", "chat-sala-item-det", `${data(x.quando)} ${hora(x.quando)} · ${n} ${n === 1 ? "mensagem" : "mensagens"}`));
        return li;
      }));
    }
    async function carregarAuditoria(antes) {
      const vista = s.vista, { ok, d } = await pedir(ROTAS.auditoria(vista.slice("auditoria:".length), antes));
      if (vista !== s.vista || !ok || !d || !Array.isArray(d.mensagens)) return;
      if (typeof d.lembrete === "string" && d.lembrete) { ui.fixo.textContent = d.lembrete; ui.fixo.hidden = false; }
      s.mais = !!d.mais; s.msgs = mesclar(s.msgs, d.mensagens);
      desenharMsgs(!antes);
    }
    const rotuloCanal = c => (c === "geral" ? "Geral" : c === `sala:${s.onde.sala}` ? s.onde.nome : c.startsWith("sala:") ? c.slice(5) : "Mensagem direta");
    async function buscar() {
      const termo = ui.termo.value.trim();
      if (!termo) { ui.itens.replaceChildren(); ui.vazio.hidden = true; return; }
      const { ok, d } = await pedir(ROTAS.busca(termo));
      if (s.vista !== "busca" || !ok || !d || !Array.isArray(d.mensagens)) return;
      ui.itens.replaceChildren(...d.mensagens.map(m => item(`${deMim(m, eu()) ? "Você" : m.nome || EX}: ${m.texto || ""}`,
        `${rotuloCanal(m.canal)} · ${data(m.em)} ${hora(m.em)}`, () => (m.canal.startsWith("dm:") ? abrirDm(m.canal, "Mensagem direta") : irPara(m.canal)))));
      ui.vazio.textContent = `Nada encontrado para “${termo}”.`; ui.vazio.hidden = d.mensagens.length > 0;
    }

    // ---- escrever, menção e anexo
    async function mandar() {
      if (s.enviando) return;
      const problema = validar(ui.campo.value);
      if (problema) { mostrarAviso(problema); ui.campo.focus(); return; }
      s.enviando = true; ui.enviar.disabled = true;
      const texto = limpar(ui.campo.value);
      let canal = s.vista, { ok, status, d } = await pedir(ROTAS.enviar, { metodo: "POST", corpo: { canal, texto } });
      // a varredura apaga a DM vazia: reabre com a mesma pessoa (outro número) e reenvia uma vez, com o mesmo texto
      if (!ok && status === 404 && d && d.erro === "nao_existe" && canal.startsWith("dm:") && canal === s.vista && s.com) {
        const nova = await pedir(ROTAS.abrirDm, { metodo: "POST", corpo: { com: s.com } });
        if (nova.ok && nova.d && typeof nova.d.canal === "string" && canal === s.vista) {
          canal = nova.d.canal; irPara(canal, s.titulo, s.com);
          ({ ok, d } = await pedir(ROTAS.enviar, { metodo: "POST", corpo: { canal, texto } }));
        }
      }
      s.enviando = false; ui.enviar.disabled = false;
      if (!ok) return;
      ui.campo.value = ""; mostrarAviso("");
      if (canal === s.vista && d && d.mensagem && Number.isInteger(d.mensagem.id)) { s.msgs = mesclar(s.msgs, [d.mensagem]); desenharMsgs(true); marcarLida(); }
    }
    function fecharSugestoes() {
      ui.sugestoes.hidden = true; ui.sugestoes.replaceChildren(); s.opcao = -1;
      ui.campo.setAttribute("aria-expanded", "false"); ui.campo.removeAttribute("aria-activedescendant");
    }
    function sugerir() {
      const em = controles(eq(), s.vista).mencionar ? mencaoEmCurso(ui.campo.value, ui.campo.selectionStart ?? ui.campo.value.length) : null;
      const lista = em ? sugestoes(em.termo, s.pessoas, eu()) : [];
      if (!lista.length) { fecharSugestoes(); return; }
      s.mencao = em; s.opcao = 0;
      ui.sugestoes.replaceChildren(...lista.map((p, i) => {
        const li = atributos(criar("li", "chat-sala-sugestao"), { role: "option" });
        li.id = `chat-sala-sug-${i}`; li.dataset.usuario = p.usuario;
        li.append(criar("span", null, p.nome || p.usuario), criar("span", "chat-sala-sugestao-login", `@${p.usuario}`));
        li.addEventListener("mousedown", e => { e.preventDefault(); escolher(p.usuario); });
        return li;
      }));
      ui.sugestoes.hidden = false; ui.campo.setAttribute("aria-expanded", "true");
      marcarOpcao();
    }
    function marcarOpcao() {
      [...ui.sugestoes.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === s.opcao)));
      ui.campo.setAttribute("aria-activedescendant", `chat-sala-sug-${s.opcao}`);
    }
    function escolher(usuario) {
      const r = completarMencao(ui.campo.value, s.mencao.inicio, ui.campo.selectionStart ?? ui.campo.value.length, usuario);
      ui.campo.value = r.texto; ui.campo.setSelectionRange(r.cursor, r.cursor);
      fecharSugestoes(); ui.campo.focus();
    }
    function teclaNoCampo(e) {
      if (ui.sugestoes.hidden) return;
      const n = ui.sugestoes.children.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); s.opcao = (s.opcao + (e.key === "ArrowDown" ? 1 : n - 1)) % n; marcarOpcao(); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); escolher(ui.sugestoes.children[s.opcao].dataset.usuario); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fecharSugestoes(); }
    }
    // o anexo sobe por XHR (o fetch não conta o progresso do envio); o tipo quem decide é o servidor, pelos bytes
    function anexar(arquivo) {
      const problema = conferirArquivo(arquivo);
      if (problema) { mostrarAviso(problema); ui.arquivo.value = ""; return; }
      const canal = s.vista, texto = limpar(ui.campo.value), x = new XMLHttpRequest();
      s.envio = x;
      x.open("POST", Andar.com(ROTAS.anexo(canal), s.andar));
      x.setRequestHeader("Content-Type", "application/octet-stream");
      x.setRequestHeader("X-Nome", encodeURIComponent(arquivo.name));
      if (texto && !validar(texto)) x.setRequestHeader("X-Texto", encodeURIComponent(texto));
      x.upload.onprogress = e => { if (e.lengthComputable) ui.barra.value = Math.round(100 * e.loaded / e.total); };
      const fim = () => { s.envio = null; ui.progresso.hidden = true; ui.anexar.disabled = false; ui.arquivo.value = ""; ui.campo.focus(); };
      x.onload = () => {
        fim();
        let d = null; try { d = JSON.parse(x.responseText); } catch (e) { d = null; }
        if (x.status === 401) { location.href = "/entrar"; return; }
        if (x.status < 200 || x.status >= 300) { mostrarAviso(d && typeof d.mensagem === "string" ? d.mensagem : `O arquivo não foi (HTTP ${x.status}).`); return; }
        if (texto) ui.campo.value = "";
        mostrarAviso("Arquivo enviado.", false);
        if (canal === s.vista && d && d.mensagem && Number.isInteger(d.mensagem.id)) { s.msgs = mesclar(s.msgs, [d.mensagem]); desenharMsgs(true); marcarLida(); }
      };
      x.onerror = () => { fim(); mostrarAviso("Sem conexão. O arquivo não foi."); };
      x.onabort = () => { fim(); mostrarAviso("Envio cancelado.", false); };
      ui.barraRot.textContent = `Enviando ${arquivo.name} (${tamanho(arquivo.size)})`;
      ui.barra.value = 0; ui.progresso.hidden = false; ui.anexar.disabled = true; ui.cancelar.focus();
      x.send(arquivo);
    }

    // ---- reações e apagar
    function fecharEmojis(focar) {
      if (ui.emojis.hidden) return;
      ui.emojis.hidden = true;
      if (focar && s.alvo && s.alvo.isConnected !== false) s.alvo.focus();
      s.alvo = null;
    }
    async function reagir(id, emoji) {
      const m = s.msgs.find(x => x.id === id);
      if (!m || m.apagada) return;
      const antes = Array.isArray(m.reacoes) ? m.reacoes : [], ligar = !antes.some(r => r.emoji === emoji && r.eu);
      s.msgs = mesclar(s.msgs, [{ ...m, reacoes: alternarReacao(antes, emoji) }]); desenharMsgs(false);
      const { ok, d } = await pedir(ROTAS.reagir, { metodo: "POST", corpo: { id, emoji, ligar } });
      s.msgs = mesclar(s.msgs, [ok && d && d.mensagem && d.mensagem.id === id ? d.mensagem : m]); desenharMsgs(false);
    }
    async function apagar(id) {
      const { ok } = await pedir(ROTAS.apagar, { metodo: "POST", corpo: { id } });
      const m = s.msgs.find(x => x.id === id);
      if (ok && m) { s.msgs = mesclar(s.msgs, [{ ...m, texto: null, apagada: true, anexo: null, reacoes: [] }]); desenharMsgs(false); mostrarAviso("Mensagem apagada.", false); }
    }

    // ---- abrir, fechar e o que vem do mapa
    function atualizar() {   // na TV e no modo foto o painel some; fora de sala ainda há o Geral e as Diretas
      const pode = !tv() && !!cfg();
      caixa.hidden = !pode;
      if (!pode) { painel.hidden = true; abrir.hidden = false; abrir.setAttribute("aria-expanded", "false"); return; }
      if (s.vista.startsWith("sala:") && !abas(eq(), s.onde).some(a => a.id === s.vista) && aberto()) irPara("geral");
      else desenharAbas();
    }
    async function carregarPessoas() {
      if (!eq().dm && !eq().mencao) { s.pessoas = []; return; }   // o saguão não tem lista de pessoas
      const { ok, d } = await pedir(ROTAS.pessoas);
      if (ok && d && Array.isArray(d.pessoas)) s.pessoas = d.pessoas.filter(p => p && typeof p.usuario === "string");
    }
    async function mostrarPainel() {
      if (aberto()) return;
      painel.hidden = false; abrir.setAttribute("aria-expanded", "true"); abrir.hidden = true;
      await carregarPessoas();
    }
    async function abrirPainel() {
      await mostrarPainel();
      const sala = canalDaSala(s.onde.sala), daSalaOk = sala && abas(eq(), s.onde).some(a => a.id === sala);
      irPara(daSalaOk ? sala : s.vista.startsWith("dm:") ? s.vista : "geral", s.titulo);
      ui.campo.focus();
    }
    // de fora (o mapa e o toque no aviso, pelo app.js): o painel aberto num canal ou na DM com alguém. true se abriu
    const CANAL_OK = /^(geral|sala:.{1,80}|dm:[1-9][0-9]{0,17})$/;
    async function abrirCanal(canal) {
      if (tv() || typeof canal !== "string" || !CANAL_OK.test(canal) || (canal.startsWith("dm:") && !eq().dm)) return false;
      if (canal.startsWith("dm:")) {   // o "Entendi" mora no painel: ele abre antes, senão ninguém vê o diálogo
        const jaAberto = aberto();
        await mostrarPainel();
        if (!(await entendido())) { if (!jaAberto) irPara(s.vista, s.titulo, s.com); return false; }
        const { ok, d } = await pedir(ROTAS.dms), dm = ok && d && Array.isArray(d.dms) ? d.dms.find(x => x.canal === canal) : null;
        irPara(canal, dm ? (dm.outro ? dm.outro.nome || dm.outro.usuario : EX) : "Mensagem direta", dm && dm.outro ? dm.outro.usuario : "");
        if (dm && !dm.outro) { ui.form.hidden = true; mostrarAviso("A outra pessoa não está mais no andar. A conversa fica só para ler.", false); }
      } else { await mostrarPainel(); irPara(canal); }
      ui.campo.focus();
      return true;
    }
    async function abrirDM(usuario) {
      if (tv() || !eq().dm || eq().pode_escrever === false || typeof usuario !== "string" || !usuario) return false;   // quem só lê não tem Diretas
      await mostrarPainel();
      await comecarDm(s.pessoas.find(p => p.usuario === usuario) || { usuario, nome: usuario });
      return true;
    }
    function fecharPainel(focar = true) {
      fecharEmojis(); fecharSugestoes();
      painel.hidden = true; abrir.setAttribute("aria-expanded", "false"); abrir.hidden = false; contar();
      if (focar) abrir.focus();
    }
    function minhaSala(d) {
      const novoAndar = typeof d.andar === "string" && d.andar ? d.andar : Andar.atual;
      if (novoAndar !== s.andar) {   // outro andar, outra empresa: nada do andar de antes fica na tela
        const estavaAberto = aberto();
        Object.assign(s, { andar: novoAndar, naoLidas: {}, mencoes: {}, pessoas: [], vista: "geral", titulo: "", msgs: [] });
        if (s.envio) s.envio.abort();
        if (estavaAberto) fecharPainel(false);
      }
      s.onde = daSala(d);
      atualizar();
    }
    // o /api/ao-vivo: não lidas, menções e as mensagens novas do canal aberto
    function aoVivo(d) {
      if (tv()) return;
      const dmsAntes = Object.keys(s.naoLidas).filter(c => c.startsWith("dm:")).join();
      s.naoLidas = d.nao_lidas && typeof d.nao_lidas === "object" ? { ...d.nao_lidas } : {};
      s.mencoes = d.mencoes && typeof d.mencoes === "object" ? { ...d.mencoes } : {};
      const a = d.aberto;
      if (a && aberto() && a.canal === s.vista && s.v !== null) {   // com o histórico do canal ainda por chegar, nada
        if (a.v !== s.v) { s.v = a.v; carregarCanal(); return; }   // apagaram ou reagiram: relê
        const chegaram = (Array.isArray(a.novas) ? a.novas : []).filter(m => m && Number.isInteger(m.id) && !s.msgs.some(x => x.id === m.id));
        if (chegaram.length) {
          s.msgs = mesclar(s.msgs, chegaram); desenharMsgs(false);
          const delas = chegaram.filter(m => !deMim(m, eu()) && !m.apagada);
          if (delas.length) ui.anuncio.textContent = delas.map(m => `${m.nome || EX}: ${m.texto || "enviou um arquivo"}`).join(". ");
        }
      }
      if (aberto() && ehCanal(s.vista)) marcarLida();
      if (aberto() && s.vista === "diretas" && Object.keys(s.naoLidas).filter(c => c.startsWith("dm:")).join() !== dmsAntes) carregarDiretas();
      contar();
    }
    // o que o vida.js acrescenta ao pedido do /api/ao-vivo: o canal aberto e o maior id já na tela. Antes do histórico
    // do canal chegar, nada: o "depois" seria 0, e a resposta traria as mais antigas
    function paraAoVivo() {
      if (!aberto() || !ehCanal(s.vista) || s.v === null) return "";
      return `&canal=${encodeURIComponent(s.vista)}&depois=${s.msgs.length ? s.msgs[s.msgs.length - 1].id : 0}`;
    }

    abrir.addEventListener("click", abrirPainel);
    ui.fechar.addEventListener("click", () => fecharPainel());
    ui.voltar.addEventListener("click", () => irPara(s.vista.startsWith("dm:") || s.vista === "auditoria" ? "diretas"
      : s.vista.startsWith("auditoria:") ? "auditoria" : s.anterior, s.anterior.startsWith("dm:") ? s.titulo : ""));
    ui.buscar.addEventListener("click", () => (s.vista === "busca" ? ui.voltar.click() : irPara("busca")));
    ui.abas.addEventListener("click", e => { const b = e.target.closest("button"); if (b && b.dataset.id) irPara(b.dataset.id); });
    ui.auditar.addEventListener("click", () => irPara("auditoria"));
    ui.ok.addEventListener("click", () => s.entendiFim?.(true));
    ui.agoraNao.addEventListener("click", () => s.entendiFim?.(false));
    ui.antes.addEventListener("click", () => (s.vista.startsWith("auditoria:") ? carregarAuditoria : carregarCanal)(s.msgs.length ? s.msgs[0].id : undefined));
    ui.busca.addEventListener("submit", e => { e.preventDefault(); clearTimeout(s.buscaTempo); buscar(); });
    ui.termo.addEventListener("input", () => { clearTimeout(s.buscaTempo); s.buscaTempo = setTimeout(buscar, 1100); });   // a busca é 1 por segundo
    ui.form.addEventListener("submit", e => { e.preventDefault(); if (ui.sugestoes.hidden) mandar(); });
    ui.campo.addEventListener("input", () => { if (!ui.aviso.hidden && ui.aviso.classList.contains("ruim")) mostrarAviso(""); sugerir(); });
    ui.campo.addEventListener("keydown", teclaNoCampo);
    ui.campo.addEventListener("blur", () => setTimeout(fecharSugestoes, 150));
    ui.anexar.addEventListener("click", () => ui.arquivo.click());
    ui.arquivo.addEventListener("change", () => { if (ui.arquivo.files && ui.arquivo.files[0]) anexar(ui.arquivo.files[0]); });
    ui.cancelar.addEventListener("click", () => { if (s.envio) s.envio.abort(); });
    ui.lista.addEventListener("click", e => {
      const b = e.target.closest("button"), li = b && b.closest("li");
      if (!b || !li) return;
      const id = Number(li.dataset.id);
      if (b.classList.contains("chat-sala-reacao")) reagir(id, b.dataset.emoji);
      else if (b.classList.contains("chat-sala-apagar")) apagar(id);
      else if (b.classList.contains("chat-sala-reagir")) { s.alvo = b; ui.emojis.dataset.id = String(id); ui.emojis.hidden = false; ui.emojis.firstElementChild.focus(); }
    });
    ui.emojis.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (b) { reagir(Number(ui.emojis.dataset.id), b.dataset.emoji); fecharEmojis(true); }
    });
    ui.emojis.addEventListener("keydown", e => {   // menu: as setas andam; Escape e Tab voltam ao "Reagir"
      const bs = [...ui.emojis.children], i = bs.indexOf(document.activeElement);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); bs[(i + bs.length - 1) % bs.length].focus(); }
      else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); fecharEmojis(true); }
    });
    painel.addEventListener("keydown", e => {
      if (e.key === "Tab" && !ui.entendi.hidden) {   // o diálogo prende o foco: Tab e Shift+Tab ficam entre os dois botões
        e.preventDefault(); (document.activeElement === ui.ok ? ui.agoraNao : ui.ok).focus();
        return;
      }
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!ui.entendi.hidden) ui.agoraNao.click();
      else if (s.vista === "busca") ui.voltar.click();
      else fecharPainel();
    });
    return { minhaSala, aoVivo, atualizar, paraAoVivo, abrirCanal, abrirDM, abrir: abrirPainel, fechar: fecharPainel };
  }

  // ---- qual dos dois: decide no primeiro evento depois do /api/config
  let modo = null, ultimaSala = null;
  function escolher() {
    if (!modo && cfg()) {
      modo = cfg().equipe ? equipe() : classico();
      if (ultimaSala) modo.minhaSala(ultimaSala);
      modo.atualizar();
    }
    return modo;
  }
  window.addEventListener("minha-sala", e => { ultimaSala = e.detail || {}; escolher()?.minhaSala(ultimaSala); });
  window.addEventListener("aovivo", e => {
    const d = e.detail || {};
    euAoVivo = typeof d.eu === "string" ? d.eu : null;
    escolher()?.aoVivo(d);
  });
  new MutationObserver(() => escolher()?.atualizar()).observe(document.body, { attributes: true, attributeFilter: ["class"] });   // entrar e sair da TV
  escolher();

  return { ...puro, elMensagem, paraAoVivo: () => (modo ? modo.paraAoVivo() : ""), abrir: () => escolher()?.abrir(), fechar: f => modo?.fechar(f),
    abrirCanal: async c => (escolher() ? escolher().abrirCanal(c) : false), abrirDM: async u => (escolher() ? escolher().abrirDM(u) : false) };
})();
if (typeof window !== "undefined") window.ChatSala = ChatSala;
