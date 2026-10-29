import {readFile} from 'node:fs/promises';
export function removeScriptLoader(source,method){
  const match=new RegExp('^[\\t ]+'+method+'\\(', 'm').exec(source);
  const start=match?.index ?? -1;
  const offset=start<0?-1:source.slice(start).search(/\n[\t ]*\/\*\*/);
  const end=offset<0?-1:start+offset;
  if(start<0||end<0)throw new Error(`Unsupported EPUB.js source layout for ${method}`);
  return source.slice(0,start)+`  ${method}() { return Promise.resolve(false); }\n`+source.slice(end);
}
export const epubWithoutScripts={name:'epub-without-script-loading',setup(build){
  build.onLoad({filter:/epubjs\/(lib|src)\/(contents|rendition)\.js$/},async({path})=>{
    const original=await readFile(path,'utf8');
    return {contents:removeScriptLoader(original,path.endsWith('/contents.js')?'addScript':'injectScript'),loader:'js'};
  });
}};
