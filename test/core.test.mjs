import test from 'node:test';
import assert from 'node:assert/strict';
import {flattenUI, Phone} from '../src/phone.mjs';
import {assessAction} from '../src/policy.mjs';
test('nested UI hierarchy retains semantic selectors and valid centers',()=>{
 const nodes=flattenUI({hierarchy:{node:{bounds:'[0,0][500,1000]',node:[{text:'Search',bounds:'[10,20][110,60]',clickable:'true','resource-id':'com.whatsapp:id/search'},{bounds:'[0,0][0,0]'}]}}});
 assert.equal(nodes.length,2);assert.deepEqual(nodes[1].center,[60,40]);assert.equal(nodes[1].resourceId,'com.whatsapp:id/search');assert.equal(nodes[1].clickable,true);
});
test('mapping and preview cannot press Send, explicit execution can',()=>{
 const decision={kind:'tap',sensitive:true};const node={description:'Send',resourceId:'com.whatsapp:id/send'};
 assert.equal(assessAction(decision,node,'map',true).allowed,false);assert.equal(assessAction(decision,node,'execute',false).allowed,false);assert.equal(assessAction(decision,node,'execute',true).allowed,true);
});
test('send authorization never authorizes calls or deletion',()=>{
 assert.equal(assessAction({kind:'tap',sensitive:false},{description:'Delete message'},'execute',true).allowed,false);
 assert.equal(assessAction({kind:'tap',sensitive:true},{description:'Start voice call'},'execute',true).allowed,false);
});
test('text is quoted for the Android shell, without host command execution',async()=>{
 const phone=new Phone('test');let args;phone.run=async value=>{args=value;};
 await phone.act({kind:'type',text:"hello'; $(touch bad) & world"},{nodes:[]});
 assert.deepEqual(args,['shell',"input text 'hello'\\'';%s$(touch%sbad)%s&%sworld'"]);
});
test('stale targets and unsupported unicode are rejected before ADB',async()=>{
 const phone=new Phone('test');phone.run=async()=>{throw new Error('ADB should not run');};
 await assert.rejects(()=>phone.act({kind:'tap',targetId:'9'},{nodes:[]}),/no longer exists/);
 await assert.rejects(()=>phone.act({kind:'type',text:'Ahoj čau'},{nodes:[]}),/ASCII/);
 await assert.rejects(()=>phone.launch('com.whatsapp; reboot'),/Invalid/);
});
