// Página do convite (pública): o link chega como /convite#<token>. O token sai da barra na hora e fica só em memória
// (nunca em localStorage, URL ou log). POST /convite/ver confere o convite e traz o nome sugerido; POST /convite/aceitar
// cria a conta, abre a sessão e leva ao escritório. Os erros do servidor trazem "mensagem" pronta para mostrar.
// Texto do servidor vai para a tela só por textContent.
"use strict";

// Regras do formulário (o servidor confere tudo de novo). Devolve null ou { campo, mensagem } do primeiro problema.
const Convite = (() => {
  const USUARIO = /^[a-z0-9][a-z0-9._-]{2,31}$/, SENHA_MIN = 10, TOKEN = /^[A-Za-z0-9_-]{43}$/;
  const normalizar = c => ({ usuario: String(c.usuario || "").trim().toLowerCase(), senha: String(c.senha || ""), confirmar: String(c.confirmar || ""), nome: String(c.nome || "").trim() });
  function validar(campos) {
    const c = normalizar(campos);
    if (!USUARIO.test(c.usuario)) return { campo: "usuario", mensagem: "O usuário tem de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen e sublinhado, começando por letra ou número." };
    if (c.senha.length < SENHA_MIN) return { campo: "senha", mensagem: `A senha precisa de pelo menos ${SENHA_MIN} caracteres.` };
    if (c.confirmar !== c.senha) return { campo: "confirmar", mensagem: "As senhas não conferem." };
    if (c.nome.length < 1 || c.nome.length > 40 || /[\u0000-\u001f\u007f]/.test(c.nome)) return { campo: "nome", mensagem: "Dê um nome de 1 a 40 caracteres." };
    return null;
  }
  return { validar, normalizar, tokenValido: t => TOKEN.test(t) };
})();
if (typeof window !== "undefined") window.Convite = Convite;

(() => {
  if (typeof document === "undefined") return;
  const $ = id => document.getElementById(id);
  const token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);   // o fragmento não fica na barra nem no histórico

  const telas = ["cv-carregando", "cv-invalido", "cv-form"];
  const mostrar = id => { for (const t of telas) $(t).hidden = t !== id; };
  const INVALIDO = "Esse convite não vale mais. Peça um novo a quem convidou você.";

  async function pedir(url, corpo) {
    let r;
    try { r = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }); }
    catch (e) { const x = new Error("Sem conexão com o escritório. Confira a internet e tente de novo."); x.status = 0; throw x; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const x = new Error(typeof d.mensagem === "string" && d.mensagem ? d.mensagem : `O servidor respondeu ${r.status}.`);
      x.status = r.status; x.codigo = typeof d.erro === "string" ? d.erro : ""; throw x;
    }
    return d;
  }

  function indisponivel(texto, podeTentar) {
    $("cv-invalido-txt").textContent = texto; $("cv-de-novo").hidden = !podeTentar; mostrar("cv-invalido");
    (podeTentar ? $("cv-de-novo") : document.querySelector(".link-entrar")).focus();
  }

  async function ver() {
    mostrar("cv-carregando");
    if (!Convite.tokenValido(token)) { indisponivel(INVALIDO, false); return; }
    try {
      const d = await pedir("/convite/ver", { convite: token });
      if (!$("cv-nome").value) $("cv-nome").value = typeof d.nome === "string" ? d.nome.slice(0, 40) : "";
      if (!seletor) seletor = Avatar.seletor($("cv-boneco"), Avatar.padrao($("cv-nome").value), null, "cv");
      mostrar("cv-form"); $("cv-usuario").focus();
    } catch (e) { indisponivel(e.message, e.status !== 404); }
  }
  let seletor = null;
  $("cv-de-novo").addEventListener("click", ver);

  // erro do formulário: um aviso só (role=alert) e o foco no campo com problema
  function erro(texto, campo) {
    $("cv-erro-txt").textContent = texto; $("cv-erro").hidden = !texto;
    for (const id of ["usuario", "senha", "confirmar", "nome"]) $(`cv-${id}`).removeAttribute("aria-invalid");
    if (campo) { const c = $(`cv-${campo}`); c.setAttribute("aria-invalid", "true"); c.focus(); }
  }

  for (const b of document.querySelectorAll(".ver-senha")) b.addEventListener("click", () => {
    const campo = $(b.getAttribute("aria-controls")), ver2 = campo.type === "password";
    campo.type = ver2 ? "text" : "password"; b.textContent = ver2 ? "Ocultar" : "Mostrar"; b.setAttribute("aria-pressed", String(ver2));
    campo.focus();
  });
  for (const c of [$("cv-senha"), $("cv-confirmar")]) c.addEventListener("keyup", ev => { if (ev.getModifierState) $("caps").textContent = ev.getModifierState("CapsLock") ? "Caps Lock ligado." : ""; });

  $("cv-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const campos = { usuario: $("cv-usuario").value, senha: $("cv-senha").value, confirmar: $("cv-confirmar").value, nome: $("cv-nome").value };
    const falha = Convite.validar(campos);
    if (falha) { erro(falha.mensagem, falha.campo); return; }
    const c = Convite.normalizar(campos), bt = $("cv-enviar");
    erro(""); bt.disabled = true; bt.textContent = "Criando…";
    try {
      await pedir("/convite/aceitar", { convite: token, usuario: c.usuario, senha: c.senha, nome: c.nome, avatar: seletor.valor() });
      location.href = "/";
    } catch (e) {
      bt.disabled = false; bt.textContent = "Criar conta e entrar";
      if (e.status === 404) { indisponivel(e.message || INVALIDO, false); return; }   // vencido, usado ou revogado enquanto preenchia
      erro(e.message, e.codigo === "usuario_existe" ? "usuario" : null);   // 400 não diz o campo: o aviso (role=alert) é lido e fica à vista
      $("cv-erro").scrollIntoView({ block: "nearest" });
    }
  });

  ver();
})();
