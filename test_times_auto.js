"use strict";
// Montar os times automaticamente (static/times_auto.js): as fontes na ordem (lista, setor do agentes.chat, nome, papel),
// o agrupamento sem acento nem caixa, o teto de 12 com "Outros", tipo e ícone sugeridos, a lista colada, as bands e a prévia.
const assert = require("node:assert/strict");
const T = require("./static/times_auto.js");

// os de exemplo, no estilo do dono
const NOMES = ["Gandalf · Maestro", "Heimdall · Sentinela", "Bulma · Arte", "L · Revisão", "Senku · Produção", "Totoro · Coordenação",
  "MacGyver · Infra", "R2-D2 · NOC", "Scotty · Operador", "Hermione · Pesquisa", "Kiki · Social", "Loki · Copy",
  "Lelouch · Comercial", "Baymax · Suporte", "Lodi"];
const handle = n => n.split(" · ")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
const EXEMPLO = NOMES.map(n => ({ handle: handle(n), nome: n, funcao: "" }));

// pelo nome: o que vem depois de " · ", " - " ou " | " (o último), no formato dos times
assert.equal(T.timeDoNome("Gandalf · Maestro"), "Maestro");
assert.equal(T.timeDoNome("R2-D2 · NOC"), "NOC", "hífen sem espaço não separa");
assert.equal(T.timeDoNome("Ana - infra"), "Infra", "primeira letra maiúscula");
assert.equal(T.timeDoNome("Bia | Dados · Growth"), "Growth", "o último separador");
assert.equal(T.timeDoNome("Lodi"), "");
assert.equal(T.timeDoNome(" · Solto"), "", "separador no começo não conta");
assert.equal(T.timeDoNome("Zé · <b>Ops</b>!"), "B Ops b", "caractere fora do formato vira espaço");

// pelo papel: só curto
assert.equal(T.timeDoPapel("Infraestrutura"), "Infraestrutura");
assert.equal(T.timeDoPapel("Cuida de toda a infraestrutura da empresa"), "", "frase longa não vira time");
assert.equal(T.timeDoPapel(""), "");

// 14 times pelo nome viram 12 (11 maiores + Outros), Lodi fica sem time
let r = T.agrupar(EXEMPLO, "");
assert.equal(r.fontes.nome, 14);
assert.deepEqual(r.novos, ["lodi"]);
assert.equal(r.times.length, 12);
assert.equal(r.times[11].nome, "Outros");
assert.deepEqual([...r.juntados], ["Copy", "Comercial", "Suporte"], "empatados: saem os últimos");
assert.deepEqual([...r.times[11].agentes], ["loki", "lelouch", "baymax"]);
assert.equal(T.erroPrevia(r.times), "");

// normalização: "Infra", "infra" e "INFRA " são o mesmo time; vale a grafia mais comum
r = T.agrupar([{ handle: "a", nome: "A · infra" }, { handle: "b", nome: "B · Infra" }, { handle: "c", nome: "C · Infra " },
  { handle: "d", nome: "D · Revisão" }, { handle: "e", nome: "E · revisao" }], "");
assert.deepEqual(r.times.map(t => [t.nome, [...t.agentes]]), [["Infra", ["a", "b", "c"]], ["Revisão", ["d", "e"]]]);

// ordem das fontes por agente: lista > setor > nome > papel; agente repetido conta uma vez
const setor = (nome, ordem, extra = {}) => ({ nome, cor: null, icone: null, ordem, ...extra });
r = T.agrupar([
  { handle: "a", nome: "A · Arte", funcao: "Design", setor: setor("Criação", 1) },
  { handle: "b", nome: "B · Arte", funcao: "Design" },
  { handle: "c", nome: "C", funcao: "Design" },
  { handle: "d", nome: "D · Arte", setor: setor("Direção", 0) },
  { handle: "d", nome: "D de novo · Outra" },
  { handle: "e", nome: "E", setor: null },
], "a, Lista\n");
assert.deepEqual(r.times.map(t => [t.nome, t.origem, [...t.agentes]]),
  [["Direção", "agentes.chat", ["d"]], ["Lista", "lista", ["a"]], ["Arte", "nome", ["b"]], ["Design", "papel", ["c"]]], "setor na ordem de lá primeiro");
assert.deepEqual({ ...r.fontes }, { lista: 1, "agentes.chat": 1, nome: 1, papel: 1 });
assert.deepEqual([...r.novos], ["e"]);

