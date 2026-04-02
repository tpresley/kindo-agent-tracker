import { build } from 'esbuild'

await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/server-entry.mjs',
  external: ['better-sqlite3'],
  banner: {
    js: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
  },
})

console.log('Server built to dist/server-entry.mjs')
