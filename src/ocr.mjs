import {spawn} from 'node:child_process';
import {mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {exec} from './phone.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let building;
async function binary(){
 const source=path.join(root,'src/ocr.swift');const target=path.join(root,'work/ocr-bridge');
 if(!building)building=(async()=>{await mkdir(path.dirname(target),{recursive:true});let fresh=false;try{fresh=(await stat(target)).mtimeMs>=(await stat(source)).mtimeMs;}catch{}if(!fresh)await exec('/usr/bin/swiftc',['-O','-module-cache-path',path.join(root,'work/swift-cache'),source,'-o',target],{timeout:60000,maxBuffer:1000000});return target;})().catch(error=>{building=null;throw error;});
 return building;
}
export async function recognizeText(png){const program=await binary();return new Promise((resolve,reject)=>{const child=spawn(program,[],{stdio:['pipe','pipe','pipe']});let output='';let error='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>error+=d);const timer=setTimeout(()=>child.kill(),15000);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error('Local OCR failed: '+error.slice(0,300)));try{resolve(JSON.parse(output));}catch(e){reject(e);}});child.stdin.end(png);});}
export function addVisualText(nodes,lines,packageName){
 const clean=t=>String(t || '').trim().replace(/\s+/g,' ').toLowerCase();
 const chrome=new Set(['com.android.systemui','com.samsung.android.honeyboard','com.google.android.inputmethod.latin']);
 for(const line of lines){
  const b=line.bounds;
  const center=[Math.round((b[0]+b[2])/2),Math.round((b[1]+b[3])/2)];
  if(nodes.some(n=>chrome.has(n.package) && center[0]>=n.bounds[0] && center[0]<=n.bounds[2] && center[1]>=n.bounds[1] && center[1]<=n.bounds[3]))continue;
  if(line.confidence<.4 || nodes.some(n=>clean(n.text || n.description)===clean(line.text)))continue;
  const input=nodes.some(n=>n.editable && center[0]>=n.bounds[0] && center[0]<=n.bounds[2] && center[1]>=n.bounds[1] && center[1]<=n.bounds[3]);
  nodes.push({id:'visual-'+nodes.length,parentId:null,text:line.text,description:'',label:line.text,resourceId:'',class:'VisualText',package:packageName,clickable:false,editable:input,focused:false,bounds:b,center,source:'local-ocr'});
 }
 return nodes;
}