// lista colada: cabeçalho, @, ; e tab, linhas ruins e handles fora da leitura
const l = T.lerLista("handle, time\n@Gandalf, Maestro\nbulma;Arte\nl\tRevisão\n\n# comentário\nsem virgula\n!!, X\nkiki,\n");
assert.deepEqual([...l.pares], [["gandalf", "Maestro"], ["bulma", "Arte"], ["l", "Revisão"]]);
assert.deepEqual(l.erros, [7, 8, 9]);
r = T.agrupar([{ handle: "gandalf", nome: "Gandalf" }], "gandalf, Maestro\nfantasma, Arte");
assert.deepEqual([...r.foraDaLeitura], ["fantasma"]);
assert.equal(r.times.length, 1);

// tipo e ícone pelo nome
for (const [nome, tipo] of [["Infra", "ops"], ["NOC", "ops"], ["Ops", "ops"], ["DevOps", "ops"], ["Infraestrutura", "ops"],
  ["Direção", "gabinete"], ["Diretoria", "gabinete"], ["Gestão", "gabinete"], ["Arte", "mesas"], ["Operador", "mesas"]]) assert.equal(T.tipoSugerido(nome), tipo, nome);
for (const [nome, icone] of [["Maestro", "coroa"], ["Coordenação", "coroa"], ["Infra", "servidor"], ["Operador", "servidor"], ["Dev", "codigo"],
  ["Arte", "pincel"], ["Produção", "pincel"], ["Social", "megafone"], ["Copy", "megafone"], ["Comercial", "grafico"], ["Pesquisa", "grafico"],
  ["Suporte", "sino"], ["Sentinela", "sino"], ["Revisão", "estrela"], ["Games", "controle"], ["Copa", "xicara"], ["Lodi", "pessoas"]]) assert.equal(T.iconeSugerido(nome), icone, nome);

// teto: um "Outros" que já existe recebe os menores
const g = (nome, n) => ({ nome, origem: "nome", setor: null, agentes: Array.from({ length: n }, (_, i) => `${nome.toLowerCase()}${i}`) });
const muitos = [g("Outros", 1), ...Array.from({ length: 13 }, (_, i) => g(`T${i}`, 13 - i))];
const tt = T.teto(muitos);
assert.equal(tt.times.length, 12);
assert.equal(tt.times.filter(t => t.nome === "Outros").length, 1);
assert.deepEqual(tt.juntados, ["T11", "T12"]);
assert.equal(tt.times[11].agentes.length, 1 + 2 + 1);
assert.equal(T.teto([g("A", 1)]).times.length, 1);

// bands: só as que não têm time, depois dos times e até 12
let b = T.comBands([g("Arte", 2)], ["arte", "Esquadrão DM", "Braçal", "", "braçal"]);
assert.deepEqual(b.times.map(t => [t.nome, t.origem, t.agentes.length]), [["Arte", "nome", 2], ["Esquadrão DM", "band", 0], ["Braçal", "band", 0]]);
b = T.comBands(Array.from({ length: 11 }, (_, i) => g(`T${i}`, 1)), ["X", "Y"]);
assert.equal(b.times.length, 12);
assert.deepEqual(b.fora, ["Y"]);

// prévia: juntar, tirar e conferir
let p = [g("A", 2), g("B", 1), g("C", 1)];
p = T.juntar(p, 2, 0);
assert.deepEqual(p.map(t => [t.nome, t.agentes.length]), [["A", 3], ["B", 1]]);
p = T.tirar(p, "b0");
assert.deepEqual(p[1].agentes, []);
assert.match(T.erroPrevia([g("Arte", 1), g("arte", 1)]), /dois times/);
assert.match(T.erroPrevia([g("", 1)]), /nome/);
assert.match(T.erroPrevia(Array.from({ length: 13 }, (_, i) => g(`T${i}`, 1))), /12/);

