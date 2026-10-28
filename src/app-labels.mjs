import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {exec} from './phone.mjs';
import {readdir,access} from 'node:fs/promises';

// Read just AndroidManifest.xml and resources.arsc instead of pulling every full APK.
async function range(phone,file,offset,length) {
  const size=65536,skip=Math.floor(offset/size),count=Math.ceil((offset%size+length)/size);
  const data=await phone.run(['exec-out',`dd if='${file}' bs=${size} skip=${skip} count=${count} 2>/dev/null`],{encoding:'buffer'});
  return data.subarray(offset%size,offset%size+length);
}
export async function metadataApk(phone,file) {
  if(!/^\/data\/app\/[a-zA-Z0-9_./=+~-]+\.apk$/.test(file))throw new Error('Unexpected APK path');
  const size=Number((await phone.run(['shell','stat','-c','%s',file])).trim());
  const length=Math.min(size,65557);const tail=await range(phone,file,size-length,length);
  let eocd=-1;
  for(let p=tail.length-22;p>=0;p--)if(tail.readUInt32LE(p)===0x06054b50 && p+22+tail.readUInt16LE(p+20)===tail.length){eocd=p;break;}
  if(eocd<0)throw new Error('APK ZIP directory was not found');
  const cdSize=tail.readUInt32LE(eocd+12),cdOffset=tail.readUInt32LE(eocd+16);
  if(cdSize>16*1024*1024)throw new Error('APK ZIP directory is too large');
  const directory=await range(phone,file,cdOffset,cdSize);const selected=[];
  for(let p=0;p<directory.length;) {
    if(directory.readUInt32LE(p)!==0x02014b50)break;
    const nameLength=directory.readUInt16LE(p+28),extraLength=directory.readUInt16LE(p+30),commentLength=directory.readUInt16LE(p+32);
    const entrySize=46+nameLength+extraLength+commentLength;
    const name=directory.toString('utf8',p+46,p+46+nameLength);
    if(['AndroidManifest.xml','resources.arsc'].includes(name))selected.push(Buffer.from(directory.subarray(p,p+entrySize)));
    p+=entrySize;
  }
  if(selected.length!==2)throw new Error('APK manifest or resources are missing');
  const local=[],central=[];let localSize=0;
  for(const cd of selected) {
    const offset=cd.readUInt32LE(42),compressedSize=cd.readUInt32LE(20);
    if(compressedSize>40*1024*1024)throw new Error('APK metadata is too large');
    const header=await range(phone,file,offset,30);const nameLength=header.readUInt16LE(26),extraLength=header.readUInt16LE(28);
    const record=Buffer.from(await range(phone,file,offset,30+nameLength+extraLength+compressedSize));
    record.writeUInt16LE(record.readUInt16LE(6)&~8,6);record.writeUInt32LE(cd.readUInt32LE(16),14);record.writeUInt32LE(compressedSize,18);record.writeUInt32LE(cd.readUInt32LE(24),22);
    cd.writeUInt16LE(cd.readUInt16LE(8)&~8,8);cd.writeUInt32LE(localSize,42);local.push(record);central.push(cd);localSize+=record.length;
  }
  const cd=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(selected.length,8);end.writeUInt16LE(selected.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(localSize,16);
  return Buffer.concat([...local,cd,end]);
}
async function findAapt() {
  if(process.env.AAPT2)return process.env.AAPT2;
  const base=path.join(os.homedir(),'Library','Android','sdk','build-tools');
  const versions=(await readdir(base)).filter(v=>/^\d+\.\d+\.\d+$/.test(v)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  for(const version of versions){const binary=path.join(base,version,'aapt2');try{await access(binary);return binary;}catch{}}
  throw new Error('Set AAPT2 to an Android SDK build-tools aapt2 binary.');
}
export class AppCatalog {
  constructor(phone,root){this.phone=phone;this.root=root;this.apps=[];this.loading=false;this.ready=false;this.error='';}
  async list() {
    if(!this.ready) {
      const packages=await this.phone.apps();
      this.apps=packages.map(packageName=>({packageName,label:packageName.split('.').at(-1),resolved:false,launchable:true}));this.ready=true;
      this.loadLabels().catch(error=>{this.error=error.message;this.loading=false;});
    }
    return {apps:this.apps.filter(a=>a.launchable!==false).sort((a,b)=>a.label.localeCompare(b.label)),loading:this.loading,error:this.error};
  }
  async loadLabels() {
    this.loading=true;const aapt=await findAapt();const dir=path.join(this.root,'work','app-labels',this.phone.serial || 'default');await mkdir(dir,{recursive:true});
    let cache={};try{cache=JSON.parse(await readFile(path.join(dir,'labels.json'),'utf8'));}catch{}
    // Prioritize the demo app; all other labels resolve in the background.
    const ordered=[...this.apps].sort((a,b)=>Number(b.packageName==='com.whatsapp')-Number(a.packageName==='com.whatsapp'));
    for(const app of ordered) {
      try {
        const paths=(await this.phone.run(['shell','pm','path','--user','current',app.packageName])).split('\n').filter(p=>p.startsWith('package:')).map(p=>p.slice(8).trim());const apk=paths.find(p=>p.endsWith('/base.apk')) || paths[0];
        if(cache[app.packageName]?.apk===apk){Object.assign(app,cache[app.packageName],{launchable:true});continue;}
        const file=path.join(dir,app.packageName+'.metadata.apk');await writeFile(file,await metadataApk(this.phone,apk));
        const {stdout}=await exec(aapt,['dump','badging',file],{timeout:15000,maxBuffer:2*1024*1024});
        // Android's queried launcher activities are authoritative; aapt can omit activity aliases.
        const launchable=true;const label=stdout.match(/^application-label:'(.*)'$/m)?.[1] || stdout.match(/^application-label-en:'(.*)'$/m)?.[1] || app.label;
        Object.assign(app,{label,resolved:true,launchable,apk});cache[app.packageName]={label,resolved:true,launchable,apk};
        await writeFile(path.join(dir,'labels.json'),JSON.stringify(cache));
      }catch(error){app.labelError=error.message;}
    }
    this.loading=false;
  }
}
