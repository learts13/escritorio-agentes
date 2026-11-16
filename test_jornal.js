"use strict";
// Jornal do escritório (static/jornal.js): o cabeçalho da edição diz de qual andar ela é (a marca é do prédio, então
// sem o nome do andar a Gazeta de um andar extra sai com o mesmo cabeçalho da do térreo), o andar sem conexão ou sem
// atividade avisa em vez de mostrar uma edição vazia, e a hora extra vira nota.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const codigo = fs.readFileSync("static/jornal.js", "utf8");
const DIA = [{ dia: "2026-11-10", clima: "nublado", greves: 0, brigas: 0 }];
const semana = (agentes = [], dias = []) => ({ inicio: "2026-11-09", agentes, dias });
const agente = (id, extra = 0) => ({ id, tarefas: 0, aprovacoes: 0, respostas: 0, minutos: 0, extra });
const NOMES = { a1: "Atlas", a2: "Bento", a3: "Cora" };
const par = t => [t, "{nome}, com {qtd}"];
const F = {
  nome: "Gazeta do Escritório", calma: ["Semana tranquila"], manchete: ["{nome}: {qtd}"], atras: "Logo atrás: {lista}.",
  aprovacoes: par("Aprovações"), respostas: par("Perguntas"), minutos: par("Tempo"), ringue: par("Ringue"),
  chuva: ["Chuva", "{qtd}"], sol: ["Sol", "{qtd}"], neve: ["Neve", "{qtd}"], variado: ["Tempo variado", "{lista}"],
  agito: ["Agito", "{lista}"], paz: ["Paz", "Nada."],
  extra: ["Hora extra", "{nome} fez {qtd} de hora extra"], extraVarios: "{qtd} ficaram depois do expediente",
  extraQuem: "Quem mais ficou: {nome}, cerca de {qtd}.",   // as de verdade (vida.js): o teste confere o texto montado
};

// DOM mínimo: elementos com filhos e texto, e as três peças da tela do jornal
function elemento(tag) {
  const e = { tag, className: "", textContent: "", hidden: false, children: [], id: "" };
  e.append = (...f) => e.children.push(...f);
  e.replaceChildren = (...f) => { e.children = f; };
  e.setAttribute = () => {};
  Object.defineProperty(e, "tHead", { get: () => e.children.find(c => c.tag === "thead") });
  return e;
}
const textos = e => [e.textContent, ...e.children.flatMap(textos)].filter(Boolean);
const achar = (e, f) => (f(e) ? [e] : []).concat(e.children.flatMap(c => achar(c, f)));

// abre o jornal com a resposta dada do /api/jornal; devolve as peças da tela e a api (para trocar o andar)
async function abrir(resposta, andar = "") {
  const pecas = { jornal: elemento("article"), "jornal-aviso": elemento("p"), "jornal-semanas": elemento("div") };
  const contexto = {
    window: {}, performance: { now: () => 0 }, JSON,
    document: { getElementById: id => pecas[id], querySelectorAll: () => [], createElement: elemento },
    Andar: { com: u => u },
    Vida: { FRASES: { jornal: F } },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ v: 1, semana: semana(), anterior: semana(), conexao: "conectado", ...resposta }) }),
  };
  vm.runInNewContext(codigo, contexto);
  const Jornal = contexto.window.Jornal, api = {
    demo: () => false, socialLigada: () => false, empresa: () => "Minha empresa", andar: () => andar, mini: () => elemento("canvas"),
    agente: id => (NOMES[id] ? { nome: NOMES[id], ap: {} } : null),
  };
  Jornal.iniciar(api);
  await Jornal.abrir();
  return { pecas, api, Jornal };
}
const cabecalho = pecas => textos(pecas.jornal.children.find(c => c.className === "jn-topo")).find(t => t.startsWith("Minha empresa"));
const notas = pecas => achar(pecas.jornal, e => e.className === "jn-nota").map(e => textos(e).join(" | "));

