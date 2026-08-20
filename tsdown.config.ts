// tsdown.config.ts — the Client half of an external DSH plugin bundle.
// Mirror of the official `clientBundle()` preset (platform externals + closure
// banner), reduced to what this package needs: no CSS Modules, no Node-first
// deps. The Node half is emitted by `tsc` (see package.json build script).
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-provider-pro'

// Platform modules this bundle may `require()` at runtime. Everything else
// (including any other @deepseek-ai/* value import) is forbidden by the
// purity gate below.
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-slots',
] as const

export default {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false, // keep tsc's lib/index.js + lib/types output
  codeSplitting: false,
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
  },
  plugins: [
    {
      // bundle purity gate: type-only imports are erased and never reach this
      // gate; any cross-plugin value import that is not a platform module is a
      // build error (the same boundary the official preset enforces).
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source as (typeof CLIENT_EXTERNALS)[number])) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services '
          + '(type-only imports are erased and never reach this gate)',
        )
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
} satisfies UserConfig