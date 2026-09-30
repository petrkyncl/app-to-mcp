import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppCatalog} from '../src/app-labels.mjs';
import {Phone} from '../src/phone.mjs';
test('an Android launcher alias is retained even when cached APK metadata omits launchability',async()=>{
 const root=path.resolve('work/catalog-tests',randomUUID());const dir=path.join(root,'work/app-labels/test');await mkdir(dir,{recursive:true});
 const apk='/data/app/test/base.apk';await writeFile(path.join(dir,'labels.json'),JSON.stringify({'com.reddit.frontpage':{apk,label:'Reddit',resolved:true,launchable:false}}));
 const phone={serial:'test',run:async()=> 'package:'+apk};const catalog=new AppCatalog(phone,root);catalog.apps=[{packageName:'com.reddit.frontpage',launchable:true}];
 const previous=process.env.AAPT2;process.env.AAPT2='/unused-cached-label';try{await catalog.loadLabels();}finally{if(previous===undefined)delete process.env.AAPT2;else process.env.AAPT2=previous;}
 assert.equal(catalog.apps[0].launchable,true);assert.equal(catalog.apps[0].label,'Reddit');
});
test('app inventory queries user apps and launcher activities in the current Android profile',async()=>{
 const phone=new Phone('test');const calls=[];phone.run=async args=>{calls.push(args);return args.includes('list')?'package:com.reddit.frontpage\n':'com.reddit.frontpage/launcher.default\n';};
 assert.deepEqual(await phone.apps(),['com.reddit.frontpage']);assert(calls.every(args=>args.includes('current')));assert(calls[0].includes('-3'));
});
