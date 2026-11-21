// Teste de fumaça do plugin do OpenCode: node --test ponte/integracoes/modelos/
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { createHash, createHmac } from "node:crypto"
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
  assert.equal(opcoes.headers["X-Ponte-Token"], undefined, "o token não viaja")
  assert.equal(opcoes.headers["X-Ponte-Assinatura"],
    assinarTeste("tok-123", opcoes.headers["X-Ponte-Nonce"], createHash("sha256").update(opcoes.body).digest()))
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
  const h = chamadas[0].opcoes.headers
  assert.equal(h["X-Ponte-Assinatura"], assinarTeste("tok-antigo", h["X-Ponte-Nonce"], createHash("sha256").update(chamadas[0].opcoes.body).digest()))
})

// ---------- responder pelo escritório ----------
const pedido = { id: "per1", sessionID: "s1", permission: "bash", patterns: ["git push"], metadata: { segredo: "x" }, always: ["*"] }

function assinarTeste(token, ...partes) {
  const h = createHmac("sha256", token)
  for (const p of partes) h.update(p).update(Buffer.from([0]))
  return h.digest("hex")
}

// a ponte de mentira: confere o HMAC do pedido e assina a resposta (com tokenResposta, a de outro processo)
function ponteDecide(status, acao, segurar, tokenResposta = "tok-123") {
  globalThis.fetch = async (url, opcoes) => {
    chamadas.push({ url, opcoes, corpo: JSON.parse(opcoes.body) })
    if (url.endsWith("/pendente/opencode")) {
      const nonce = opcoes.headers["X-Ponte-Nonce"]
      chamadas.at(-1).assinado = opcoes.headers["X-Ponte-Assinatura"] === assinarTeste("tok-123", nonce, createHash("sha256").update(opcoes.body).digest())
      if (segurar) {
        await new Promise((_, rejeitar) => opcoes.signal.addEventListener("abort", () => rejeitar(new Error("abortado"))))
      }
      const corpo = acao ? JSON.stringify({ acao, assinatura: assinarTeste(tokenResposta, nonce, acao) }) : null
      return new Response(corpo, { status })
    }
    return new Response(null, { status: 204 })
  }
}

function clienteFalso() {
  const respostas = []
  return { respostas, postSessionIdPermissionsPermissionId: async (a) => { respostas.push(a); return {} } }
}

const varias = async () => { for (let i = 0; i < 5; i++) await espera() }

test("permissão: manda só a ferramenta e os padrões e responde com a decisão", async () => {
  ponteDecide(200, "permitir")
  const client = clienteFalso()
  const ganchos = await Firmopolis({ directory: "C:\\proj", client })
  await ganchos.event({ event: { type: "permission.asked", properties: pedido } })
  await varias()
  assert.deepEqual(chamadas[0].corpo.properties, { sessionID: "s1" }, "o evento de estado segue sem o conteúdo")
  const p = chamadas.find((c) => c.url.endsWith("/pendente/opencode"))
  assert.deepEqual(p.corpo, { sessionID: "s1", id: "per1", permission: "bash", patterns: ["git push"], cwd: "C:\\proj" })
  assert.equal(p.opcoes.headers["X-Ponte-Token"], undefined, "o token não vai no pedido")
  assert.ok(p.assinado, "vai o HMAC do token")
  assert.deepEqual(client.respostas, [{ path: { id: "s1", permissionID: "per1" }, body: { response: "once" } }])
})

test("permissão: negar vira reject; sem decisão, nada", async () => {
  ponteDecide(200, "negar")
  let client = clienteFalso()
  let ganchos = await Firmopolis({ directory: "C:\\proj", client })
  await ganchos.event({ event: { type: "permission.v2.asked", properties: { id: "per2", sessionID: "s1", action: "edit", resources: ["a.go"] } } })
  await varias()
  assert.deepEqual(client.respostas, [{ path: { id: "s1", permissionID: "per2" }, body: { response: "reject" } }])

  ponteDecide(200, "permitir", false, "outro-token")
  client = clienteFalso()
  ganchos = await Firmopolis({ directory: "C:\\proj", client })
  await ganchos.event({ event: { type: "permission.asked", properties: pedido } })
  await varias()
  assert.deepEqual(client.respostas, [], "resposta sem a assinatura da ponte não vale")

  ponteDecide(204, null)
  client = clienteFalso()
  ganchos = await Firmopolis({ directory: "C:\\proj", client })
  await ganchos.event({ event: { type: "permission.asked", properties: pedido } })
  await varias()
  assert.deepEqual(client.respostas, [])
})

