"use strict";
// Rádio da firma (static/radio.js): a composição é pura e determinística pela semente; as estações e as preferências
// (por pessoa, neste navegador) nunca ligam o rádio sozinhas.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function carregar(guardado) {
  const armazem = new Map(guardado ? [["escritorio.radio", guardado]] : []);
  const contexto = { window: {}, localStorage: { getItem: k => armazem.get(k) ?? null, setItem: (k, v) => armazem.set(k, v) } };
  vm.runInNewContext(fs.readFileSync("static/radio.js", "utf8"), contexto);
  return contexto.window.Radio;
}
const R = carregar();
const assinatura = ev => JSON.stringify(ev.map(e => [e.b, e.i, e.n, e.v]));

// estações: as três geradas sempre; a da internet só quando o andar tem uma
{
  assert.deepEqual([...R.estacoesDisponiveis(false).map(e => e.id)], ["lofi", "chip", "jazz"]);
  assert.deepEqual([...R.estacoesDisponiveis(true).map(e => e.id)], ["lofi", "chip", "jazz", "internet"]);
  assert.equal(R.escolherEstacao("jazz", false), "jazz");
  assert.equal(R.escolherEstacao("internet", false), "lofi");   // o andar novo não tem rádio da internet
  assert.equal(R.escolherEstacao("internet", true), "internet");
  for (const ruim of ["", "constructor", "__proto__", null, 5]) assert.equal(R.escolherEstacao(ruim, true), "lofi");
}

// preferências: volume entre 0 e 1 (baixo por padrão) e o "ligado" nunca vem do armazenamento (autoplay: só com clique)
{
  assert.deepEqual({ ...R.preferencias(null) }, { estacao: "lofi", volume: 0.35 });
  assert.deepEqual({ ...R.preferencias({ estacao: "chip", volume: 3, ligado: true }) }, { estacao: "chip", volume: 1 });
  assert.equal(R.preferencias({ volume: -1 }).volume, 0);
  assert.equal(R.preferencias({ volume: "0.8" }).volume, 0.35);
  const guardado = carregar(JSON.stringify({ estacao: "jazz", volume: 0.5, ligado: true }));
  assert.deepEqual({ ...guardado.estado }, { ligado: false, estacao: "jazz", volume: 0.5, aviso: "" });
  assert.equal(guardado.tocando, false);
  assert.equal(carregar("{quebrado").estado.estacao, "lofi");
  assert.ok(R.curvaVolume(0) === 0 && R.curvaVolume(0.5) < R.curvaVolume(1) / 2 && R.curvaVolume(1) <= 1);
}

// swing: o contratempo atrasa; o tempo forte e o compasso não mudam
{
  assert.equal(R.tempoDaBatida(1, 0.64), 1);
  assert.ok(Math.abs(R.tempoDaBatida(1.5, 0.64) - 1.64) < 1e-9);
  assert.equal(R.tempoDaBatida(2.5, 0.5), 2.5);
  for (let b = 0; b < 4; b += 0.25) assert.ok(R.tempoDaBatida(b + 0.25, 0.6) > R.tempoDaBatida(b, 0.6));
}

// composição: mesma semente, mesma música; sementes diferentes, músicas diferentes; notas na faixa; sem laço curto
for (const id of R.IDS) {
  const M = R.novaMusica(id, 42), E = R.ESTACOES[id];
  assert.equal(JSON.stringify(R.novaMusica(id, 42)), JSON.stringify(M));
  assert.ok(M.bpm >= E.bpm[0] && M.bpm <= E.bpm[1], `${id}: bpm ${M.bpm}`);
  assert.equal(M.compassos[0].parte, "intro"); assert.equal(M.compassos.at(-1).parte, "fim");
  const duracao = M.compassos.length * 240 / M.bpm;
  assert.ok(duracao > 60 && duracao < 200, `${id}: ${duracao} s por música`);
  const todos = M.compassos.map((_, k) => R.compasso(M, k));
  assert.equal(assinatura(R.compasso(M, 5)), assinatura(todos[5]));
  for (const ev of todos) for (const e of ev) {
    assert.ok(e.b >= 0 && e.b < 4 && e.d > 0 && e.v > 0 && e.v <= 1, `${id}: ${JSON.stringify(e)}`);
    if (e.n !== undefined) assert.ok(Number.isInteger(e.n) && e.n >= 24 && e.n <= 96, `${id}: nota ${e.n}`);
  }
  // nenhum trecho de 8 compassos se repete igual dentro da música (o motivo volta, mas com variação)
  const trechos = new Set();
  for (let k = 0; k + 8 <= todos.length; k++) {
    const t = todos.slice(k, k + 8).map(assinatura).join("|");
    assert.ok(!trechos.has(t), `${id}: trecho repetido no compasso ${k}`);
    trechos.add(t);
  }
  // músicas seguidas mudam (tom, andamento, progressão ou forma)
  const sementes = [1, 2, 3, 4, 5, 6].map(s => R.mistura(42, s)), outras = sementes.map(s => R.novaMusica(id, s));
  assert.ok(new Set(outras.map(m => `${m.tom}/${m.bpm}/${m.compassos.length}`)).size >= 4, `${id}: pouca variação entre músicas`);
  // a melodia aparece, e o final pousa na tônica
  assert.ok(todos.flat().some(e => e.i === "melodia" || e.i === "vibra"), `${id}: sem melodia`);
  const ultimo = M.compassos.at(-1);
  assert.equal(ultimo.acordes[0].grau, 0);
}

// voicing: as vozes do acorde andam pouco (a média muda menos que uma quarta entre acordes vizinhos)
{
  const M = R.novaMusica("lofi", 7);
  const medias = M.compassos.flatMap(c => c.vozes.map(v => v.reduce((s, n) => s + n, 0) / v.length));
  for (let k = 1; k < medias.length; k++) assert.ok(Math.abs(medias[k] - medias[k - 1]) <= 5, `salto ${medias[k - 1]} -> ${medias[k]}`);
}

console.log("test_radio.js ok");
