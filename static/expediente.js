// Expediente: das quantas às quantas o escritório abre ("expediente": {abre, fecha} em HH:MM, do Personalizar ou
// do times.json, já normalizado pelo /api/config). Fora dele, quem está sem tarefa vai para casa (vida.js) e uma
// faixa no mapa avisa (app.js). Sem configuração (e na demonstração): 07:00 às 20:00. abre > fecha é o turno que
// vira a meia-noite (22:00 às 06:00); abre == fecha não vale. As horas comparadas são decimais, como o Ceu.agora().h.
"use strict";
const Expediente = (() => {
  const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
  let abre = "07:00", fecha = "20:00";
  const horas = t => { const m = HHMM.exec(t); return m ? +m[1] + +m[2] / 60 : NaN; };
  const valido = (a, f) => HHMM.test(a) && HHMM.test(f) && a !== f;
  function definir(e) { if (e && valido(e.abre, e.fecha)) { abre = e.abre; fecha = e.fecha; } }
  function fora(h, a = abre, f = fecha) {
    const ha = horas(a), hf = horas(f);
    return ha < hf ? h < ha || h >= hf : h >= hf && h < ha;
  }
  // quanto dura o turno, em horas (22:00 às 06:00 = 8)
  const duracao = (a = abre, f = fecha) => (horas(f) - horas(a) + 24) % 24;
  return { definir, fora, valido, duracao, proximaAbertura: () => abre, get abre() { return abre; }, get fecha() { return fecha; } };
})();
window.Expediente = Expediente;

// Andar atual (cada workspace do agentes.chat é um andar do prédio). Mora aqui porque este arquivo já é carregado no
// escritório e no modo construção, e arquivo estático novo precisa constar do ARQUIVOS do servidor.
// O andar principal é o padrão e NÃO vai na URL: os pedidos dele ficam idênticos aos de antes dos andares. Os outros levam
// `andar=<8 hex>` na query. Fontes, em ordem: #andar=<id> no endereço, depois o localStorage (sempre com try/catch).
const Andar = (() => {
  const PRINCIPAL = "principal", CHAVE = "escritorio:andar";
  const valido = id => typeof id === "string" && (id === PRINCIPAL || /^[0-9a-f]{8}$/.test(id));
  const doHash = h => { const m = /^#andar=([^&]*)$/.exec(typeof h === "string" ? h : ""); return m && valido(m[1]) ? m[1] : null; };
  let atual = PRINCIPAL;
  const guardar = id => { try { if (id === PRINCIPAL) localStorage.removeItem(CHAVE); else localStorage.setItem(CHAVE, id); } catch (e) { /* aba anônima ou armazenamento bloqueado */ } };
  function ler() {   // endereço primeiro, depois o que ficou guardado; nada válido, principal
    let id = null;
    try { id = doHash(location.hash); } catch (e) { /* sem location */ }
    if (!id) try { const g = localStorage.getItem(CHAVE); id = valido(g) ? g : null; } catch (e) { /* sem localStorage */ }
    atual = id || PRINCIPAL;
    return atual;
  }
  // devolve true se o andar mudou; id inválido vira o principal
  function definir(id) {
    const novo = valido(id) ? id : PRINCIPAL, mudou = novo !== atual;
    atual = novo; guardar(novo);
    return mudou;
  }
  // põe `andar=<id>` na query da url (relativa ou absoluta, com ou sem #). No principal devolve a url como veio.
  function com(url, id = atual) {
    if (id === PRINCIPAL || !valido(id) || typeof url !== "string") return url;
    const i = url.indexOf("#"), corpo = i < 0 ? url : url.slice(0, i), fim = i < 0 ? "" : url.slice(i);
    return `${corpo}${corpo.includes("?") ? "&" : "?"}andar=${id}${fim}`;
  }
  // como a conexão de cada andar aparece na tela; valor que o servidor ainda não conhece vira "sem leitura"
  const CONEXAO = { conectado: "conectado", sem_conexao: "sem conexão", outra_org: "conectado no workspace errado, reconecte", recusada: "conexão recusada",
    pausa: "em pausa", falha: "sem resposta", carregando: "conectando…" };
  const rotuloConexao = c => (typeof c === "string" && Object.hasOwn(CONEXAO, c) ? CONEXAO[c] : "sem leitura");
  ler();
  return { PRINCIPAL, valido, rotuloConexao, doHash, ler, definir, com, limpar: () => definir(PRINCIPAL), get atual() { return atual; } };
})();
window.Andar = Andar;
