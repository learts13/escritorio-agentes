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
  // as mensagens que ainda não estão no painel, em ordem de seq (a leitura repete o que já veio e o envio já pôs a minha),
  // a partir do seq em que entrei na sala
  function novas(mensagens, vistos, desde = 0) {
    if (!Array.isArray(mensagens)) return [];
    return mensagens.filter(m => m && Number.isInteger(m.seq) && m.seq >= desde && !vistos.has(m.seq) && typeof m.texto === "string")
      .sort((a, b) => a.seq - b.seq);
  }

  if (typeof document === "undefined") return { daSala, validar, limpar, novas, TEXTO_MAX };

  const $ = id => document.getElementById(id);
  const caixa = $("chat-sala"), abrir = $("chat-sala-abrir"), painel = $("chat-sala-painel"), titulo = $("chat-sala-titulo"),
    contador = $("chat-sala-n"), lista = $("chat-sala-lista"), vazio = $("chat-sala-vazio"), form = $("chat-sala-form"),
    campo = $("chat-sala-campo"), enviar = $("chat-sala-enviar"), aviso = $("chat-sala-aviso"), fechar = $("chat-sala-fechar");
  if (!caixa) return { daSala, validar, limpar, novas, TEXTO_MAX };

  let sala = "", nomeSala = "", andar = "", desde = 0, vistos = new Set(), naoLidas = 0, enviando = false, avisoTempo = 0;
  const tv = () => !!(window.TV && TV.invisivel) || document.body.classList.contains("tv");
  const eu = () => (typeof estado !== "undefined" && estado && typeof estado.usuario === "string" ? estado.usuario : null);   // app.js
  const aberto = () => !painel.hidden;

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
  function hora(em) {
    const d = new Date(em);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  function por(m, minha = false) {
    vistos.add(m.seq);
    const mim = minha || (m.usuario != null && m.usuario === eu());
    const li = document.createElement("li"), cabeca = document.createElement("p"), quem = document.createElement("strong"),
      quando = document.createElement("time"), texto = document.createElement("p");
    li.className = "chat-sala-msg" + (mim ? " de-mim" : "");
    cabeca.className = "chat-sala-cabeca"; texto.className = "chat-sala-texto";
    quem.textContent = mim ? "Você" : (typeof m.nome === "string" && m.nome ? m.nome : "Alguém");
    quando.textContent = hora(m.em); if (typeof m.em === "string") quando.dateTime = m.em;
    texto.textContent = m.texto;
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

  window.addEventListener("minha-sala", e => {
    const d = e.detail || {}, nova = daSala(d), novoAndar = typeof d.andar === "string" ? d.andar : "";
    if (nova.sala === sala && novoAndar === andar) { if (nova.nome !== nomeSala) { nomeSala = nova.nome; atualizar(); } return; }
    const estavaAberto = aberto() && caixa.contains(document.activeElement);
    sala = nova.sala; nomeSala = nova.nome; andar = novoAndar; desde = Number.isInteger(d.seq) && d.seq > 0 ? d.seq : 0;
    esvaziar(); atualizar();
    if (estavaAberto && caixa.hidden) $("tela")?.focus();   // o foco não fica perdido num painel que sumiu
  });
  window.addEventListener("aovivo", e => {
    if (!sala || tv()) return;
    const d = e.detail || {};
    const chegaram = novas(d.mensagens, vistos, desde);
    for (const m of chegaram) por(m);
    if (chegaram.length) contar();
  });

  abrir.addEventListener("click", abrirPainel);
  fechar.addEventListener("click", () => fecharPainel());
  form.addEventListener("submit", e => { e.preventDefault(); mandar(); });
  campo.addEventListener("input", () => { if (!aviso.hidden && aviso.classList.contains("ruim")) mostrarAviso(""); });
  painel.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); fecharPainel(); } });
  new MutationObserver(atualizar).observe(document.body, { attributes: true, attributeFilter: ["class"] });   // entrar e sair da TV
  atualizar();

  return { daSala, validar, limpar, novas, TEXTO_MAX, abrir: abrirPainel, fechar: fecharPainel };
})();
if (typeof window !== "undefined") window.ChatSala = ChatSala;
