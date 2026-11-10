"use strict";
(() => {
  const criar = document.getElementById("criar"), copiar = document.getElementById("copiar");
  const entrar = document.getElementById("entrar"), revogar = document.getElementById("revogar");
  const link = document.getElementById("link"), estado = document.getElementById("estado");
  const agente = document.getElementById("agente");
  const formSenha = document.getElementById("form-senha"), senha = document.getElementById("senha");
  const confirmar = document.getElementById("senha-confirmar"), cancelar = document.getElementById("senha-cancelar");
  let convite = null, ocupada = false;
  // só os anfitriões que o servidor libera (lista configurada, canal de visitas e modo "responder"); vazio, fica só pessoas
  pedir("anfitrioes", {}).then(dados => {
    for (const a of Array.isArray(dados.agentes) ? dados.agentes : []) {
      if (typeof a.id !== "string" || !a.id) continue;
      const opcao = document.createElement("option"); opcao.value = a.id; opcao.textContent = a.nome || a.handle || a.id; agente.append(opcao);
    }
  }).catch(() => {});
  async function pedir(acao, dados, url) {
    const resposta = await fetch(url || `/api/visitas/${acao}`, { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
    if (!resposta.ok) {
      const d = await resposta.json().catch(() => ({}));
      // /api/visitas/* manda o texto em "erro"; /api/conversa/modo manda o código em "erro" e o texto em "mensagem"
      const motivo = typeof d.mensagem === "string" ? d.mensagem : typeof d.erro === "string" ? d.erro : "";
      const falha = new Error(motivo || "Não foi possível concluir. Verifique sua sessão e tente novamente.");
      falha.codigo = typeof d.codigo === "string" ? d.codigo : "";
      throw falha;
    }
    return resposta.json();
  }
  function pedirSenha(mostrar) {
    formSenha.hidden = !mostrar; senha.value = "";
    if (mostrar) senha.focus();
  }
  criar.addEventListener("click", async () => {
    if (ocupada) return;
    ocupada = true; criar.disabled = revogar.disabled = true;
    try {
      if (convite) {
        await pedir("revogar", { convite });
        convite = null; link.value = "";
        copiar.disabled = entrar.disabled = revogar.disabled = true;
      }
      convite = (await pedir("criar", agente.value ? { agente: agente.value } : {})).convite;
      link.value = `${location.origin}/visita.html#${convite}`;
      copiar.disabled = entrar.disabled = revogar.disabled = false;
      estado.textContent = "Convite criado. Ele expira em uma hora.";
      pedirSenha(false);
    } catch (e) {
      estado.textContent = e.message;
      if (e.codigo === "modo_fechado") pedirSenha(true);   // a senha vai aqui mesmo, sem passar pela tela Conversas
    }
    finally { ocupada = false; criar.disabled = false; revogar.disabled = !convite; }
  });
  formSenha.addEventListener("submit", async ev => {
    ev.preventDefault();
    if (ocupada) return;
    const valor = senha.value; senha.value = "";
    if (!valor) { estado.textContent = "Digite a senha do escritório."; senha.focus(); return; }
    ocupada = true; confirmar.disabled = true;
    try {
      await pedir("", { senha: valor }, "/api/conversa/modo");
      pedirSenha(false);
    } catch (e) {
      estado.textContent = e.message; senha.focus();
      return;
    } finally { ocupada = false; confirmar.disabled = false; }
    await criar.click();
  });
  cancelar.addEventListener("click", () => { pedirSenha(false); estado.textContent = ""; });
  copiar.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link.value); estado.textContent = "Link copiado."; }
    catch (_) { link.focus(); link.select(); estado.textContent = "Selecione e copie o link acima."; }
  });
  entrar.addEventListener("click", () => { if (convite) window.open(link.value, "_blank", "noopener"); });
  revogar.addEventListener("click", async () => {
    if (ocupada || !convite) return;
    ocupada = true; criar.disabled = revogar.disabled = true;
    try {
      await pedir("revogar", { convite }); convite = null; link.value = "";
      copiar.disabled = entrar.disabled = revogar.disabled = true; estado.textContent = "Convite encerrado.";
    } catch (e) { estado.textContent = e.message; }
    finally { ocupada = false; criar.disabled = false; revogar.disabled = !convite; }
  });
})();
