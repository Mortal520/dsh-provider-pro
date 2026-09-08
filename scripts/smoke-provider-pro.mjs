/**
 * Smoke test for the Host half of dsh-provider-pro.
 *
 * Loads the built lib/index.js, mounts it on a fake cordis ctx, and asserts
 * the fetch patch rewrites `user-agent` only for requests whose URL starts
 * with a configured provider baseURL — now origin + path-boundary matched.
 * Also covers the auto-fill pass, the master switch, and the probe
 * consumer's serialization/idempotency/generation supersede behavior.
 * Run: node smoke-provider-pro.mjs
 *
 * IMPORTANT: every request in this test goes through the PATCHED
 * `globalThis.fetch` (assigned to `patched` below) — never the fake
 * `originalFetch` directly, or the patch is bypassed.
 */
import assert from 'node:assert'
import { apply } from '../lib/index.js'

let observedInit = null
const originalFetch = async (input, init) => {
  if (init !== undefined) {
    observedInit = { ...init, headers: new Headers(init.headers) }
  } else if (input instanceof Request) {
    observedInit = { headers: new Headers(input.headers), method: input.method }
  } else {
    observedInit = undefined
  }
  return new Response('ok')
}

globalThis.fetch = originalFetch

function makeCtx(initialSection) {
  let section = initialSection
  const handlers = new Set()
  const cleanups = []
  const mutated = []
  const setPath = (root, path, value) => {
    let node = root
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]
      if (node[key] === undefined) node[key] = {}
      node = node[key]
    }
    node[path[path.length - 1]] = value
  }
  const unsetPath = (root, path) => {
    let node = root
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]
      if (node[key] === undefined) return
      node = node[key]
    }
    delete node[path[path.length - 1]]
  }
  const ctx = {
    get(key) {
      if (key === 'settings') {
        return {
          get(ns) {
            return ns === 'llm-pi-ai' ? section : undefined
          },
          section(ns) {
            return ns === 'llm-pi-ai' ? section : undefined
          },
          async mutate(ns, ops) {
            mutated.push({ ns, ops: structuredClone(ops) })
            for (const op of ops) {
              if (op.op === 'set') setPath(section, op.path, op.value)
              else unsetPath(section, op.path)
            }
          },
        }
      }
      return undefined
    },
    on(event, handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return () => {}
    },
    __bump(ns) {
      for (const handler of [...handlers]) handler(ns)
    },
    __setSection(next) {
      section = next
    },
    __mutated() {
      return mutated
    },
    __dispose() {
      for (const cleanup of cleanups) cleanup()
    },
  }
  return ctx
}

const section = {
  providers: {
    'my-gateway': {
      baseURL: 'https://api.example.com/v1',
      userAgent: 'MyBot/1.0 (test)',
    },
    'no-ua': {
      baseURL: 'https://no-ua.example/api',
    },
  },
}

const ctx = makeCtx(section)
apply(ctx)
const patched = globalThis.fetch

// initial poll syncs (section defined at apply time)
await patched('https://api.example.com/v1/chat/completions', { headers: { 'user-agent': 'attribution', 'x-custom': '1' } })
assert.strictEqual(observedInit.headers.get('user-agent'), 'MyBot/1.0 (test)', 'UA replaced for matching baseURL')
assert.strictEqual(observedInit.headers.get('x-custom'), '1', 'other headers preserved')

// non-matching URL untouched
await patched('https://other.example/v1/models', { headers: { 'user-agent': 'attribution' } })
assert.strictEqual(observedInit.headers.get('user-agent'), 'attribution', 'non-matching URL untouched')

// provider without UA untouched
await patched('https://no-ua.example/api/x', { headers: { 'user-agent': 'attribution' } })
assert.strictEqual(observedInit.headers.get('user-agent'), 'attribution', 'provider without UA untouched')

// settings/updated re-sync picks up a new UA
ctx.__setSection({
  providers: {
    'my-gateway': { baseURL: 'https://api.example.com/v1', userAgent: 'MyBot/2.0' },
  },
})
ctx.__bump('llm-pi-ai')
await patched('https://api.example.com/v1/models', { headers: { 'user-agent': 'attribution' } })
assert.strictEqual(observedInit.headers.get('user-agent'), 'MyBot/2.0', 'settings/updated re-sync applies new UA')

