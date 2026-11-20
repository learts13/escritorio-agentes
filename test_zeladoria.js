"use strict";
// Zeladoria (static/zeladoria.js): o banheiro suja a cada uso (mais com o apertado e quem furou), acima de 60 chama a
// faxineira e acima de 90 fica interditado (a fila espera) até ela limpar; a cafeteira e a luminária quebram, as vagas de
// café fecham e o zelador conserta; o porteiro fica no expediente e o vigia, fora dele.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const FONTE = fs.readFileSync("static/zeladoria.js", "utf8");
let agora = 1000;   // segundos, como o performance.now() / 1000

function carregar() {
  const ceu = { agora: () => ({ h: 9, escuro: 0 }) };
  const contexto = { window: { Ceu: ceu }, performance: { now: () => agora * 1000 }, Math: Object.create(Math) };
  contexto.Math.random = () => 0.4;   // sorteios fixos: a quebra sorteada é a cafeteira
  vm.runInNewContext(FONTE, contexto);
  return contexto.window.Zeladoria;
}
// o prédio de mentira: o corredor em y=100, o banheiro em x=200, a entrada em x=400 e uma máquina de café com duas vagas
function predio(fora = false) {
  return { fora, lista: [], eventos: [],
    vagas: [{ tipo: "cafe", x: 104, y: 140, fechada: false }, { tipo: "cafe", x: 120, y: 140, fechada: true }, { tipo: "lanche", x: 60, y: 140 }],
    predio: { banheiro: { x: 200, y: 100 }, corredorTopo: 90, corredorY: 100, entrada: { x: 400, calcadaY: 200 }, predioRet: { x: 0, y: 0, w: 420, h: 190 },
      luzesTeto: [{ x: 50, y: 93 }, { x: 150, y: 93 }], animados: [{ tipo: "cafe", x: 100, y: 120, w: 8, h: 10 }], objetos: [], salas: [], baixo: [] } };
}
// o caminho do vida.js, simplificado: chega direto no fim da rota
const h = { rotaAte: (m, a, b) => [b], andar: (m, p) => { if (p.rota.length) { const q = p.rota[p.rota.length - 1]; p.x = q[0]; p.y = q[1]; p.rota = []; } } };
function rodar(Z, m, segundos, ate = () => false) {
  for (let i = 0; i < segundos * 10; i++) { agora += 0.1; Z.passo(m, 0.1, agora, h); if (ate()) return true; }
  return false;
}
const daEquipe = (Z, papel) => Z.npcs().filter(n => n.papel === papel);

// a sujeira: cada uso soma; o apertado e quem furou somam mais; fica entre 0 e 100
{
  const Z = carregar();
  assert.equal(Z.sujar("uso"), Z.USO.uso);
  assert.ok(Z.USO.apertado > Z.USO.uso && Z.USO.furou > Z.USO.apertado, "furar e o aperto sujam mais");
  assert.equal(Z.sujar("furou"), Z.USO.uso + Z.USO.furou);
  Z.sujar(500); assert.equal(Z.sujeira(), 100);
  Z.limpar(); assert.equal(Z.sujeira(), 0);
}

// os limites: suja a partir de 60 (moscas e "eca"), interditado a partir de 90 (bloqueado: ninguém entra)
{
  const Z = carregar();
  Z.sujar(59); assert.equal(Z.suja(), false); assert.equal(Z.bloqueado(), false);
  Z.sujar(1); assert.equal(Z.suja(), true); assert.equal(Z.interditado(), false);
  Z.sujar(30); assert.equal(Z.interditado(), true); assert.equal(Z.bloqueado(), true);
}

