"use strict";
(() => {
  const convite = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const estado = document.getElementById("estado"), lista = document.getElementById("mensagens");
  const formulario = document.getElementById("formulario"), campo = document.getElementById("texto");
  const enviar = formulario.querySelector("button"), sair = document.getElementById("sair");
  const vazio = document.getElementById("mensagens-vazio"), contador = document.getElementById("caracteres-restantes");
  function atualizarContador() { contador.textContent = `${campo.maxLength - campo.value.length} caracteres restantes`; }
  campo.addEventListener("input", atualizarContador);
  let sessao = null, ativa = true, timer, recepcaoLimitada = false;
  async function pedir(acao, dados) {
    const resposta = await fetch(`/api/visitas/${acao}`, { method: "POST", credentials: "omit", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
    const resultado = await resposta.json();
    if (!resposta.ok) {
      const erro = new Error(resultado.erro || "Não foi possível conectar.");
      erro.status = resposta.status;
      throw erro;
    }
    return resultado;
  }
  function encerrar(mensagem) {
    ativa = false; clearTimeout(timer); campo.disabled = true; enviar.disabled = true; estado.textContent = mensagem;
    sessao = null; lista.replaceChildren(); campo.value = ""; atualizarContador(); vazio.hidden = true;
    predio = null; imagem = null; atlasDados = null; verSala.disabled = verEscritorio.disabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height); mapaEstado.textContent = "Mapa indisponível.";
  }
  async function receber() {
    if (!ativa || !sessao) return;
    try {
      const resposta = await pedir("receber", { sessao });
      if (!ativa) return;
      if (recepcaoLimitada) { estado.textContent = "Conectado à sala."; recepcaoLimitada = false; }
      for (const mensagem of resposta.mensagens) {
        const item = document.createElement("li"); item.textContent = mensagem; lista.append(item);
        if (lista.children.length > 100) lista.firstElementChild.remove();
      }
      if (resposta.mensagens.length) { vazio.hidden = true; lista.scrollTop = lista.scrollHeight; }
      timer = setTimeout(receber, 1500);
    } catch (erro) {
      if (!ativa) return;
      if (erro.status === 429) {
        recepcaoLimitada = true;
        estado.textContent = "Muitas requisições. Tentando novamente em instantes.";
        timer = setTimeout(receber, 10000);
      } else encerrar("A conexão terminou. Peça um novo convite para entrar novamente.");
    }
  }
  formulario.addEventListener("submit", async ev => {
    ev.preventDefault();
    const texto = campo.value;
    if (!sessao || !texto.trim()) return;
    enviar.disabled = true;
    try { await pedir("enviar", { sessao, texto }); campo.value = ""; atualizarContador(); }
    catch (_) { if (ativa) estado.textContent = "Não foi possível enviar. Aguarde um instante e tente novamente."; }
    finally { if (ativa) enviar.disabled = false; }
  });
  function desconectar() {
    if (sessao) navigator.sendBeacon("/api/visitas/sair", new Blob([JSON.stringify({ sessao })], { type: "application/json" }));
    encerrar("Você saiu da sala.");
  }
  sair.addEventListener("click", desconectar);
  window.addEventListener("pagehide", desconectar, { once: true });
  const canvas = document.getElementById("cena"), ctx = canvas.getContext("2d");
  const mapaEstado = document.getElementById("mapa-estado"), verSala = document.getElementById("ver-sala");
  const verEscritorio = document.getElementById("ver-escritorio");
  let predio, imagem, atlasDados;
  function desenhar(sala) {
    if (!predio) return;
    const publico = sala === "publico", recepcao = publico && predio.salas.find(s => s.chave === "recepcao");
    const area = sala && !publico ? predio.baixo.find(s => s.chave === "reuniao") : { px: 0, py: 0, pw: predio.W, ph: predio.H };
    if (!area) return;
    const k = Math.min(canvas.width / area.pw, canvas.height / area.ph);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, (canvas.width - area.pw * k) / 2 - area.px * k, (canvas.height - area.ph * k) / 2 - area.py * k);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(predio.fundo, 0, 0);
    for (const o of [...predio.objetos].sort((a, b) => a.chave - b.chave)) {
      if (o.tipo === "mesa") Mapa.desenharMesa(ctx, o.mesa.x, o.mesa.topo, "apagada", 0, o.mesa);
      else if (o.tipo === "cadeira") Mapa.desenharCadeira(ctx, o.x, o.y, o.cor, o.estilo);
      else {
        const sprite = atlasDados.sprites[o.nome];
        if (!sprite) continue;
        ctx.save(); if (o.espelho) { ctx.translate(2 * o.x + o.w, 0); ctx.scale(-1, 1); }
        ctx.drawImage(imagem, sprite[0], sprite[1], sprite[2], sprite[3], o.x, o.y, sprite[2], sprite[3]); ctx.restore();
      }
    }
    // Sem convite, só a recepção fica acesa. As demais salas são a silhueta padrão do prédio:
    // o servidor não envia a planta delas, então nada do que aparece apagado é o conteúdo real.
    if (publico && recepcao) {
      ctx.fillStyle = "rgba(8, 10, 18, 0.82)"; ctx.beginPath();
      ctx.rect(0, 0, predio.W, predio.H); ctx.rect(recepcao.px, recepcao.py, recepcao.pw, recepcao.ph); ctx.fill("evenodd");
      ctx.fillStyle = "#c8cbe0"; ctx.font = `bold ${Math.round(13 / k)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const s of [...predio.salas, ...predio.baixo])
        if (s !== recepcao && s.pw) ctx.fillText("Com convite", s.px + s.pw / 2, s.py + s.ph / 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  async function carregarMapa(publico = false) {
    try {
      const [dados, resposta, img] = await Promise.all([
        pedir(publico ? "recepcao" : "mapa", publico ? {} : { sessao }), fetch("/tema/atlas.json", { credentials: "omit" }),
        new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = "/tema/atlas.png"; })
      ]);
      if (!resposta.ok || !ativa) throw new Error("Mapa indisponível");
      atlasDados = await resposta.json(); if (!ativa) return; imagem = img;
      predio = Mapa.montarPredio({ img, json: atlasDados }, { empresa: "escritorio", planta: dados.planta }, dados.grupos);
      desenhar(publico ? "publico" : false);
      verSala.disabled = verEscritorio.disabled = publico;
      mapaEstado.textContent = publico ? "Recepção pública. As salas apagadas exigem convite."
        : "Mapa simplificado: os nomes das equipes são preservados em privado.";
    } catch (_) { if (ativa) mapaEstado.textContent = "Não foi possível carregar o mapa."; }
  }
  verSala.addEventListener("click", () => { desenhar(true); document.getElementById("titulo-conversa").scrollIntoView({ behavior: "smooth" }); });
  verEscritorio.addEventListener("click", () => desenhar(false));
  if (!convite) {
    estado.textContent = "A conversa e as demais salas exigem convite.";
    sair.disabled = true;
    carregarMapa(true);
    return;
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(convite)) { encerrar("Convite inválido. Peça um novo link."); return; }
  async function entrar() {
    if (!ativa) return;
    try {
      const dados = await pedir("entrar", { convite });
      if (!ativa) { navigator.sendBeacon("/api/visitas/sair", new Blob([JSON.stringify({ sessao: dados.sessao })], { type: "application/json" })); return; }
      sessao = dados.sessao; estado.textContent = "Conectado à sala."; vazio.hidden = false;
      const aviso = document.getElementById("aviso-agente");
      if (aviso && typeof dados.agente === "string" && dados.agente) {
        aviso.textContent = `${dados.agente} (agente) participa desta sala. O que você escrever aqui é enviado ao agentes.chat e fica guardado lá.`;
        aviso.hidden = false;
      } campo.disabled = false; enviar.disabled = false; receber(); carregarMapa();
    } catch (erro) {
      if (!ativa) return;
      if (erro.status === 429) {
        estado.textContent = "Muitas requisições. Tentando novamente em instantes.";
        timer = setTimeout(entrar, 10000);
      } else encerrar("Convite inválido ou expirado. Peça um novo link.");
    }
  }
  entrar();
})();