// longest-prefix wins
ctx.__setSection({
  providers: {
    short: { baseURL: 'https://api.example.com/', userAgent: 'Short/1' },
    long: { baseURL: 'https://api.example.com/v1', userAgent: 'Long/1' },
  },
})
ctx.__bump('llm-pi-ai')
await patched('https://api.example.com/v1/models', { headers: { 'user-agent': 'attribution' } })
assert.strictEqual(observedInit.headers.get('user-agent'), 'Long/1', 'longest baseURL prefix wins')

// Request input path
await patched(new Request('https://api.example.com/v1/chat/completions', { headers: { 'user-agent': 'attribution' }, method: 'POST' }))
assert.strictEqual(observedInit.headers.get('user-agent'), 'Long/1', 'Request input also rewritten')
assert.strictEqual(observedInit.method, 'POST', 'method preserved on Request input')

// cleanup
ctx.__dispose()

// patch survives cleanup (state kept), resolver cleared
await patched('https://api.example.com/v1/models', { headers: { 'user-agent': 'attribution' } })
assert.strictEqual(observedInit.headers.get('user-agent'), 'attribution', 'resolver cleared on dispose')

console.log('smoke-provider-pro: OK — fetch UA patch behaves as designed')

/* ----------------------------------------------------------- auto-fill test */

const fillSection = {
  providers: {
    gw: {
      baseURL: 'https://api.example.com/v1',
      userAgent: 'MyBot-Async/1.0',
      models: [
        { id: 'needs-levels' }, // undefined reasoningEfforts -> filled
        { id: 'explicit-off', reasoningEfforts: false }, // explicit false -> untouched
        { id: 'has-dict', reasoningEfforts: { off: null, high: 'high' } }, // existing -> untouched
        { id: 'legacy-fill', reasoningEfforts: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } }, // 0.1.0–0.2.0 auto-fill -> migrated
      ],
    },
  },
}
const fillCtx = makeCtx(fillSection)
apply(fillCtx)
// give the startup poll a tick to run fill (section is defined at apply time,
// so the poll resolves on i=0 and calls fill synchronously)
await new Promise((r) => setTimeout(r, 30))

const writes = fillCtx.__mutated()
const setModels = writes.flatMap((w) => w.ops).find((op) => op.path[0] === 'providers' && op.path[1] === 'gw' && op.path[2] === 'models')
assert.ok(setModels, 'auto-fill emitted a set models op on startup')