// montar: mesmo nome guarda tipo, parede, piso e cor (sem setor); o setor dá cor e ícone; 24 por time
const atuais = [{ nome: "infra", tipo: "mesas", cor: "#123456", icone: "pessoas", parede: 4, piso: 7, de: "infra" }];
const doSetor = s => ({ cor: s.cor === "teal" ? "#33b3a0" : null, icone: s.icone === "code" ? "codigo" : null });
const m = T.montar([g("Infra", 30), { ...g("Arte", 1), setor: setor("Arte", 0, { cor: "teal", icone: "code" }) }, g("NOC", 1)], atuais, doSetor, ["#aaaaaa", "#bbbbbb", "#cccccc"]);
assert.deepEqual(m.times[0], { nome: "Infra", tipo: "mesas", cor: "#123456", icone: "servidor", parede: 4, piso: 7, agentes: g("Infra", 24).agentes, de: "infra" });
assert.equal(m.semVaga, 6);
assert.deepEqual([m.times[1].cor, m.times[1].icone, m.times[1].tipo], ["#33b3a0", "codigo", "mesas"]);
assert.deepEqual([m.times[2].tipo, m.times[2].cor, m.times[2].parede, m.times[2].piso, m.times[2].de], ["ops", "#cccccc", 2, 2, undefined]);

// nada dá time: nenhum time, todos em Novos
r = T.agrupar([{ handle: "lodi", nome: "Lodi", funcao: "" }], "");
assert.deepEqual([r.times.length, [...r.novos]], [0, ["lodi"]]);

// salas automáticas das bands: o conjunto, o atraso de 60 s, a carência de 5 min e o teto
const S = 1000, MIN = 60 * S;
let v = T.vigia();
assert.deepEqual([...v([], 0)], [], "sem band, sem sala");
assert.deepEqual([...v(["Esquadrão DM", "esquadrao dm"], 1 * S)], ["Esquadrão DM"], "a primeira leitura com bands vale na hora, sem repetir");
assert.deepEqual([...v(["Esquadrão DM", "Braçal"], 2 * S)], ["Esquadrão DM"], "band nova espera");
assert.deepEqual([...v(["Esquadrão DM", "Braçal"], 61 * S)], ["Esquadrão DM"], "ainda não deu 60 s");
assert.deepEqual([...v(["Esquadrão DM", "Braçal"], 62 * S)].sort(), ["Braçal", "Esquadrão DM"], "60 s depois, entra");
// a Braçal fica sem terminal: a sala segue por 5 min (histerese) e só então sai, ainda com o atraso de 60 s
assert.equal(v(["Esquadrão DM"], 3 * MIN).length, 2);
assert.equal(v(["Esquadrão DM"], 62 * S + 5 * MIN - S).length, 2, "antes dos 5 min, fica");
assert.equal(v(["Esquadrão DM"], 62 * S + 5 * MIN).length, 2, "passou a carência: começa o atraso");
assert.deepEqual([...v(["Esquadrão DM"], 62 * S + 6 * MIN)], ["Esquadrão DM"], "e sai");
// pisca (some e volta antes da carência): nada muda
v = T.vigia();
v(["A"], 0);
for (let t = 10 * S; t < 4 * MIN; t += 10 * S) assert.deepEqual([...v(t % (20 * S) ? [] : ["A"], t)], ["A"]);
// band que aparece um instante: conta como em uso pela carência, e entra 60 s depois da primeira vez
v = T.vigia();
v(["A"], 0); v(["A", "B"], 10 * S);
assert.deepEqual([...v(["A"], 69 * S)], ["A"]);
assert.deepEqual([...v(["A"], 70 * S)], ["A", "B"]);

// as salas: nenhuma para band com time de mesmo nome, e o teto de 12 times
const salas = T.salasDasBands(["Arte", "Esquadrão DM", "infra", "Braçal"], [{ nome: "Infra" }, { nome: "arte" }]);
assert.deepEqual(salas.map(s => [s.nome, s.virtual, s.agentes.length]), [["Esquadrão DM", true, 0], ["Braçal", true, 0]]);
assert.ok(/^#[0-9a-f]{6}$/.test(salas[0].cor) && salas[0].icone === "pessoas" && salas[0].tipo === "mesas");
assert.equal(T.salasDasBands(["NOC Maestri"], [])[0].tipo, "ops", "tipo e ícone pelo nome");
assert.equal(T.salasDasBands(["Esquadrão DM"], [])[0].cor, T.salasDasBands(["esquadrao dm"], [])[0].cor, "a cor sai do nome");
const onze = Array.from({ length: 11 }, (_, i) => ({ nome: `T${i}` }));
assert.deepEqual(T.salasDasBands(["X", "Y", "Z"], onze).map(s => s.nome), ["X"], "só cabe uma");
assert.deepEqual(T.salasDasBands(["X"], [...onze, { nome: "T11" }]), [], "prédio cheio: nenhuma");
