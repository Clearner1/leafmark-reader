import {epubWithoutScripts} from './build-security.mjs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {mkdir,copyFile,readFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/main.ts'],bundle:true,platform:'browser',format:'cjs',target:'es2022',external:['obsidian','stream'],plugins:[epubWithoutScripts],alias:{'jszip/dist/jszip':resolve('node_modules/jszip/lib/index.js'),jszip:resolve('node_modules/jszip/lib/index.js'),localforage:resolve('node_modules/localforage/src/localforage.js'),immediate:resolve('src/runtime/immediate.ts'),setimmediate:resolve('src/runtime/setimmediate.ts')},loader:{'.png':'dataurl','.jpg':'dataurl'},outfile:'dist/main.js',logLevel:'info'});
for(const f of ['manifest.json','styles.css','LICENSE','THIRD_PARTY_NOTICES.md']) await copyFile(f,`dist/${f}`);

const bundle=await readFile('dist/main.js','utf8');
if(/createElement\(["']script["']\)|new Function\(|\beval\(/.test(bundle))throw new Error('Unsafe dynamic script capability in release bundle');
