// Cor da marca (o servidor põe a da configuração em <html data-cor>): botão, foco e destaques seguem a marca, e o texto
// do botão fica escuro ou claro, o que der mais contraste (a mesma conta do app.js). As cores de estado não mudam.
(() => {
  const cor = document.documentElement.dataset.cor;
  if (!/^#[0-9a-f]{6}$/i.test(cor || "")) return;
  const lum = hex => { const n = parseInt(hex.slice(1), 16), c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(n >> 16) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255); };
  const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const raiz = document.documentElement.style;
  raiz.setProperty("--destaque", cor);
  raiz.setProperty("--destaque-texto", contraste(cor, "#1a1408") >= contraste(cor, "#ffffff") ? "#1a1408" : "#ffffff");
})();

// Tela de login: uma mini-cena do escritório no painel azul. Uma mesa à esquerda e um sofá à direita;
// quem trabalha digita na mesa (verde), quem espera você acena com um "!" (âmbar) e quem está livre
// (branco) anda entre a mesa e o sofá e senta um pouco. As outras duas espécies da Firmópolis também aparecem:
// um terminaizinho cochila no sofá e uma pessoa acena para quem chega. Sem dados nem nomes reais.
"use strict";
(() => {
  const cv = document.getElementById("desfile"); if (!cv || !window.Avatar) return;
  const c = cv.getContext("2d"), calmo = matchMedia("(prefers-reduced-motion: reduce)");
  const token = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const VERDE = token("--verde"), AMBAR = token("--ambar"), BRANCO = token("--cinza");   // as cores da legenda embaixo (entrar.css)
  const trabalha = { ap: { color: "green", eyes: "round", accessory: "headphones" } };
  const espera = { ap: { color: "amber", eyes: "wide", accessory: "crown" } };
  const livre = { ap: { color: "graphite", eyes: "happy", accessory: "cap" }, x: 94, alvo: 0, ate: 0, sentado: false };
  let P = 3, W = 200, ultimo = 0;   // P: pixels de tela por pixel da cena; W: largura da cena
  const ret = (x, y, w, h, cor) => { c.fillStyle = cor; c.fillRect(Math.round(x) * P, Math.round(y) * P, w * P, h * P); };
  const sombra = (x, y, w) => ret(x - w / 2, y, w, 2, "rgba(0,0,40,.28)");
  // sprites.js (Sprites.gente e Sprites.terminal) desenha em pixels da cena: escala P e volta
  const sprite = (fn) => { if (!window.Sprites) return; c.save(); c.scale(P, P); fn(window.Sprites); c.restore(); };
  const avatar = (b, x, y, passo) => c.drawImage(Avatar.desenhar(b.ap, false, passo), Math.round(x - 11) * P, Math.round(y - 21) * P, 22 * P, 22 * P);
  const luz = (x, y, cor) => { ret(x - 2, y - 2, 4, 4, "rgba(0,0,40,.45)"); ret(x - 1, y - 1, 2, 2, cor); };   // status em cima da cabeça

  function mesa(t) { // mesa à esquerda: monitor de costas na ponta (a tela olha para quem digita), caneca e luz da tela no rosto
    ret(10, 44, 42, 2, "rgba(0,0,40,.25)");
    ret(8, 31, 44, 4, "#c9a777"); ret(8, 31, 44, 1, "#dcbd8c"); ret(8, 35, 44, 4, "#8a6a45"); ret(10, 39, 2, 6, "#2b2b36"); ret(48, 39, 2, 6, "#2b2b36");
    ret(11, 19, 13, 11, "#1f2433"); ret(12, 20, 11, 9, "#2a3042"); ret(16, 30, 3, 2, "#1f2433");
    ret(13, 21, 1, 1, Math.floor(t / 700) % 2 ? VERDE : "#2a3042");                      // LED do monitor
    ret(44, 28, 3, 3, "#f4f4f6"); ret(44, 28, 3, 1, "#6b4a2e");                           // caneca
    ret(28, 30, 14, 1, "#5d6476");                                                        // teclado
  }
  function sofa() { // sofá de dois lugares, à direita
    const x = W - 52 + 6;
    ret(x + 2, 44, 40, 2, "rgba(0,0,40,.25)");
    ret(x + 4, 24, 36, 12, "#3f3f52"); ret(x + 4, 24, 36, 2, "#55556c");          // encosto
    ret(x, 30, 6, 14, "#34344a"); ret(x + 38, 30, 6, 14, "#34344a");             // braços
    ret(x + 6, 34, 32, 8, "#4a4a62"); ret(x + 6, 34, 32, 1, "#5f5f7a"); ret(x + 21, 34, 1, 8, "#3a3a50");   // assento
    ret(x + 8, 28, 7, 6, "#f2a93b");                                                 // almofada
  }

  function cena(t, dt) {
    const w = cv.clientWidth, h = cv.clientHeight;
    P = w < 420 ? 2 : 4; W = Math.max(150, Math.floor(w / P));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
    c.translate(0, Math.max(0, h - 48 * P));                                        // chão no pé do painel
    ret(0, 45, W, 1, "rgba(255,255,255,.35)");
    // quem está livre: anda até o sofá, senta, levanta e volta para perto da mesa
    const sofaX = W - 14, perto = 94;   // perto da mesa, ao lado de quem espera
    if (!calmo.matches && !livre.sentado && t > livre.ate) {
      const alvo = livre.alvo ? perto : sofaX, d = alvo - livre.x;
      if (Math.abs(d) < 0.6) { if (!livre.alvo) { livre.sentado = true; livre.ate = t + 3800; } else { livre.alvo = 0; livre.ate = t + 1500; } }
      else livre.x += Math.sign(d) * Math.min(Math.abs(d), 20 * dt);
    } else if (livre.sentado && t > livre.ate) { livre.sentado = false; livre.alvo = 1; }
    if (calmo.matches) { livre.x = sofaX; livre.sentado = true; }
    const anda = !livre.sentado && !calmo.matches && t > livre.ate, passo = anda ? Math.floor(t / 170) % 2 : null;
    avatar(trabalha, 35, 34 - (calmo.matches ? 0 : Math.floor(t / 140) % 2), null);   // digitando atrás da mesa
    mesa(t);
    luz(35, 8, VERDE);
    sombra(66, 44, 10); avatar(espera, 66, 44, null); luz(66, 18, AMBAR);
    const mao = calmo.matches ? 0 : Math.floor(t / 300) % 2;                         // mão levantada, acenando
    ret(74 + mao, 26, 3, 3, "#5e3a10"); ret(75 + mao, 27, 1, 1, "#f2a93b");
    ret(70, 9, 7, 7, "#ffffff"); ret(73, 10, 1, 3, "#1b1b22"); ret(73, 14, 1, 1, "#1b1b22");   // balão com "!"
    sofa();
    sprite(S => S.terminal(c, W - 36, 41, 0, false, 2, calmo.matches ? 0 : t, "dormir"));       // terminaizinho cochilando no sofá
    sprite(S => S.gente(c, 84, 45, 0, true, 9, "acenar", calmo.matches ? 0 : t));                  // a gente, acenando para quem chega
    if (livre.sentado) { avatar(livre, sofaX, 40, null); luz(sofaX, 15, BRANCO); }
    else { sombra(livre.x, 44, 10); avatar(livre, livre.x, 44 - (passo || 0), passo); luz(livre.x, 19 - (passo || 0), BRANCO); }
  }

  function quadro(t) { const dt = Math.min(0.1, (t - (ultimo || t)) / 1000); ultimo = t; cena(t, dt); requestAnimationFrame(quadro); }
  if (calmo.matches) { cena(0, 0); addEventListener("resize", () => cena(0, 0)); }   // cena parada, sem animação
  else requestAnimationFrame(quadro);
})();