test("permissão respondida no terminal: o plugin desiste", async () => {
  ponteDecide(200, "permitir", true)
  const client = clienteFalso()
  const ganchos = await Firmopolis({ directory: "C:\\proj", client })
  await ganchos.event({ event: { type: "permission.asked", properties: pedido } })
  await espera()
  await ganchos.event({ event: { type: "permission.replied", properties: { sessionID: "s1", requestID: "per1", reply: "once" } } })
  await varias()
  assert.deepEqual(client.respostas, [])
})

// ---------- responder uma pergunta ----------
const questao = { id: "que1", sessionID: "s1", questions: [{ question: "Qual banco?", header: "Banco", options: [{ label: "Postgres", description: "" }] }] }

// a ponte de mentira da pergunta: devolve o texto assinado sobre o nonce, a ação e o texto
function ponteResponde(texto, { tokenResposta = "tok-123", segurar = false } = {}) {
  globalThis.fetch = async (url, opcoes) => {
    chamadas.push({ url, opcoes, corpo: JSON.parse(opcoes.body) })
    if (url.endsWith("/pendente/opencode-pergunta")) {
      const nonce = opcoes.headers["X-Ponte-Nonce"]
      chamadas.at(-1).assinado = opcoes.headers["X-Ponte-Assinatura"] === assinarTeste("tok-123", nonce, createHash("sha256").update(opcoes.body).digest())
      if (segurar) await new Promise((_, rejeitar) => opcoes.signal.addEventListener("abort", () => rejeitar(new Error("abortado"))))
      return new Response(JSON.stringify({ acao: "responder", texto, assinatura: assinarTeste(tokenResposta, nonce, "responder", texto) }), { status: 200 })
    }
    return new Response(null, { status: 204 })
  }
}

function clientePergunta() {
  const posts = []
  return { posts, _client: { post: async (a) => { posts.push(a); return {} } } }
}

test("pergunta: manda só o texto da questão e responde pela API de perguntas", async () => {
  ponteResponde("Postgres, versão 16")
  const client = clientePergunta()
  const ganchos = await Firmopolis({ directory: "C:\\proj", client })
  await ganchos.event({ event: { type: "question.asked", properties: questao } })
  await varias()
  assert.deepEqual(chamadas[0].corpo.properties, { sessionID: "s1" }, "o evento de estado segue sem a pergunta")
  const p = chamadas.find((c) => c.url.endsWith("/pendente/opencode-pergunta"))
  assert.deepEqual(p.corpo, { sessionID: "s1", id: "que1", pergunta: "Qual banco?", cwd: "C:\\proj" })
  assert.ok(p.assinado)
  assert.deepEqual(client.posts, [{ url: "/question/{requestID}/reply", path: { requestID: "que1" },
    body: { answers: [["Postgres, versão 16"]] }, headers: { "Content-Type": "application/json" } }])
})

test("pergunta: sem assinatura certa, com várias questões ou sem texto livre, nada", async () => {
  ponteResponde("Postgres", { tokenResposta: "outro-token" })
  let client = clientePergunta()
  let ganchos = await Firmopolis({ directory: "C:\\proj", client })
  await ganchos.event({ event: { type: "question.asked", properties: questao } })
  await varias()
  assert.deepEqual(client.posts, [], "resposta sem a assinatura da ponte não vale")

  ponteResponde("Postgres")
  chamadas.length = 0
  client = clientePergunta()
  ganchos = await Firmopolis({ directory: "C:\\proj", client })
  const duas = { ...questao, id: "que2", questions: [questao.questions[0], questao.questions[0]] }
  const fechada = { ...questao, id: "que3", questions: [{ ...questao.questions[0], custom: false }] }
  await ganchos.event({ event: { type: "question.asked", properties: duas } })
  await ganchos.event({ event: { type: "question.asked", properties: fechada } })
  await varias()
  assert.equal(chamadas.filter((c) => c.url.endsWith("/pendente/opencode-pergunta")).length, 0)
  assert.deepEqual(client.posts, [])
})

test("pergunta respondida no terminal: o plugin desiste", async () => {
  ponteResponde("Postgres", { segurar: true })
  const client = clientePergunta()
  const ganchos = await Firmopolis({ directory: "C:\\proj", client })
  await ganchos.event({ event: { type: "question.asked", properties: questao } })
  await espera()
  await ganchos.event({ event: { type: "question.replied", properties: { sessionID: "s1", requestID: "que1", answers: [["MySQL"]] } } })
  await varias()
  assert.deepEqual(client.posts, [])
})
