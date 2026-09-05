# dsh-provider-pro

[English](#english) · [中文](#中文)

DeepSeek Harness 插件：为自定义供应方（`llm-pi-ai` 手动添加的 provider）补上两个 DSH 官方渠道才有的能力，开箱即用、零逐模型配置。

A DeepSeek Harness plugin that gives custom providers (hand-added via the
`llm-pi-ai` provider) two capabilities that official channels already have —
out of the box, with no per-model configuration.

> **兼容性**：需要 **DSH Desktop 2.0+**（客户端 RPC 走 `ctx.remote.settings`）。
> 已对照 DSH Desktop 2.0.4（harness `0.1.2-alpha.1`、cordis `4.0.1`）逐面核验：
> settings 服务与 RPC、`settings.section` 槽、ModuleLoader bundle 协议、设计令牌、
> pi-ai 推理词典语义。
> Requires **DSH Desktop 2.0+** (the client half talks to `ctx.remote.settings`);
> verified surface-by-surface against DSH Desktop 2.0.4 (harness 0.1.2-alpha.1,
> cordis 4.0.1).

---

## 中文

### 功能

1. **自定义 User-Agent** — 为每个自定义供应方设置请求 UA（覆盖内置 attribution 头），
   应对按 UA 限流、或禁止非官方终端应用访问的供应方。
2. **推理等级切换** — 与官方渠道一样的思考等级下拉。数据层自动完成：
   Host 半自动为每个缺少 `reasoningEfforts` 的自定义模型写入五档词典
   （`off` → `null`，`low/medium/high/max` → 同名值），
   对话模型选择器随即出现推理等级行；
   `defaultEffort` 不写 → 初始档位为 **Default**（请求不带思考参数，由供应方
   自行决定）。切换发生在聊天里，无需设置。
3. **图片输入声明** — 每个模型卡片内提供「支持图片输入」复选框，
   勾选即写入 `input: [text, image]`，DSH 随即允许向该模型附加图片。
4. **一键全量探测与测活**（内置）— 每个模型旁一个「探测」按钮，一次实测四项：
   - **上下文窗口**：调 `/v1/models` 拉取 `contextWindow`/`maxTokens`，
     缺失字段自动回填（手工值不覆盖）；
   - **角色兼容**：pi-ai 的 openai-completions 兼容层默认对推理模型发送
     `developer` 角色（部分上游如 GLM 中转直接拒绝，报 1214「角色信息不正确」）。
     探测发极小请求实测；被拒且 `system` 可用时自动写入
     `compat.supportsDeveloperRole: false`（回退 system），即刻修复；
   - **推理等级据实校准**：low/medium/high/max 逐档发送 `reasoning_effort`
     极小请求（`max_tokens: 1`），被拒档位从 `reasoningEfforts` 中移除，
     全拒则写 `false`（真·非推理模型）——聊天里的档位开关从此只出现
     上游真正接受的档；
   - **图片输入 + 延迟**：通过 DSH LLM 运行时发送带 1×1 PNG 的真实流式
     请求（最后一步，验证修复后的真实配置），报告首 token 延迟与图片接受。
   所有写回（回填 + compat + 档位字典）合并在**一次** models 数组 mutate 中，
   互不覆盖。wire 检查仅对 `openai-completions` 路由生效。
   供应商卡片头显示 可达/不可达/未测 徽章，模型行显示对应状态点；
   「一键探测」对全部模型走同一全量探测。

### 安装

```sh
# 方式一：git 安装（需要一次构建许可，见下）
dsh plugin --profile web add github:Mortal520/dsh-provider-pro

# 方式二：本地仓库 / tarball（免构建许可）
dsh plugin --profile web add ./dsh-provider-pro
dsh plugin --profile web add ./dsh-provider-pro-0.3.0.tgz   # 先 pnpm pack
```

> git 安装注意：pnpm ≥10 默认拒绝运行 git 依赖的构建脚本。首次 `add` 报错时，
> 把 pnpm 提示的那个包 key 写进 profile 的 `pnpm-workspace.yaml`：
> ```yaml
> allowBuilds:
>   dsh-provider-pro: true
> ```
> 然后重跑 `add`。这是对包内代码在你机器上执行的一次性授权——只允许可信来源，
> 并建议锁定提交（`github:Mortal520/dsh-provider-pro#<sha>`）。
>
> 为避免该步骤，本仓库**已提交构建产物 `lib/`**，也可直接用 tarball/本地路径安装。

安装后**重启 dsh web** 生效。

### 用法（设置 → 模型增强）

在「模型」下方新增的原生设置页（与官方页同款令牌样式）：

- **总开关「为全部自定义模型启用推理等级切换」**（默认开）：控制功能 2。
  关闭时，自动补全的档位会被移除、回到供应方默认；你在别处手动设过的等级不受影响。
- **每个供应方一张 User-Agent 卡**：填写后保存，发往该供应方 baseURL 前缀的请求
  带上此 UA；留空保存即清除覆盖。

### 平台红线（第三方插件无法突破）

**对话模型选择器内部的档位名是 `dsh-llm-pi-ai` 硬编码英文**
（Off / Minimal / … / Max，`reasoningInfo()` 在 `dsh-llm-pi-ai/lib/index.js` 写死），
第三方插件无法为其改语言，`defaultEffort` 也不接受中文名值。中文能力只覆盖本插件的
设置页。若需要选择器内中文化，只能改 `dsh-llm-pi-ai` 本体。

### 实现原理（给维护者）

- **推理等级（数据层）**：完整 `reasoningEfforts` 词典 → pi-ai `resolveModelReasoning`
  → 模型 `reasoning = { thinkingLevelMap 全 5 档 }` → ModelSelect 的 Effort 行天然出现；
  `defaultEffort` 留空 → 选择器自动前置「Default」并默认选中。
- **总开关**：`llm-pi-ai` 用户层顶层的 `dshProviderProAutoReasoning`（缺省 = 开），
  Host 补档器每次扫描前检查该标志；客户端点开关一次性写入
  标志 + 移除字节级相同的自动补档词典。
- **UA**：pi-ai 会过滤用户 `headers` 里任意大小写的 user-agent、再追加 attribution 头
  （`requestHeaders()`），改 `settings.headers` 是死路。Host 半在宿主进程对
  `globalThis.fetch` 做一次 URL 前缀匹配的最小补丁：仅当请求 URL 命中某供应方 baseURL、
  且该供应方配置了 `userAgent`（存于 `llm-pi-ai.providers.<route>.userAgent`，
  schema 非严格保字段、适配器不读）时**替换**（而非追加）`User-Agent`。
- **区块**：`settings.section` 槽，`id: provider-pro`、`order: 15`（官方「模型」=10）。

### 构建与验证

```sh
pnpm install
pnpm run check    # 类型检查 + 构建 + 离线产物校验
pnpm run smoke    # Host 行为冒烟（fetch 补丁 / 补档器 / 总开关）
```

`lib/` 是发布产物，**已提交进仓库**（git 安装免重建即可用）。

### 已知限制

- 选择器内档位名 = `dsh-llm-pi-ai` 硬编码英文，无法中文化（见「平台红线」）。
- 补档器只在 `llm-pi-ai` namespace 内、手声明 `models[]` 的条目生效；
  不触碰 `modelOverrides` 与官方渠道（catalog）。

---

## English

### Features

1. **Custom User-Agent** — set a request-level UA per custom provider
   (overrides DSH's built-in attribution header). Handles providers that
   rate-limit by UA or reject non-official terminal apps.
2. **Reasoning-level switching** — the same reasoning picker as the official
   channels (off / low / medium / high / max). Fully data-driven, no per-model
   setup: the host fills a five-level `reasoningEfforts` dictionary for every
   hand-declared custom model that lacks one and keeps `defaultEffort` unset,
   so the picker preselects **Default** (no thinking parameter is sent; the
   provider decides). Switch levels any time in chat.
3. **Image-input declaration** — each model card shows a "Support image input"
   checkbox; checking it writes `input: [text, image]` so DSH allows image
   attachments for that model.
4. **One-button full probe & liveness** — each model row has a single
   "Probe" button that measures everything in one pass:
   - **Context window**: calls `/v1/models` for `contextWindow`/`maxTokens`
     and backfills missing fields (hand-set values are never overwritten).
   - **Message-role compat**: pi-ai's openai-completions layer defaults to
     sending OpenAI's `developer` role for reasoning-capable models — which
     some upstreams (GLM behind a relay, error 1214) refuse. A minimal wire
     request verifies it; when `developer` is refused while `system` passes,
     `compat.supportsDeveloperRole: false` is written automatically.
   - **Reasoning levels, measured as real**: each of low/medium/high/max
     gets one `max_tokens: 1` request carrying `reasoning_effort`; refused
     levels are dropped from `reasoningEfforts` (all refused → the entry
     becomes a non-reasoning model, `reasoningEfforts: false`) — the chat
     picker only ever offers levels the upstream actually accepts.
   - **Image input + latency**: a real stream carrying a 1×1 PNG through
     DSH's LLM runtime (run last, exercising the exact post-fix config)
     reports first-token latency and image admission.
   All write-backs (backfill + compat + efforts) land in ONE models-array
   mutate. Wire checks apply only to `openai-completions` routes.
   Provider card headers show an up/down/untested badge and each model row a
   matching status dot, aggregated from the latest results.

### Install

```sh
# git install (needs one build allow, see note)
dsh plugin --profile web add github:Mortal520/dsh-provider-pro

# or a local checkout / tarball (no build permission needed)
dsh plugin --profile web add ./dsh-provider-pro
dsh plugin --profile web add ./dsh-provider-pro-0.3.0.tgz   # after pnpm pack
```

> git installs run the package's `prepare` script. pnpm ≥10 blocks that until
> you allow it: copy the package key pnpm prints into the profile's
> `pnpm-workspace.yaml` (`allowBuilds: dsh-provider-pro: true`) and re-run
> `add`. Only allow packages you trust — and preferably pin a commit
> (`github:Mortal520/dsh-provider-pro#<sha>`).
>
> To avoid that step entirely, this repo commits its built `lib/`, and
> tarball/local installs need no build permission at all.

Restart `dsh web` after installing.

### Usage (Settings → 模型增强)

A native settings section right below the official 模型 page:

- **Master switch "Enable reasoning-level switching for all custom models"**
  (on by default) — controls feature 2. Turning it off strips only the
  auto-filled dictionaries (byte-identical ones) and leaves any level you set
  manually untouched.
- **One User-Agent card per provider** — save to apply the UA to requests
  whose URL starts with that provider's baseURL; empty + save clears it.

### Platform red line

Effort-level names **inside the model picker are hardcoded English** in
`dsh-llm-pi-ai` and cannot be localized by a third-party plugin; our Chinese
labels cover this plugin's own settings section only. In-picker Chinese
requires patching `dsh-llm-pi-ai` itself.

### Build & verify

```sh
pnpm install
pnpm run check    # typecheck + build + offline artifact validation
pnpm run smoke    # host smoke tests (fetch patch / filler / master switch)
```

`lib/` is the build artifact and is committed, so a git install works without
building.

### Known limitations

- In-picker effort names are English-only (see platform red line).
- The filler only touches hand-declared `models[]` under the `llm-pi-ai`
  namespace; it never touches `modelOverrides` or catalog models.

---

## License

[MIT](./LICENSE) · [Changelog](./CHANGELOG.md)