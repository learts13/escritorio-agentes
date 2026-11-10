"use strict";
// Clima: o vento (do tempo ou ?vento=) inclina a chuva, vem em rajadas e balança as árvores; a tempestade
// desenha o raio onde há céu e manda o trovão mais cedo e mais alto quanto mais perto.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const FONTE = fs.readFileSync("static/clima.js", "utf8");

function carregar(busca = "", aleatorio = Math.random) {
  const timers = [];
  const contexto = {
    location: { search: busca }, URLSearchParams, window: {},
    Math: Object.assign(Object.create(Math), { random: aleatorio }),
    setTimeout: (f, ms) => timers.push([f, ms]),
  };
  vm.runInNewContext(FONTE, contexto);
  return { Clima: contexto.window.Clima, timers };
}

function tela() { // ctx de mentira que guarda as chamadas de desenho
  const chamadas = [];
  const ctx = new Proxy({}, { get: (_, k) => (...a) => chamadas.push([k, ...a]), set: () => true });
  return { ctx, chamadas };
}

const PREDIO = { W: 320, H: 180, predioRet: { x: -10, y: -10, w: 0, h: 0 } };

function rodar(Clima, segundos, p = PREDIO, som = null, ctx = tela().ctx) {
  let t = 0;
  for (let i = 0; i < segundos * 20; i++) { t += 50; Clima.desenhar(ctx, p, 0.05, t, som); }
  return t;
}

// inclinação média dos traços de chuva desenhados no último quadro
function inclinacao(Clima) {
  const { ctx, chamadas } = tela();
  Clima.desenhar(ctx, PREDIO, 0.05, 99999, null);
  const mov = chamadas.filter(c => c[0] === "moveTo"), lin = chamadas.filter(c => c[0] === "lineTo");
  let soma = 0;
  for (let i = 0; i < Math.min(mov.length, lin.length); i++) soma += lin[i][1] - mov[i][1];
  return soma / Math.min(mov.length, lin.length);
}

// calmo e limpo: sem vento, as árvores só respiram (como antes, até 0,8 px)
{
  const { Clima } = carregar();
  Clima.definir({ tipo: "limpo", vento: 3 });
  let t = rodar(Clima, 5);
  assert.equal(Clima.vento, 0);
  for (let k = 0; k < 50; k++) {
    t += 50; Clima.desenhar(tela().ctx, PREDIO, 0.05, t, null);
    assert.ok(Math.abs(Clima.balanco(1)) <= 0.8 + 1e-9);
  }
}

// vento real: a chuva deita e as copas pendem para o lado do vento
{
  const calmo = carregar(), forte = carregar();
  calmo.Clima.definir({ tipo: "chuva", vento: 0 });
  forte.Clima.definir({ tipo: "chuva", vento: 60 });
  rodar(calmo.Clima, 5); let t = rodar(forte.Clima, 5);
  assert.ok(forte.Clima.vento > 0.5, `vento ${forte.Clima.vento}`);
  assert.ok(inclinacao(forte.Clima) > inclinacao(calmo.Clima) + 2, "a chuva com vento deita mais");
  let media = 0;
  for (let k = 0; k < 200; k++) {
    t += 50; forte.Clima.desenhar(tela().ctx, PREDIO, 0.05, t, null);
    media += forte.Clima.balanco(0) / 200;
  }
  assert.ok(media < -1, `a copa pende para o lado do vento (${media})`);
}

// tela aberta por horas com vento: a copa e a neve da janela andam suave, sem tremer quadro a quadro
// (antes a fase era o tempo total dividido por um vento que muda, e saltava até 5 px por quadro)
{
  const passoMax = (busca, minutos, medir, volta = Infinity) => {
    const { Clima } = carregar(busca);
    Clima.definir({ tipo: "limpo" });
    let t = 0, antes = null, maior = 0;
    for (let i = 0; i < minutos * 60 * 60; i++) {   // 60 quadros por segundo
      t += 1000 / 60; Clima.desenhar(tela().ctx, PREDIO, 1 / 60, t, null);
      const agora = medir(Clima, t);
      if (antes !== null && i > 60) maior = Math.max(maior, ...agora.map((v, k) => { const d = Math.abs(v - antes[k]); return Math.min(d, volta - d); }));
      antes = agora;
    }
    return maior;
  };
  const copa = (Clima) => [Clima.balanco(0), Clima.balanco(1.7)];
  const tempestade = passoMax("?clima=tempestade&vento=80", 10, copa);
  assert.ok(tempestade <= 0.3, `a copa anda no máximo 0,3 px por quadro na tempestade (${tempestade})`);
  const chuva = passoMax("?clima=chuva", 30, copa);
  assert.ok(chuva <= 0.3, `nem depois de 30 min de chuva (${chuva})`);
  // neve na janela: posição x de cada floco; a volta (passa da borda e reaparece do outro lado) não conta como salto
  const flocos = (Clima, t) => {
    const janela = tela();
    Clima.naJanela(janela.ctx, { x: 0, y: 0, w: 1000, h: 12 }, t);
    return janela.chamadas.filter(c => c[0] === "fillRect" && c[3] === 1).map(c => c[1]);
  };
  const neve = passoMax("?clima=neve&vento=60", 10, flocos, 1000);
  assert.ok(neve <= 0.5, `o floco da janela anda no máximo 0,5 px por quadro (${neve})`);
}

