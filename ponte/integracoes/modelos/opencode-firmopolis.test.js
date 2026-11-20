// Teste de fumaça do plugin do OpenCode: node --test ponte/integracoes/modelos/
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Firmopolis } from "./opencode-firmopolis.js"

let pasta, chamadas, fetchOriginal, envOriginal, argvOriginal

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "ev-plugin-"))
  envOriginal = { ...process.env }
  argvOriginal = process.argv
  // A pasta de config do usuário aponta para a temporária em qualquer sistema.
  process.env.APPDATA = pasta
  process.env.XDG_CONFIG_HOME = pasta
  process.env.HOME = pasta
  process.env.MAESTRI_TERMINAL_ID = "T1"
  mkdirSync(join(pasta, "Firmopolis"), { recursive: true })
  mkdirSync(join(pasta, "Library", "Application Support", "Firmopolis"), { recursive: true })
  for (const dir of [join(pasta, "Firmopolis"), join(pasta, "Library", "Application Support", "Firmopolis")]) {
    writeFileSync(join(dir, "token"), "tok-123\n")
  }
  chamadas = []
  fetchOriginal = globalThis.fetch
  globalThis.fetch = async (url, opcoes) => {
    chamadas.push({ url, opcoes, corpo: JSON.parse(opcoes.body) })
    return new Response(null, { status: 204 })
  }
})

afterEach(() => {
  globalThis.fetch = fetchOriginal
  process.env = envOriginal
  process.argv = argvOriginal
  rmSync(pasta, { recursive: true, force: true })
})

const espera = () => new Promise((r) => setImmediate(r))

test("manda o evento para a ponte com os headers certos", async () => {
  const ganchos = await Firmopolis({ directory: "C:\\proj\\loja" })
  await ganchos.event({ event: { type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } } })
  await espera()

  assert.equal(chamadas.length, 1)
  const { url, opcoes, corpo } = chamadas[0]
  assert.equal(url, "http://127.0.0.1:47820/evento/opencode")
  assert.equal(opcoes.method, "POST")
  assert.equal(opcoes.headers["X-Ponte-Token"], "tok-123")
  assert.equal(opcoes.headers["X-Maestri-Terminal-Id"], "T1")
  assert.equal(opcoes.headers["Content-Type"], "application/json")
  assert.deepEqual(corpo, { type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } }, cwd: "C:\\proj\\loja", pid: process.pid })
})

test("properties ou args nulos não fazem o plugin lançar", async () => {
  const ganchos = await Firmopolis({ directory: "C:\\proj" })
  await ganchos.event({ event: { type: "session.idle", properties: null } })
  await ganchos.event({ event: null })
  await ganchos.event(null)
  await ganchos["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, { args: null })
  await ganchos["tool.execute.before"](null, null)
  await espera()
})

test("o comando vai só na 1ª linha", async () => {
  const ganchos = await Firmopolis({ directory: "C:\\proj" })
  await ganchos["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, { args: { command: "go test ./...\ncat <<EOF\nsegredo\nEOF" } })
  await espera()
  assert.equal(chamadas[0].corpo.properties.args.command, "go test ./...")
})

test("ignora eventos que a ponte não usa", async () => {
  const ganchos = await Firmopolis({ directory: "C:\\proj" })
  await ganchos.event({ event: { type: "message.part.updated", properties: { sessionID: "s1" } } })
  await espera()
  assert.equal(chamadas.length, 0)
})

test("tool.execute.before manda só o arquivo, o comando ou a URL", async () => {
  const ganchos = await Firmopolis({ directory: "C:\\proj" })
  await ganchos["tool.execute.before"]({ tool: "write", sessionID: "s1", callID: "c1" }, { args: { filePath: "C:\\proj\\a.go", content: "segredo".repeat(1000) } })
  await espera()
  assert.deepEqual(chamadas[0].corpo.properties, { sessionID: "s1", tool: "write", args: { filePath: "C:\\proj\\a.go" } })
})

test("permissão e pergunta não levam o conteúdo do pedido", async () => {
  const ganchos = await Firmopolis({ directory: "C:\\proj" })
  await ganchos.event({ event: { type: "permission.asked", properties: { id: "p1", sessionID: "s1", permission: "bash", patterns: ["rm -rf /"], metadata: { command: "rm -rf /" } } } })
  await espera()
  assert.deepEqual(chamadas[0].corpo.properties, { sessionID: "s1" })
})

test("sessão filha leva o pai nos eventos seguintes", async () => {
  const ganchos = await Firmopolis({ directory: "C:\\proj" })
  await ganchos.event({ event: { type: "session.created", properties: { sessionID: "f1", info: { id: "f1", parentID: "s1", directory: "C:\\proj", title: "x" } } } })
  await ganchos.event({ event: { type: "session.idle", properties: { sessionID: "f1" } } })
  await espera()
  assert.equal(chamadas.length, 2)
  assert.equal(chamadas[0].corpo.pai, "s1")
  assert.deepEqual(chamadas[0].corpo.properties.info, { id: "f1", parentID: "s1", directory: "C:\\proj" })
  assert.equal(chamadas[1].corpo.pai, "s1")
})

test("nunca lança erro com a ponte desligada", async () => {
  globalThis.fetch = async () => { throw new TypeError("fetch failed") }
  const ganchos = await Firmopolis({ directory: "C:\\proj" })
  await ganchos.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  await ganchos["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, { args: { command: "ls" } })
  globalThis.fetch = () => { throw new Error("síncrono") }
  await ganchos.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  await espera()
})

test("sem token não manda nada", async () => {
  rmSync(join(pasta, "Firmopolis", "token"))
  rmSync(join(pasta, "Library", "Application Support", "Firmopolis", "token"))
  const ganchos = await Firmopolis({ directory: "C:\\proj" })
  await ganchos.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  await espera()
  assert.equal(chamadas.length, 0)
})

test("opencode run não manda nada", async () => {
  process.argv = ["opencode", "run", "faça x"]
  const ganchos = await Firmopolis({ directory: "C:\\proj" })
  assert.deepEqual(ganchos, {})
})

test("quem ainda tem a pasta antiga (EscritorioVivo) segue mandando", async () => {
  rmSync(join(pasta, "Firmopolis", "token"))
  rmSync(join(pasta, "Library", "Application Support", "Firmopolis", "token"))
  for (const dir of [join(pasta, "EscritorioVivo"), join(pasta, "Library", "Application Support", "EscritorioVivo")]) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "token"), "tok-antigo\n")
  }
  const ganchos = await Firmopolis({ directory: "C:\\proj" })
  await ganchos.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  await espera()
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].opcoes.headers["X-Ponte-Token"], "tok-antigo")
})