// Formulário: mostrar senha, aviso de Caps Lock, senhas que não conferem e botão "Entrando…"
(() => {
  const form = document.querySelector("form"), senha = document.getElementById("senha"), confirmar = document.getElementById("confirmar");
  const primeiro = !document.getElementById("codigo").closest("[hidden]"), enviar = document.getElementById("enviar");
  if (primeiro) { enviar.textContent = "Criar usuário e entrar"; senha.autocomplete = "new-password"; }   // o gerenciador de senhas oferece gerar e salvar
  const rotulo = enviar.textContent;
  for (const b of document.querySelectorAll(".ver-senha")) b.addEventListener("click", () => {
    const campo = document.getElementById(b.getAttribute("aria-controls")), ver = campo.type === "password";
    campo.type = ver ? "text" : "password"; b.textContent = ver ? "Ocultar" : "Mostrar"; b.setAttribute("aria-pressed", String(ver));
    campo.focus();
  });
  const caps = document.getElementById("caps");
  for (const c of [senha, confirmar]) c.addEventListener("keyup", ev => { if (ev.getModifierState) caps.textContent = ev.getModifierState("CapsLock") ? "Caps Lock ligado." : ""; });
  confirmar.addEventListener("input", () => confirmar.setCustomValidity(""));
  form.addEventListener("submit", ev => {
    if (primeiro && confirmar.value !== senha.value) { ev.preventDefault(); confirmar.setCustomValidity("As senhas não conferem."); confirmar.reportValidity(); return; }
    enviar.disabled = true; enviar.textContent = primeiro ? "Criando…" : "Entrando…";
  });
  addEventListener("pageshow", ev => { if (ev.persisted) { enviar.disabled = false; enviar.textContent = rotulo; } });   // voltou pelo histórico (bfcache)
  // "Olá de novo": o app.js guarda o usuário só depois de uma entrada bem-sucedida; aqui ele só preenche o campo (a senha nunca)
  const usuario = document.getElementById("usuario"), ola = document.getElementById("ola");
  let lembrado = null;
  try { lembrado = localStorage.getItem("escritorio:usuario"); } catch (e) { /* aba anônima ou armazenamento bloqueado */ }
  if (!primeiro && lembrado && lembrado.length <= 64 && !usuario.value) {
    usuario.value = lembrado;
    document.getElementById("ola-txt").textContent = `Olá de novo, ${lembrado}.`;   // texto, nunca HTML: o valor pode ter sido mexido
    ola.hidden = false;
    document.getElementById("nao-sou").addEventListener("click", () => {
      try { localStorage.removeItem("escritorio:usuario"); } catch (e) { /* idem */ }
      ola.hidden = true; usuario.value = ""; usuario.focus();
    });
  }
  const vazio = [document.getElementById("codigo"), usuario, senha].find(c => !c.closest("[hidden]") && !c.value);
  if (vazio) vazio.focus();
})();
