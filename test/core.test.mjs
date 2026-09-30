import test from 'node:test';
import assert from 'node:assert/strict';
import {flattenUI, Phone,compactUI,parseInputContext} from '../src/phone.mjs';
import {assessAction,rebindTarget} from '../src/policy.mjs';
test('nested UI hierarchy retains semantic selectors and valid centers',()=>{
 const nodes=flattenUI({hierarchy:{node:{bounds:'[0,0][500,1000]',node:[{text:'Search',bounds:'[10,20][110,60]',clickable:'true','resource-id':'com.whatsapp:id/search'},{bounds:'[0,0][0,0]'}]}}});
 assert.equal(nodes.length,2);assert.deepEqual(nodes[1].center,[60,40]);assert.equal(nodes[1].resourceId,'com.whatsapp:id/search');assert.equal(nodes[1].clickable,true);
});
test('mapping and preview cannot press Send, explicit execution can',()=>{
 const decision={kind:'tap',sensitive:true};const node={description:'Send',resourceId:'com.whatsapp:id/send'};
 assert.equal(assessAction(decision,node,'map',true).allowed,false);assert.equal(assessAction(decision,node,'execute',false).allowed,false);assert.equal(assessAction(decision,node,'execute',true,{finalAction:true}).allowed,true);
});
test('send authorization never authorizes calls or deletion',()=>{
 assert.equal(assessAction({kind:'tap',sensitive:false},{description:'Delete message'},'execute',true).allowed,false);
 assert.equal(assessAction({kind:'tap',sensitive:true},{description:'Start voice call'},'execute',true).allowed,false);
});
test('semantic rebinding ignores coordinates but refuses ambiguous or changed targets',()=>{
 const old={id:'1',package:'com.whatsapp',class:'Button',resourceId:'id/search',text:'',description:'Search',clickable:true,center:[10,20]};
 const moved={...old,id:'8',center:[30,40]};assert.equal(rebindTarget(old,[moved]).id,'8');
 assert.equal(rebindTarget(old,[moved,{...moved,id:'9'}]),null);assert.equal(rebindTarget(old,[{...moved,description:'Send'}]),null);
});
test('fresh launch uses Android-supported NEW_TASK and CLEAR_TASK intent flags',async()=>{
 const phone=new Phone('test');const calls=[];phone.run=async args=>{calls.push(args);return calls.length===1?'com.whatsapp/.Main\n':'';};await phone.launch('com.whatsapp');
 assert.deepEqual(calls[1].slice(-2),['-f','0x10008000']);assert(calls[1].includes('-S'));assert(!calls[1].includes('--activity-new-task'));
});
test('compact observation labels clickable rows and omits layout, system chrome and duplicate child text',()=>{
 const snapshot={package:'com.whatsapp',nodes:flattenUI({hierarchy:{node:{bounds:'[0,0][500,1000]',package:'com.whatsapp',node:[{bounds:'[0,0][500,60]',package:'com.android.systemui',text:'15:00'},{bounds:'[0,60][500,200]',package:'com.whatsapp',clickable:'true',class:'View',node:{bounds:'[0,70][400,120]',package:'com.whatsapp',text:'David Čečko'}}]}}})};
 const compact=compactUI(snapshot);assert.equal(compact.elements.length,1);assert.equal(compact.elements[0].label,'David Čečko');assert.deepEqual(compact.elements[0].actions,['tap']);assert(!JSON.stringify(compact).includes('bounds'));
});
test('fill focuses, selects all and replaces a field in one executor operation',async()=>{
 const phone=new Phone('test');const calls=[];phone.run=async args=>calls.push(args);await phone.act({kind:'fill',targetId:'1',text:'David'},{nodes:[{id:'1',editable:true,center:[20,30]}]});
 assert.deepEqual(calls[1],['shell','input','keycombination','113','29']);assert.deepEqual(calls[2],['shell','input','keyevent','67']);assert.deepEqual(calls[3],['shell',"input text 'David'"]);
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

test('create-post navigation is allowed while the final Post action needs a mapped contract',()=>{assert(assessAction({kind:'tap',sensitive:false},{text:'Create post'},'map',false).allowed);assert(!assessAction({kind:'tap',sensitive:true},{text:'Post'},'map',false).allowed);assert(assessAction({kind:'tap',sensitive:true},{text:'Post'},'execute',true,{finalAction:true}).allowed);});

test('fill can clear a draft without typing or submitting it',async()=>{const phone=new Phone('test');const calls=[];phone.run=async args=>calls.push(args);await phone.act({kind:'fill',targetId:'1',text:''},{nodes:[{id:'1',editable:true,center:[20,30]}]});assert.equal(calls.length,3);assert.deepEqual(calls[2],['shell','input','keyevent','67']);});

test('unlabelled clickable wrappers inherit an informative child resource ID',()=>{const nodes=flattenUI({hierarchy:{node:{bounds:'[0,0][500,1000]',package:'test.app',node:{bounds:'[0,100][500,200]',clickable:'true',package:'test.app',node:{bounds:'[0,100][500,200]','resource-id':'post_body_field',package:'test.app'}}}}});const ui=compactUI({package:'test.app',nodes});assert(ui.elements.some(n=>n.label==='post body field' && n.actions.includes('tap')));});

test('custom editor metadata provides a generic focused input without exposing its text',()=>{const value='curEditorInfo:\n inputType=0x24001 imeOptions=0x0\n hintText=Body label=null\n packageName=test.app fieldId=42 fieldName=null\n hintLocales=null';assert.deepEqual(parseInputContext(value),{packageName:'test.app',fieldId:'42',inputType:'0x24001',label:'Body'});assert.equal(parseInputContext(value.replace('0x24001','0x0')),null);});
test('focused-editor replacement checks app and field identity before typing',async()=>{const phone=new Phone('test');const context={packageName:'test.app',fieldId:'42'};const calls=[];phone.inputContext=async()=>context;phone.run=async a=>calls.push(a);await phone.act({kind:'fill_focused',text:'Draft only'},{package:'test.app',inputContext:context,nodes:[]});assert.equal(calls.length,3);await assert.rejects(()=>phone.act({kind:'fill_focused',text:'Draft only'},{package:'other.app',inputContext:context,nodes:[]}),/editor changed/);assert.equal(calls.length,3);});

test('fast replacement uses one shell call, preserves quoting and rejects stale targets',async()=>{const p=new Phone('test');const calls=[];p.run=async a=>calls.push(a);await p.act({kind:'fill',fast:true,targetId:'1',text:"demo'; $(touch bad)",settleMs:0},{nodes:[{id:'1',editable:true,focused:true,text:'Old draft',center:[1,2]}]});assert.equal(calls.length,1);assert(calls[0][1].startsWith('input keycombination 113 29 && input keyevent 67 && input text '));assert(calls[0][1].includes("'\\''"));await assert.rejects(()=>p.act({kind:'fill',fast:true,targetId:'missing',text:'Hi'},{nodes:[]}),/editable input/);assert.equal(calls.length,1);});