// interditado: a faxineira vem pela rua, limpa (o banheiro fica bloqueado enquanto isso), zera a sujeira e vai embora;
// a fila volta a andar (bloqueado false)
{
  const Z = carregar(), m = predio();
  Z.passo(m, 0.1, agora, h);   // monta: o porteiro aparece já no posto
  Z.sujar(95);
  assert.ok(rodar(Z, m, 15, () => daEquipe(Z, "limpeza").length === 1), "a faxineira é chamada");
  const n = daEquipe(Z, "limpeza")[0];
  assert.match(n.nome, / · Limpeza$/);
  let viuLimpando = false;
  assert.ok(rodar(Z, m, 30, () => { if (Z.estado().limpando) { viuLimpando = true; assert.equal(Z.bloqueado(), true); assert.match(n.fazendo, /Limpando/); } return Z.sujeira() === 0; }), "ela limpa");
  assert.ok(viuLimpando, "o banheiro fica fechado durante a faxina");
  assert.equal(Z.bloqueado(), false, "limpo: a fila anda de novo");
  assert.ok(rodar(Z, m, 10, () => daEquipe(Z, "limpeza").length === 0), "ela vai embora");
}

// as migalhas: no máximo 6; a faxina da ronda recolhe todas
{
  const Z = carregar(), m = predio();
  Z.passo(m, 0.1, agora, h);
  for (let i = 0; i < 10; i++) Z.migalha(60, 140, "copo", true);
  assert.equal(Z.estado().migalhas, 6);
  assert.ok(Z.chamar("limpeza"), "chamada direta (atalho de teste)");
  assert.equal(Z.chamar("limpeza"), null, "uma faxineira por vez");
  assert.ok(rodar(Z, m, 40, () => Z.estado().migalhas === 0), "recolhe os copos");
}

// a cafeteira quebra: as vagas de café fecham (a que já estava fechada continua); o zelador vem, conserta e elas reabrem
{
  const Z = carregar(), m = predio();
  Z.passo(m, 0.1, agora, h);
  assert.equal(Z.quebrar("cafe"), true);
  assert.equal(Z.quebrar("cafe"), false, "já quebrada");
  assert.equal(Z.quebrado("cafe"), true);
  assert.deepEqual(m.vagas.map(v => v.fechada), [true, true, undefined]);
  assert.equal(Z.falas()[0].fala, "Quebrada!");
  assert.ok(rodar(Z, m, 30, () => daEquipe(Z, "manutencao").length === 1), "o zelador é chamado");
  assert.match(daEquipe(Z, "manutencao")[0].nome, / · Manutenção$/);
  assert.ok(rodar(Z, m, 30, () => !Z.quebrado("cafe")), "ele conserta");
  assert.deepEqual(m.vagas.map(v => v.fechada), [false, true, undefined], "volta o fechada de antes");
  assert.ok(rodar(Z, m, 10, () => daEquipe(Z, "manutencao").length === 0), "e vai embora");
}

// a luminária: a quebrada pisca (apagada quase sempre); as outras ficam acesas; o zelador troca a lâmpada
{
  const Z = carregar(), m = predio();
  Z.passo(m, 0.1, agora, h);
  assert.equal(Z.quebrar("luz"), true);
  const i = Z.estado().quebrado.luz, l = m.predio.luzesTeto[i], outra = m.predio.luzesTeto[1 - i];
  assert.equal(Z.lampadaApagada(outra, 110), false);
  assert.equal(Z.lampadaApagada(l, 110), true);
  assert.equal(Z.lampadaApagada(l, 0), true, "com menos movimento, fica apagada");
  assert.ok(rodar(Z, m, 60, () => !Z.quebrado("luz")), "conserta a luminária");
}

// o porteiro no expediente, o vigia fora dele; na troca, o porteiro vai embora
{
  const Z = carregar(), m = predio(false);
  Z.passo(m, 0.1, agora, h);
  assert.equal(Z.npcs().map(n => n.papel).join(), "portaria");
  assert.match(Z.npcs()[0].nome, /^Seu Lima · Portaria$/);
  m.fora = true;
  assert.ok(rodar(Z, m, 30, () => Z.npcs().map(n => n.papel).join() === "vigia"), "o vigia assume e o porteiro sai");
}

// o porteiro cumprimenta quem passa andando perto do posto
{
  const Z = carregar(), m = predio(false);
  Z.passo(m, 0.1, agora, h);
  const p = Z.npcs()[0];
  m.lista.push({ id: "a1", x: p.x - 10, y: p.y, rota: [[0, 100]] });
  rodar(Z, m, 0.2);
  assert.match(p.fala || "", /Bom dia/);
}

console.log("test_zeladoria.js: ok");
