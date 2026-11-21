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
// o prédio de mentira: o corredor em y=100, a porta do banheiro em x=200 (a sala embaixo do corredor, com três cabines), a
// entrada em x=400 e uma máquina de café com duas vagas
function predio(fora = false) {
  const sala = { tipo: "banheiro", chave: "banheiro", px: 40, py: 120, pw: 192, ph: 176, chao: 168, portas: [200] };
  const cabines = [0, 1, 2].map(i => ({ x: 58 + i * 26, y: 215, px: 44 + i * 26, chao: 168, ocupada: false }));
  return { fora, lista: [], eventos: [],
    vagas: [{ tipo: "cafe", x: 104, y: 140, fechada: false }, { tipo: "cafe", x: 120, y: 140, fechada: true }, { tipo: "lanche", x: 60, y: 140 }],
    predio: { banheiro: { x: 200, y: 100, sala, cabines }, corredorTopo: 90, corredorY: 100, corredorAlt: 20, entrada: { x: 400, calcadaY: 200 }, predioRet: { x: 0, y: 0, w: 420, h: 190 },
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
  const s = m.predio.banheiro.sala;
  assert.ok(rodar(Z, m, 30, () => {
    if (Z.estado().limpando) {
      viuLimpando = true; assert.equal(Z.bloqueado(), true); assert.match(n.fazendo, /Limpando/);
      assert.ok(n.x > s.px && n.x < s.px + s.pw && n.y > s.chao && n.y < s.py + s.ph, `passa o rodo dentro do banheiro: ${n.x}, ${n.y}`);
    }
    return Z.sujeira() === 0;
  }), "ela limpa");
  assert.ok(viuLimpando, "o banheiro fica fechado durante a faxina");
  assert.equal(Z.bloqueado(), false, "limpo: a fila anda de novo");
  assert.ok(rodar(Z, m, 10, () => daEquipe(Z, "limpeza").length === 0), "ela vai embora");
}

// a sujeira aparece no chão do banheiro e aumenta com o uso (papel, poças, o papel higiênico saindo da cabine), dentro da
// sala; interditado, o cone e a placa ficam na porta, no corredor, e o balão "Interditado" junto deles
{
  const Z = carregar(), m = predio();
  Z.passo(m, 0.1, agora, h);
  const b = m.predio.banheiro, s = b.sala;
  assert.equal(Z.sujeiraNoChao(b).length, 0, "limpo: nada no chão");
  let antes = 0;
  for (const n of [20, 40, 60, 80, 95]) {
    Z.limpar(); Z.sujar(n);
    const lista = Z.sujeiraNoChao(b);
    assert.ok(lista.length > antes, `com ${n}, mais sujeira`); antes = lista.length;
    for (const [, , x, y] of lista) assert.ok(x > s.px && x < s.px + s.pw && y > s.chao && y < s.py + s.ph, `no chão do banheiro: ${x}, ${y}`);
  }
  assert.ok(Z.interditado());
  const f = Z.falas().find(q => q.fala === "Interditado");
  assert.ok(f && Math.abs(f.x - b.x) < 16 && f.y > m.predio.corredorTopo && f.y < m.predio.corredorTopo + m.predio.corredorAlt, "o balão na porta, no corredor");
  const feitos = []; const ctx = { set fillStyle(v) { feitos.push(v); }, fillRect(x, y) { feitos.push([x, y]); } };
  Z.ar(ctx, 0);
  assert.ok(feitos.includes("#f08a24"), "o cone laranja"); assert.ok(feitos.includes("#f5c518"), "e a placa amarela");
  assert.equal(Z.sujeiraNoChao({ x: 1, y: 1 }).length, 0, "sem a sala, nada no chão");
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
