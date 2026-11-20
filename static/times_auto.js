// Montar os times automaticamente (Personalizar > Times e aparência): a lógica pura, sem tela, testada em test_times_auto.js.
// Cada agente ganha um time pela primeira fonte que der um: a lista colada (handle, time), o setor do agentes.chat,
// o fim do nome ("Gandalf · Maestro" → Maestro) ou o papel (role). Nomes iguais sem acento nem caixa viram um time só.
// Passou de 12 times, os menores se juntam em "Outros". Nada aqui grava: o ajustes.js mostra a prévia e só aplica
// na tela de times quando a pessoa confirma (e ainda falta o Salvar times).
"use strict";
const TimesAuto = (() => {
  const MAX_TIMES = 12, MAX_POR_TIME = 24, OUTROS = "Outros";
  const NOME_OK = /^[\p{L}\p{N}_ .'&\-]{1,40}$/u, HANDLE_OK = /^[a-z0-9][a-z0-9\-]{0,40}$/;
  const SEPARADORES = [" · ", " - ", " | "];

  // a chave de agrupamento: sem acento, sem caixa e com um espaço só ("Revisão", "revisao" e "REVISAO " são o mesmo time)
  const chave = n => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  // o nome no formato dos times (letras, números, espaço e . ' & -, até 40), com a primeira letra maiúscula
  function limpar(n) {
    const t = String(n || "").replace(/[^\p{L}\p{N}_ .'&\-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
    return t ? t[0].toUpperCase() + t.slice(1) : "";
  }
  const nomeValido = n => NOME_OK.test(n);

  // "Gandalf · Maestro" → "Maestro": o que vem depois do último separador
  function timeDoNome(nome) {
    const n = String(nome || "");
    let fim = -1, tam = 0;
    for (const s of SEPARADORES) { const i = n.lastIndexOf(s); if (i > 0 && i > fim) { fim = i; tam = s.length; } }
    return fim < 0 ? "" : limpar(n.slice(fim + tam));
  }
  // o papel só vira time quando é curto (até 3 palavras): uma frase de descrição faria um time por agente
  function timeDoPapel(papel) {
    const t = limpar(papel);
    return t && t.split(" ").length <= 3 ? t : "";
  }

  // "handle, time" por linha (também ; ou tab). Linha vazia, com # ou o cabeçalho "handle, time" são puladas
  function lerLista(texto) {
    const pares = new Map(), erros = [];
    String(texto || "").split(/\r?\n/).forEach((linha, i) => {
      const l = linha.trim();
      if (!l || l.startsWith("#")) return;
      const m = /^([^,;\t]*)[,;\t](.*)$/.exec(l);
      const handle = m ? m[1].trim().replace(/^@/, "").toLowerCase() : "", time = m ? limpar(m[2].replace(/^["']|["']$/g, "")) : "";
      if (i === 0 && handle === "handle") return;
      if (!HANDLE_OK.test(handle) || !time) { erros.push(i + 1); return; }
      pares.set(handle, time);
    });
    return { pares, erros };
  }

  // tipo e ícone pelas palavras do nome (sem acento): o começo de cada palavra decide
  const palavras = n => chave(n).split(/[^a-z0-9]+/).filter(Boolean);
  const comeca = (ps, raizes) => ps.some(p => raizes.some(r => p.startsWith(r)));
  function tipoSugerido(nome) {
    const ps = palavras(nome);
    if (ps.some(p => p.startsWith("infra") || p === "noc" || p.endsWith("ops"))) return "ops";
    if (comeca(ps, ["direc", "diretor", "gestao", "gestor"])) return "gabinete";
    return "mesas";
  }
  const ICONES = [
    ["coroa", ["direc", "diretor", "gest", "maestro", "lider", "chefe", "ceo", "coord"]],
    ["servidor", ["infra", "noc", "ops", "devops", "sre", "operac", "operador", "servidor", "rede", "plataforma"]],
    ["codigo", ["dev", "codigo", "engenh", "program", "software", "backend", "frontend", "produto"]],
    ["pincel", ["arte", "design", "criac", "ilustr", "video", "producao", "visual"]],
    ["megafone", ["marketing", "social", "comunic", "copy", "conteudo", "midia", "imprensa", "redac"]],
    ["grafico", ["comercial", "venda", "financ", "dados", "analis", "analyt", "metric", "pesquisa"]],
    ["sino", ["suporte", "atendimento", "sentinela", "seguranca", "alerta", "monitor", "plantao"]],
    ["estrela", ["revis", "qualidade", "qa", "teste", "auditor"]],
    ["controle", ["jogo", "game", "games"]],
    ["xicara", ["cafe", "copa", "lazer"]],
  ];
  function iconeSugerido(nome) {
    const ps = palavras(nome), achado = ICONES.find(([, raizes]) => comeca(ps, raizes));
    return achado ? achado[0] : "pessoas";
  }

  // agentes: a última leitura ({handle, nome, funcao, setor?}); lista: o texto colado (opcional).
  // Devolve { times: [{nome, origem, agentes, setor}], novos, fontes (quantos agentes por fonte), foraDaLeitura, errosLista, juntados }
  function agrupar(agentes, lista) {
    const { pares, erros } = lerLista(lista), grupos = new Map(), novos = [], vistos = new Set();
    const fontes = { lista: 0, "agentes.chat": 0, nome: 0, papel: 0 };
    for (const a of agentes || []) {
      if (!a || typeof a.handle !== "string" || !a.handle || vistos.has(a.handle)) continue;
      vistos.add(a.handle);
      const setor = a.setor && typeof a.setor.nome === "string" ? a.setor : null;
      const opcoes = [[pares.get(a.handle) || "", "lista"], [setor ? limpar(setor.nome) : "", "agentes.chat"],
        [timeDoNome(a.nome), "nome"], [timeDoPapel(a.funcao), "papel"]];
      const [nome, origem] = opcoes.find(([n]) => n) || ["", ""];
      if (!nome) { novos.push(a.handle); continue; }
      fontes[origem]++;
      const k = chave(nome);
      if (!grupos.has(k)) grupos.set(k, { nomes: new Map(), origem, setor: origem === "agentes.chat" ? setor : null, agentes: [], ordem: grupos.size });
      const g = grupos.get(k);
      g.nomes.set(nome, (g.nomes.get(nome) || 0) + 1);
      if (!g.setor && origem === "agentes.chat") g.setor = setor;
      g.agentes.push(a.handle);
    }
    // o nome que mais aparece no grupo (empate: o primeiro)
    const nomeDo = g => [...g.nomes].reduce((m, x) => (x[1] > m[1] ? x : m))[0];
    let times = [...grupos.values()].map(g => ({ nome: nomeDo(g), origem: g.origem, setor: g.setor, agentes: g.agentes, ordem: g.ordem }));
    // os do agentes.chat na ordem dos setores de lá; o resto na ordem em que apareceu
    times.sort((x, y) => (x.setor ? x.setor.ordem ?? 999 : 1000) - (y.setor ? y.setor.ordem ?? 999 : 1000) || x.ordem - y.ordem);
    const r = teto(times);
    const foraDaLeitura = [...pares.keys()].filter(h => !vistos.has(h));
    return { times: r.times.map(({ ordem, ...t }) => t), novos, fontes, foraDaLeitura, errosLista: erros, juntados: r.juntados };
  }

  // até 12 times: ficam os 11 maiores (empate: o primeiro), e os outros se juntam em "Outros" (ou no "Outros" que já houver)
  function teto(times, max = MAX_TIMES) {
    if (times.length <= max) return { times, juntados: [] };
    const k = chave(OUTROS), outros = times.find(t => chave(t.nome) === k);
    const resto = times.filter(t => t !== outros);
    const ficam = new Set([...resto].sort((x, y) => y.agentes.length - x.agentes.length || times.indexOf(x) - times.indexOf(y)).slice(0, max - 1));
    const saem = resto.filter(t => !ficam.has(t));
    const junto = { nome: OUTROS, origem: outros ? outros.origem : "juntado", setor: null,
      agentes: [...(outros ? outros.agentes : []), ...saem.flatMap(t => t.agentes)], ordem: Infinity };
    return { times: [...resto.filter(t => ficam.has(t)), junto], juntados: saem.map(t => t.nome) };
  }

  // as salas das bands do Maestri: times sem agentes, com o nome da band, depois dos times e só enquanto couberem
  function comBands(times, bands, max = MAX_TIMES) {
    const ja = new Set(times.map(t => chave(t.nome))), novas = [], fora = [];
    for (const b of bands || []) {
      const nome = limpar(b), k = chave(nome);
      if (!nome || ja.has(k)) continue;
      ja.add(k);
      (times.length + novas.length < max ? novas : fora).push({ nome, origem: "band", setor: null, agentes: [] });
    }
    return { times: [...times, ...novas], fora: fora.map(t => t.nome) };
  }

  // edições da prévia: juntar o time i no j, tirar um agente (vai para Novos)
  function juntar(times, i, j) {
    if (i === j || !times[i] || !times[j]) return times;
    const destino = { ...times[j], agentes: [...times[j].agentes, ...times[i].agentes] };
    return times.map((t, k) => (k === j ? destino : t)).filter((_, k) => k !== i);
  }
  const tirar = (times, handle) => times.map(t => ({ ...t, agentes: t.agentes.filter(h => h !== handle) }));

  // o que impede usar a prévia (as mesmas regras do Salvar times), ou ""
  function erroPrevia(times) {
    if (times.length > MAX_TIMES) return `Só cabem ${MAX_TIMES} times: junte alguns antes de usar.`;
    const nomes = new Set();
    for (const t of times) {
      if (!nomeValido(t.nome)) return `“${t.nome || "(sem nome)"}”: dê um nome de até 40 caracteres, só com letras, números, espaço e . ' & -`;
      if (nomes.has(chave(t.nome))) return `Há dois times chamados “${t.nome}”: junte os dois ou mude um nome.`;
      nomes.add(chave(t.nome));
    }
    return "";
  }

  // a prévia vira os times da tela. atuais: os times de agora (mesmo nome guarda tipo, cor sem setor, parede, piso e "de");
  // doSetor(setor) → {cor: #rrggbb|null, icone: ícone do app|null}, do setor do agentes.chat; cores: a paleta de reserva.
  // Cada time leva até 24 agentes: o resto vai para Novos.
  function montar(times, atuais, doSetor, cores) {
    const antes = new Map((atuais || []).map(t => [chave(t.nome), t]));
    let semVaga = 0;
    const lista = times.map((p, i) => {
      const t = antes.get(chave(p.nome)), s = p.setor ? doSetor(p.setor) : {};
      semVaga += Math.max(0, p.agentes.length - MAX_POR_TIME);
      return { nome: p.nome, tipo: t ? t.tipo : tipoSugerido(p.nome), cor: s.cor || (t ? t.cor : cores[i % cores.length]),
        icone: s.icone || iconeSugerido(p.nome), parede: t ? t.parede : i % 6, piso: t ? t.piso : i % 10,
        agentes: p.agentes.slice(0, MAX_POR_TIME), de: t ? t.de : undefined };
    });
    return { times: lista, semVaga };
  }

  // ---------- salas automáticas das bands do Maestri (só exibição: não vão ao servidor nem à planta) ----------
  // vigia(): decide QUANDO o conjunto de bands com sala muda. Band nova entra depois de `atraso` (60 s) de conjunto
  // diferente; band sem terminal fica com a sala até `carencia` (5 min) sem uso. A primeira leitura com bands vale na hora.
  function vigia({ atraso = 60000, carencia = 300000 } = {}) {
    const visto = new Map();   // chave → { nome, em }: a última vez em uso
    let valendo = [], diferenteDesde = null, comecou = false;
    const assinatura = l => l.map(chave).sort().join("\n");
    return function passo(emUso, agora) {
      for (const n of emUso || []) {   // a grafia que chegou primeiro fica
        const nome = limpar(n), k = chave(nome);
        if (nome) visto.set(k, { nome: visto.has(k) ? visto.get(k).nome : nome, em: agora });
      }
      for (const [k, v] of visto) if (agora - v.em >= carencia) visto.delete(k);   // histerese: só some depois da carência
      const quer = [...visto.values()].map(v => v.nome);
      if (assinatura(quer) === assinatura(valendo)) { diferenteDesde = null; return valendo; }
      if (!comecou && quer.length) { comecou = true; valendo = quer; return valendo; }
      if (diferenteDesde === null) diferenteDesde = agora;
      if (agora - diferenteDesde >= atraso) { valendo = quer; diferenteDesde = null; comecou = true; }
      return valendo;
    };
  }
  // as salas: time sem agentes, com o nome da band; nenhuma se já há time de mesmo nome (o terminal vai para ele), e só
  // até o teto de times do prédio (as que passam ficam sem sala: o terminal segue a semente)
  const CORES_SALA = ["#3b82f6", "#22c55e", "#a855f7", "#f97316", "#e8587a", "#14b8a6", "#f5b83d", "#64748b"];
  function salasDasBands(nomes, times, max = MAX_TIMES) {
    const ja = new Set((times || []).map(t => chave(t.nome))), salas = [];
    for (const n of nomes || []) {
      const nome = limpar(n), k = chave(nome);
      if (!nome || ja.has(k) || (times || []).length + salas.length >= max) continue;
      ja.add(k);
      let h = 7; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) % 9973;
      salas.push({ nome, tipo: tipoSugerido(nome), cor: CORES_SALA[h % CORES_SALA.length], icone: iconeSugerido(nome),
        parede: h % 6, piso: h % 10, agentes: [], virtual: true });
    }
    return salas;
  }

  return { MAX_TIMES, MAX_POR_TIME, OUTROS, vigia, salasDasBands, chave, limpar, nomeValido, timeDoNome, timeDoPapel, lerLista, tipoSugerido, iconeSugerido,
    agrupar, teto, comBands, juntar, tirar, erroPrevia, montar };
})();
if (typeof window !== "undefined") window.TimesAuto = TimesAuto;
if (typeof module !== "undefined") module.exports = TimesAuto;