(async () => {
  // térreo (e prédio sem andares extras): o cabeçalho de sempre
  assert.equal(cabecalho((await abrir({})).pecas), "Minha empresa");
  // andar extra: a edição leva o nome dele
  assert.equal(cabecalho((await abrir({}, "Marketing")).pecas), "Minha empresa · Marketing");
  // lista de andares ainda não lida (caso do PR #30): fica só a empresa
  {
    const { pecas, api, Jornal } = await abrir({});
    api.andar = () => undefined;
    Jornal.reiniciar(); await Jornal.abrir();
    assert.equal(cabecalho(pecas), "Minha empresa");
  }

  // trocou de andar com a edição do anterior ainda na mão: o nome é o de quando ela foi lida
  {
    const { pecas, api, Jornal } = await abrir({}, "Marketing");
    api.andar = () => "Financeiro";
    await Jornal.abrir();   // lida há menos de 1 min: redesenha sem pedir de novo
    assert.equal(cabecalho(pecas), "Minha empresa · Marketing");
  }

  // o aviso diz por que o jornal não conta nada, conforme a leitura do andar (a edição que houver continua embaixo)
  const SEM = "Este andar não está conectado: o jornal só conta o trabalho que o escritório lê do agentes.chat.";
  const PROBLEMA = "A leitura do agentes.chat está com problema agora: o jornal pode atrasar.";
  const avisos = { sem_conexao: SEM, recusada: SEM, outra_org: "Este andar está ligado a outro workspace do agentes.chat.", pausa: PROBLEMA, falha: PROBLEMA };
  for (const [conexao, texto] of Object.entries(avisos)) {
    const { pecas } = await abrir({ conexao });
    assert.equal(pecas["jornal-aviso"].hidden, false, conexao);
    assert.equal(pecas["jornal-aviso"].textContent, texto, conexao);
    assert.equal(pecas.jornal.hidden, false);
  }
  for (const conexao of [undefined, "carregando"]) {   // conectado (o padrão do teste) e carregando: sem aviso
    const { pecas } = await abrir(conexao ? { conexao } : {});
    assert.equal(pecas["jornal-aviso"].hidden, true, conexao);
  }

  // conectado, semana sem ninguém trabalhando (só o clima anotado): uma linha no lugar da tabela vazia
  {
    const { pecas } = await abrir({ semana: semana([], DIA) });
    assert.equal(achar(pecas.jornal, e => e.tag === "table").length, 0);
    assert.ok(textos(pecas.jornal).includes("Ainda sem atividade neste andar nesta semana."));
  }
  {
    const { pecas } = await abrir({ semana: semana([agente("a1")], DIA) });   // com gente: a tabela de sempre
    assert.equal(achar(pecas.jornal, e => e.tag === "table").length, 1);
    assert.ok(!textos(pecas.jornal).includes("Ainda sem atividade neste andar nesta semana."));
  }

  // hora extra: um agente diz quanto; vários, quantos ficaram depois do expediente (e quem ficou mais)
  {
    const { pecas } = await abrir({ semana: semana([agente("a1", 120), agente("a2")], DIA) });
    assert.ok(notas(pecas).includes("Hora extra | Atlas fez 2 h de hora extra"), notas(pecas).join("\n"));
  }
  {
    const { pecas } = await abrir({ semana: semana([agente("a1", 30), agente("a2", 95), agente("a3", 5)], DIA) });
    assert.ok(notas(pecas).includes("Hora extra | 3 agentes ficaram depois do expediente | Quem mais ficou: Bento, cerca de 1 h 40."), notas(pecas).join("\n"));
  }
  {
    const { pecas } = await abrir({ semana: semana([agente("a1"), agente("a2")], DIA) });
    assert.ok(!notas(pecas).some(n => n.startsWith("Hora extra")));   // ninguém ficou: sem nota
  }
  console.log("test_jornal.js ok");
})().catch(e => { console.error(e); process.exit(1); });
