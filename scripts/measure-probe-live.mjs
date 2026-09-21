/**
 * Live probe measurement harness for dsh-provider-pro.
 *
 * Reads the real `llm-pi-ai` provider config from settings.yaml and the
 * credential from .credentials.yaml (never printed), then runs each phase
 * of the plugin's probe — discovery, wire baseline(user), developer,
 * system, and an image wire POST — against the actual gateway with the same
 * timeouts the plugin uses. Reports per-model phase timing and verdicts so
 * we can see exactly where efficiency / success / trust is lost.
 *
 *   node scripts/measure-probe-live.mjs [--limit N] [--model id]
 *
 * The image phase uses a raw wire POST (not ctx.llm.stream) as a proxy;
 * real DSH stream behavior is measured by the plugin itself. This harness
 * focuses on the wire-level costs that dominate probe-all wall time.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// js-yaml isn't a repo dependency; resolve from the desktop profile's store.
let load
try {
  ;({ load } = require('js-yaml'))
} catch {
  const profileYaml = `${process.env.USERPROFILE || process.env.HOME}\\.dsh\\profiles\\desktop\\node_modules\\js-yaml`
  ;({ load } = require(profileYaml))
}

const home = process.env.USERPROFILE || process.env.HOME
const settingsPath = `${home}\\.dsh\\settings.yaml`
const credsPath = `${home}\\.dsh\\.credentials.yaml`

// ---- resolve credential exactly like the plugin: ref -> plaintext value ----
function resolveApiKey(envRef) {
  const creds = load(readFileSync(credsPath, 'utf8'))
  const ref = creds?.refs?.[envRef]
  if (typeof ref === 'string') return ref
  // dsh-credentials records shape: { kind, payload } — find by ref name
  const records = creds?.records ?? []
  const rec = Array.isArray(records) ? records.find((r) => r?.ref === envRef || r?.name === envRef) : undefined
  return rec?.payload?.value ?? rec?.value ?? rec?.secret
}

// ---- provider config ----
const settings = load(readFileSync(settingsPath, 'utf8'))
const ns = settings?.['llm-pi-ai']
const providerCfg = ns?.providers
if (!providerCfg) {
  console.error('no llm-pi-ai.providers in settings.yaml')
  process.exit(1)
}

const ARGS = process.argv.slice(2)
const limitIdx = ARGS.indexOf('--limit')
const limit = limitIdx >= 0 ? Number(ARGS[limitIdx + 1]) : Infinity
const modelIdx = ARGS.indexOf('--model')
const onlyModel = modelIdx >= 0 ? ARGS[modelIdx + 1] : undefined

const PROBE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const IMAGE_DATA_URL = `data:image/png;base64,${PROBE_IMAGE_BASE64}`

const TIMEOUT_MS = 10000

async function wirePost(baseURL, apiKey, body, headerMs = 8000) {
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`
  const t0 = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), headerMs)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const text = await response.text().catch(() => '')
    return { ms: Date.now() - t0, status: response.status, ok: response.ok, body: text.slice(0, 300) }
  } catch (error) {
    return { ms: Date.now() - t0, status: 0, ok: false, body: error instanceof Error ? error.message : String(error) }
  }
}

async function main() {
  let discovered = []
  const discT0 = Date.now()
  // discovery: GET /v1/models (once)
  for (const [provider, cfg] of Object.entries(providerCfg)) {
    const baseURL = cfg?.baseURL
    if (typeof baseURL !== 'string') continue
    const apiKey = resolveApiKey(cfg?.apiKeyEnv)
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(`${baseURL.replace(/\/+$/, '')}/models`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        signal: controller.signal,
      })
      clearTimeout(timer)
      const j = await res.json().catch(() => ({}))
      const data = Array.isArray(j.data) ? j.data : []
      discovered = data.map((m) => ({ id: m.id, contextWindow: m.context_window, maxTokens: m.max_tokens }))
      console.log(`discovery ${provider}: ${res.status} in ${Date.now() - discT0}ms — ${data.length} models`)
    } catch (e) {
      console.log(`discovery ${provider}: ERR ${e instanceof Error ? e.message : String(e)} in ${Date.now() - discT0}ms`)
    }
    break // only first provider with baseURL (the `fn` route)
  }

  // ---- per-model wire phases, limited concurrency ----
  const allModels = new Map()
  for (const [provider, cfg] of Object.entries(providerCfg)) {
    for (const m of cfg?.models ?? []) {
      allModels.set(m.id, { provider, cfg, model: m })
    }
  }
  const baseURL = [...Object.values(providerCfg)].find((c) => typeof c?.baseURL === 'string')?.baseURL
  const apiKey = baseURL ? resolveApiKey([...Object.values(providerCfg)].find((c) => typeof c?.baseURL === 'string')?.apiKeyEnv) : undefined

  const CONCURRENCY = 4
  const rows = []
  const entries = [...allModels]
  let cursor = 0
  let started = 0
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < entries.length) {
      const [id, { provider, cfg, model }] = entries[cursor++]
      if (onlyModel && id !== onlyModel) continue
      if (started >= limit) continue
      started++
      const row = { id, provider, api: cfg?.api ?? 'openai-completions' }
      if (baseURL && row.api === 'openai-completions') {
        // baseline: status 0 = fast retry at 4s half-budget, 429/5xx = one retry at full 8s
        let baseline = await wirePost(baseURL, apiKey, {
          model: id,
          messages: [{ role: 'user', content: 'Reply OK' }, { role: 'user', content: 'Reply OK' }],
          max_tokens: 4,
        })
        if (baseline.status === 0) {
          // transport silence: fast retry at 2s
          const retry = await wirePost(baseURL, apiKey, {
            model: id,
            messages: [{ role: 'user', content: 'Reply OK' }, { role: 'user', content: 'Reply OK' }],
            max_tokens: 4,
          }, 2000)
          baseline = { ...retry, ms: (baseline.ms ?? 0) + (retry.ms ?? 0) }
        } else if (!baseline.ok && (baseline.status === 429 || baseline.status >= 500)) {
          // transient HTTP: one retry at full budget
          const retry = await wirePost(baseURL, apiKey, {
            model: id,
            messages: [{ role: 'user', content: 'Reply OK' }, { role: 'user', content: 'Reply OK' }],
            max_tokens: 4,
          })
          baseline = { ...retry, ms: (baseline.ms ?? 0) + (retry.ms ?? 0) }
        }
        row.baseline = baseline
        if (baseline.ok) {
          const dev = await wirePost(baseURL, apiKey, {
            model: id,
            messages: [{ role: 'developer', content: 'Reply OK' }, { role: 'user', content: 'Reply OK' }],
            max_tokens: 4,
          })
          row.developer = dev
          if (dev.status === 400 || dev.status === 422 || dev.status >= 500) {
            const roleShaped =
              /role|角色|1214/i.test(dev.body) &&
              !/quota|insufficient|unauthorized|forbidden|not_found|no such model|api key|billing/i.test(dev.body)
            if (roleShaped) {
              const sys = await wirePost(baseURL, apiKey, {
                model: id,
                messages: [{ role: 'system', content: 'Reply OK' }, { role: 'user', content: 'Reply OK' }],
                max_tokens: 4,
              })
              row.system = sys
            }
          }
          const img = await wirePost(baseURL, apiKey, {
            model: id,
            messages: [
              { role: 'user', content: [{ type: 'text', text: 'Reply OK' }, { type: 'image_url', image_url: { url: IMAGE_DATA_URL } }] },
            ],
            max_tokens: 8,
          })
          row.image = img
        }
      }
      rows.push(row)
    }
  })
  await Promise.all(workers)

  // ---- report ----
  console.log('\n== per-model phase timings ==')
  const pad = (s, w) => String(s).padStart(w)
  for (const r of rows) {
    const p = (x) => (x ? `${x.ms}ms/${x.status}` : '  -  ')
    const ms = [r.baseline, r.developer, r.system, r.image].filter(Boolean).reduce((a, b) => a + b.ms, 0)
    const dead = r.baseline && !r.baseline.ok
    const verdict = dead ? 'DEAD' : (r.image?.ok ? 'ok' : 'partial')
    console.log(
      `${pad(r.id, 18)} total=${pad(ms, 5)}ms  baseline=${p(r.baseline)}  dev=${p(r.developer)}  sys=${p(r.system)}  img=${p(r.image)}  → ${verdict}`
    )
    if (r.baseline && !r.baseline.ok) console.log(`    ↳ ${r.baseline.body.slice(0, 120)}`)
    else if (r.image && !r.image.ok) console.log(`    ↳ img ${r.image.body.slice(0, 120)}`)
  }

  const measured = rows.filter((r) => r.baseline || r.image)
  const ok = measured.filter((r) => r.baseline?.ok || r.image?.ok).length
  const dead = measured.filter((r) => r.baseline && !r.baseline.ok).length
  const imgOk = rows.filter((r) => r.image?.ok).length
  const imgCount = rows.filter((r) => r.image).length
  const sumMs = rows.reduce((a, r) => a + [r.baseline, r.developer, r.system, r.image].filter(Boolean).reduce((x, b) => x + b.ms, 0), 0)
  console.log(`\n== summary ==`)
  console.log(`models measured: ${measured.length}, alive: ${ok}, dead baseline: ${dead}`)
  console.log(`image probes: ${imgCount}, accepted: ${imgOk}`)
  console.log(`total wire ms (serial): ${sumMs}ms ≈ ${(sumMs / 1000).toFixed(1)}s`)
  console.log(`avg per model: ${(sumMs / Math.max(measured.length, 1)).toFixed(0)}ms`)
  // biggest time sinks
  const sinks = rows.flatMap((r) => [r.baseline, r.developer, r.system, r.image].filter(Boolean))
    .filter((x) => x.ms >= 5000).sort((a, b) => b.ms - a.ms)
  if (sinks.length) {
    console.log(`\nslowest phases (>=5s): ${sinks.length}`)
    for (const s of sinks.slice(0, 8)) console.log(`  ${s.ms}ms status=${s.status} body=${s.body.slice(0, 80)}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })