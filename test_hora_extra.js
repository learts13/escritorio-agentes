"use strict";
// Hora extra (static/vida.js: Vida.horaExtra): fora do expediente do andar, quem tem tarefa fica na mesa de hora extra
// (luminária acesa e a etiqueta na ficha); dentro do expediente, ou sem tarefa, não há hora extra.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const FONTE = fs.readFileSync("static/vida.js", "utf8");
const EXPEDIENTE = fs.readFileSync("static/expediente.js", "utf8");

// o navegador falso: só o relógio do céu (hora decimal) e o expediente do andar
function carregar(h, expediente = null) {
  const contexto = { document: { addEventListener() {}, hidden: false }, window: {}, performance: { now: () => 1000 }, Ceu: { agora: () => ({ h }) }, location: { hash: "" }, localStorage: null };
  vm.runInNewContext(EXPEDIENTE, contexto);
  contexto.Expediente = contexto.window.Expediente;
  if (expediente) contexto.Expediente.definir(expediente);
  vm.runInNewContext(FONTE, contexto);
  return contexto.window.Vida;
}

const MESA = { x: 10, pe: 20 };
const comTarefa = (status = "running") => ({ trabalho: { status }, mesa: MESA });
const semTarefa = () => ({ trabalho: null, mesa: MESA });

// dentro do expediente (07:00 às 20:00 de padrão): ninguém faz hora extra, com ou sem tarefa
{
  const Vida = carregar(10);
  assert.equal(Vida.horaExtra(comTarefa()), false);
  assert.equal(Vida.horaExtra(semTarefa()), false);
}

// fora do expediente: só quem está trabalhando faz hora extra (esperando aprovação ou resposta não, como no jornal)
{
  const Vida = carregar(22);
  assert.equal(Vida.horaExtra(comTarefa()), true);
  assert.equal(Vida.horaExtra(comTarefa("still_running")), true);
  assert.equal(Vida.horaExtra(comTarefa("waiting_approval")), false);
  assert.equal(Vida.horaExtra(comTarefa("waiting_response")), false);
  assert.equal(Vida.horaExtra(semTarefa()), false);
  assert.equal(Vida.horaExtra({ trabalho: { status: "running" }, mesa: null }), false, "sem mesa não há mesa de hora extra");
}

// o expediente é o do andar (Personalizar), inclusive o turno que vira a meia-noite
{
  const noturno = { abre: "22:00", fecha: "06:00" };
  assert.equal(carregar(23, noturno).horaExtra(comTarefa()), false, "23h está dentro do turno 22-06");
  assert.equal(carregar(12, noturno).horaExtra(comTarefa()), true, "meio-dia está fora do turno 22-06");
}

// o segundo argumento vale no lugar do relógio (o app.js passa o mundo.fora, lido uma vez por quadro)
{
  const Vida = carregar(10);
  assert.equal(Vida.horaExtra(comTarefa(), true), true);
  assert.equal(Vida.horaExtra(comTarefa(), false), false);
}

console.log("test_hora_extra.js: ok");
