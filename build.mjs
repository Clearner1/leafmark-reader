import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/main.ts'],bundle:true,platform:'browser',format:'cjs',target:'es2022',external:['obsidian'],loader:{'.png':'dataurl','.jpg':'dataurl'},outfile:'dist/main.js',logLevel:'info'});
for(const f of ['manifest.json','styles.css','LICENSE','THIRD_PARTY_NOTICES.md']) await copyFile(f,`dist/${f}`);
