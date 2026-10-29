import {describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {epubWithoutScripts, removeScriptLoader} from '../build-security.mjs';

describe('script-free EPUB distribution',()=>{
  it('removes only the two unused upstream script loaders and fails closed on unexpected source',async()=>{
    for(const [file,method] of [['contents','addScript'],['rendition','injectScript']]){
      const source=await readFile(`node_modules/epubjs/src/${file}.js`,'utf8');
      const patched=removeScriptLoader(source,method);
      expect(patched).toContain(`${method}() { return Promise.resolve(false); }`);
      expect(patched).not.toMatch(/createElement\(["']script["']\)/);
      expect(patched.slice(0,patched.indexOf(`${method}()`)).trim()).toBe(source.slice(0,source.indexOf(`${method}(`)).trim());
    }
    expect(()=>removeScriptLoader('unexpected source','addScript')).toThrow('Unsupported');
  });
  it('bundles EPUB.js and successfully decompresses a ZIP with the replacement schedulers',async()=>{
    const result=await build({stdin:{contents:`import JSZip from 'jszip'; import {Book} from 'epubjs'; export {Book}; export async function roundTrip(){const zip=new JSZip();zip.file('chapter.xhtml','Readable passage');const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});return (await JSZip.loadAsync(bytes)).file('chapter.xhtml').async('string');}`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'cjs',external:['stream'],write:false,plugins:[epubWithoutScripts],alias:{'jszip/dist/jszip':resolve('node_modules/jszip/lib/index.js'),jszip:resolve('node_modules/jszip/lib/index.js'),localforage:resolve('node_modules/localforage/src/localforage.js'),immediate:resolve('src/runtime/immediate.ts'),setimmediate:resolve('src/runtime/setimmediate.ts')}});
    const source=result.outputFiles[0].text;
    expect(/createElement\(["']script["']\)|new Function\(|\beval\(/.test(source)).toBe(false);
    const module={exports:{} as {roundTrip:()=>Promise<string>}};
    runInNewContext(source,{module,exports:module.exports,require:createRequire(import.meta.url),window:{setTimeout,clearTimeout},setTimeout,clearTimeout,setImmediate,clearImmediate,queueMicrotask,console,Uint8Array,ArrayBuffer,Buffer});
    expect(await module.exports.roundTrip()).toBe('Readable passage');
  });
});