// rajadas: o vento varia com o tempo, sem tranco de um quadro para o outro
{
  const { Clima } = carregar();
  Clima.definir({ tipo: "chuva", vento: 50 });
  rodar(Clima, 3);
  const valores = [];
  let t = 3000, antes = Clima.vento;
  for (let i = 0; i < 400; i++) {
    t += 50; Clima.desenhar(tela().ctx, PREDIO, 0.05, t, null);
    assert.ok(Math.abs(Clima.vento - antes) < 0.08, "sem tranco");
    antes = Clima.vento; valores.push(antes);
  }
  assert.ok(Math.max(...valores) - Math.min(...valores) > 0.2, "vem em rajadas");
}

// tempestade venta mesmo sem dado de vento
{
  const { Clima } = carregar();
  Clima.definir({ tipo: "tempestade" });
  rodar(Clima, 5);
  assert.ok(Clima.vento > 0.25, `vento ${Clima.vento}`);
}

// ?vento= simula (só número, até 120) e vale por cima do servidor; texto livre é ignorado
{
  const sim = carregar("?clima=chuva&vento=999");
  sim.Clima.definir({ tipo: "limpo", vento: 0 });
  assert.equal(sim.Clima.tipo(), "chuva");
  rodar(sim.Clima, 5);
  assert.ok(sim.Clima.vento > 0.5);
  const lixo = carregar("?vento=forte");
  lixo.Clima.definir({ tipo: "limpo", vento: 0 });
  rodar(lixo.Clima, 3);
  assert.equal(lixo.Clima.vento, 0);
}

// tempestade: raio no céu do bairro, trovão atrasado conforme a distância e com a força certa
{
  const { Clima, timers } = carregar("", () => 0.9);   // sempre "perto"
  Clima.definir({ tipo: "tempestade" });
  const { ctx, chamadas } = tela();
  const trovoes = [];
  rodar(Clima, 20, { ...PREDIO, ceu: true }, { chuva() {}, trovao: f => trovoes.push(f) }, ctx);
  assert.ok(timers.length >= 1, "algum raio caiu");
  for (const [f, ms] of timers) { assert.ok(ms >= 200 && ms <= 2800, `atraso ${ms}`); f(); }
  for (const f of trovoes) assert.ok(f > 0.9 && f <= 1, `trovão perto é forte (${f})`);
  assert.ok(chamadas.some(c => c[0] === "stroke"), "o raio é desenhado no céu");

  const longe = carregar("", () => 0.05);   // sempre longe: ronco fraco e atrasado, sem desenho do raio
  longe.Clima.definir({ tipo: "tempestade" });
  const t2 = tela(), fracos = [];
  rodar(longe.Clima, 20, { ...PREDIO, ceu: true }, { chuva() {}, trovao: f => fracos.push(f) }, t2.ctx);
  for (const [f, ms] of longe.timers) { assert.ok(ms > 2000, `longe demora (${ms})`); f(); }
  for (const f of fracos) assert.ok(f < 0.5, `trovão longe é fraco (${f})`);
  assert.equal(t2.chamadas.filter(c => c[0] === "stroke").length, 20 * 20, "raio longe: só o clarão (um traço por quadro, o da chuva)");
  assert.ok(chamadas.filter(c => c[0] === "stroke").length > 20 * 20, "raio perto: traços a mais no céu");
}

// no escritório (sem céu) o raio não é riscado no chão; ele aparece pela janela
{
  const { Clima } = carregar("", () => 0.9);
  Clima.definir({ tipo: "tempestade" });
  const { ctx, chamadas } = tela();
  let t = 0, viu = false, quadros = 0;
  for (let i = 0; i < 400 && !viu; i++) {
    t += 50; Clima.desenhar(ctx, PREDIO, 0.05, t, null); quadros++;
    if (Clima.raio > 0.4) {
      const janela = tela();
      Clima.naJanela(janela.ctx, { x: 10, y: 10, w: 12, h: 12 }, t);
      viu = janela.chamadas.filter(c => c[0] === "fillRect").length > 5;
    }
  }
  assert.ok(viu, "o raio aparece na janela");
  assert.equal(chamadas.filter(c => c[0] === "stroke").length, quadros, "um traço por quadro: só o da chuva");
}

// ventania leva folhas (fillRect fora da chuva); sem vento, nenhuma
{
  const contaFolhas = vento => {
    const { Clima } = carregar();
    Clima.definir({ tipo: "nublado", vento });
    rodar(Clima, 4);
    const { ctx, chamadas } = tela();
    Clima.desenhar(ctx, PREDIO, 0.05, 4100, null);
    return chamadas.filter(c => c[0] === "fillRect" && c[3] <= 2 && c[4] === 1).length;
  };
  assert.equal(contaFolhas(0), 0);
  assert.ok(contaFolhas(60) >= 5);
}
