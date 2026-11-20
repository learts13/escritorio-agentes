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
  // o aviso pessoal tocado com o escritório aberto (sw.js: postMessage {tipo: "aviso", andar, canal}): o andar e o canal
  // do contrato ("geral", "sala:<chave>", "dm:<n>"; sem controle, até 120); o resto vira null
  const doAviso = d => {
    if (!d || typeof d !== "object" || d.tipo !== "aviso" || !valido(d.andar)) return null;
    const c = d.canal, ok = typeof c === "string" && c.length <= 120 && !/[\u0000-\u001f\u007f]/.test(c) && /^(geral|sala:.+|dm:\d{1,9})$/.test(c);
    return { andar: d.andar, canal: ok ? c : null };
  };
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
    pausa: "em pausa", falha: "sem resposta", carregando: "conectando…", conferindo: "conectado, conferindo o workspace" };
  const rotuloConexao = c => (typeof c === "string" && Object.hasOwn(CONEXAO, c) ? CONEXAO[c] : "sem leitura");
  // a cidade do clima de cada andar no /api/config (só o nome; null sem clima): texto de até 60, numa linha, ou ""
  const cidadeOk = c => (typeof c === "string" && c.length <= 60 && !/[\u0000-\u001f\u007f]/.test(c) ? c.trim() : "");
  // a opção do elevador: "Dev Maniac's · Mateus Leme", e a conexão quando não está conectado
  const rotuloAndar = a => [a.nome, cidadeOk(a.cidade), a.conexao && a.conexao !== "conectado" ? rotuloConexao(a.conexao) : ""]
    .filter(Boolean).join(" · ");
  // o perfil da conta no andar do /api/config: papel neste andar, admin do prédio (admin_predio) e o modo do térreo.
  // Sem o campo papel (servidor antigo) vale admin do prédio, a tela de sempre; papel desconhecido vira o mais fechado.
  function perfil(c) {
    const cfg = c && typeof c === "object" ? c : {};
    const papel = cfg.papel === undefined ? "admin" : ["admin", "membro", "pessoa"].includes(cfg.papel) ? cfg.papel : "pessoa";
    const admin = papel === "admin", saguao = cfg.terreo === "saguao";
    return { papel, admin, predio: admin && cfg.admin_predio !== false, saguao, noSaguao: saguao && (cfg.andar === undefined || cfg.andar === PRINCIPAL) };
  }
  // a linha "Este andar: …" do elevador: conectado e sem conexão nenhuma (o saguão, conexao null) não dizem nada
  const estadoDoAndar = c => (!c || c === "conectado" ? "" : `Este andar: ${rotuloConexao(c)}`);
  // as telas pelo # que o perfil abre: Conversas só o admin do andar, e o saguão (sem agentes) não tem conversas,
  // aprovações nem jornal
  const SEM_SAGUAO = ["conversas", "aprovacoes", "jornal"];
  function telaLiberada(rota, c) {
    const p = perfil(c);
    return !(rota === "conversas" && !p.admin) && !(p.noSaguao && SEM_SAGUAO.includes(rota));
  }
  // o andar que o /api/config respondeu (conta sem acesso ao principal recebe o primeiro andar dela): passa a valer daqui em diante
  const seguir = c => !!c && valido(c.andar) && definir(c.andar);
  ler();
  return { PRINCIPAL, valido, rotuloConexao, cidadeOk, rotuloAndar, estadoDoAndar, perfil, telaLiberada, seguir, doHash, doAviso, ler, definir, com, limpar: () => definir(PRINCIPAL), get atual() { return atual; } };
})();
window.Andar = Andar;