const filled = fillSection.providers.gw.models
assert.strictEqual(filled.length, 4, 'kept all four models as declared')
assert.deepStrictEqual(filled[0].reasoningEfforts, { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' }, 'undefined reasoningEfforts replaced with the five-level dictionary')
assert.strictEqual(filled[1].reasoningEfforts, false, 'explicit false left untouched')
assert.deepStrictEqual(filled[2].reasoningEfforts, { off: null, high: 'high' }, 'existing dictionary left untouched')
assert.deepStrictEqual(filled[3].reasoningEfforts, { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' }, 'legacy seven-level auto-fill migrated to the five-level set')

// second scan (settings/updated for our ns) is a no-op — nothing missing anymore
const before = writes.length
fillCtx.__bump('llm-pi-ai')
await new Promise((r) => setTimeout(r, 30))
assert.strictEqual(fillCtx.__mutated().length, before, 'second scan writes nothing (stable)')

// a non-llm-pi-ai settings/updated does not trigger a scan
fillCtx.__bump('other-namespace')
await new Promise((r) => setTimeout(r, 30))
assert.strictEqual(fillCtx.__mutated().length, before, 'settings/updated for another namespace skipped')

// a newly added model without a dict gets filled on the next settings/updated
fillSection.providers.gw.models.push({ id: 'late-model' })
fillCtx.__bump('llm-pi-ai')
await new Promise((r) => setTimeout(r, 30))
const late = fillSection.providers.gw.models.find((m) => m.id === 'late-model')
assert.deepStrictEqual(late.reasoningEfforts, { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' }, 'late-added model filled on settings/updated')

fillCtx.__dispose()
console.log('smoke-provider-pro: OK — reasoning-effort auto-fill fills missing, keeps explicit, stays stable')

/* ---------------------------------------------- master-switch disables fill */

const offSection = {
  dshProviderProAutoReasoning: false,
  providers: {
    gw: { baseURL: 'https://api.example.com/v1', models: [{ id: 'm1' }] },
  },
}
const offCtx = makeCtx(offSection)
apply(offCtx)
await new Promise((r) => setTimeout(r, 30))
assert.strictEqual(offCtx.__mutated().length, 0, 'master switch OFF suppresses the auto-fill')
assert.strictEqual(offSection.providers.gw.models[0].reasoningEfforts, undefined, 'model left untouched when switch OFF')
offCtx.__dispose()
console.log('smoke-provider-pro: OK — master switch suppresses auto-fill when off')

/* ------------------------------------------------ UA URL-boundary safety */

const boundarySection = {
  providers: {
    api: { baseURL: 'https://api.example.com/api', userAgent: 'Api/1' },
    host: { baseURL: 'https://api.example.com/', userAgent: 'Host/1' },
  },
}
const boundaryCtx = makeCtx(boundarySection)
apply(boundaryCtx)
await new Promise((r) => setTimeout(r, 30))
const bPatched = globalThis.fetch

// Path boundary: /api must NOT match /apiX (same origin, adjacent path).
await bPatched('https://api.example.com/apiX/v1/models', { headers: { 'user-agent': 'attribution' } })
assert.strictEqual(observedInit.headers.get('user-agent'), 'attribution', '/api does not match /apiX')

// Origin boundary: an attacker-controlled host prefix must NOT match.
await bPatched('https://api.example.com.evil/v1/models', { headers: { 'user-agent': 'attribution' } })
assert.strictEqual(observedInit.headers.get('user-agent'), 'attribution', 'host-prefix lookalike not rewritten')

// Exact path and subpaths of the configured base still match (longest prefix).
await bPatched('https://api.example.com/api/chat/completions', { headers: { 'user-agent': 'attribution' } })
assert.strictEqual(observedInit.headers.get('user-agent'), 'Api/1', 'exact base path matches')

boundaryCtx.__dispose()
console.log('smoke-provider-pro: OK — UA baseURL matching is origin+path boundary safe')

/* ------------------------------------------------- probe consumer idempotency */

const probeSection = {
  providers: {
    gw: { baseURL: 'https://api.example.com/v1', models: [{ id: 'm1' }] },
  },
}
const probeCtx = makeCtx(probeSection)
apply(probeCtx)
await new Promise((r) => setTimeout(r, 30))
const probeWrites = () => probeCtx.__mutated()

// Request 1: host consumes it stolen from the slot, publishes a result
// (LLM runtime absent in the fake ctx -> an explicit failure result),
// and only THEN records the consumed id.
probeCtx.__setSection({
  ...probeSection,
  dshProviderProProbe: { id: 'req-1', provider: 'gw', model: 'm1', mode: 'full' },
})
probeCtx.__bump('llm-pi-ai')
await new Promise((r) => setTimeout(r, 50))
const resultOps = probeWrites().flatMap((w) => w.ops).filter((op) => op.path[0] === 'dshProviderProProbeResult')
assert.ok(resultOps.length >= 1, 'probe request consumed and a result published')
const published = resultOps[resultOps.length - 1].value
assert.strictEqual(published.id, 'req-1', 'result carries the request id')
assert.strictEqual(published.ok, false, 'result is a failure (no llm runtime)')
assert.match(published.error ?? '', /LLM runtime not available/, 'failure states the missing runtime')

// Same request id re-delivered (e.g. client retry after a failed unset) is
// NOT re-run: idempotent until a NEW request arrives.
const writesBefore = probeWrites().length
probeCtx.__bump('llm-pi-ai')
await new Promise((r) => setTimeout(r, 50))
assert.strictEqual(probeWrites().length, writesBefore, 'same request id is not re-run')

// A NEW request id supersedes: the old generation is no longer current, so
// its late writes are guarded; the new one runs and publishes.
probeCtx.__setSection({
  ...probeSection,
  dshProviderProProbe: { id: 'req-2', provider: 'gw', model: 'm1', mode: 'full' },
})
probeCtx.__bump('llm-pi-ai')
await new Promise((r) => setTimeout(r, 50))
const resultOps2 = probeWrites().flatMap((w) => w.ops).filter((op) => op.path[0] === 'dshProviderProProbeResult')
assert.strictEqual(resultOps2[resultOps2.length - 1].value.id, 'req-2', 'new request id supersedes and publishes')

probeCtx.__dispose()
console.log('smoke-provider-pro: OK — probe consumer is serialized, idempotent, and supersedes by generation')