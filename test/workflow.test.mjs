import test from 'node:test';
import assert from 'node:assert/strict';
import {completionEvidence,beforeEffect,repeatedAction,suggestedTest,validateContract,finalActionMatches} from '../src/workflow.mjs';
const check=(text,role,state='visible')=>({text,role,state,resourceId:'',match:'equals',description:text});
const tool={effect:'external',parameters:[{name:'recipient'},{name:'message'}],verification:{finalAction:{label:'Send',resourceId:'id/send'},preview:[check('{{recipient}}','output'),check('{{message}}','input')],completion:[check('{{recipient}}','output'),check('{{message}}','output','new'),check('{{message}}','input','absent')]}};
const job={arguments:{recipient:'David Čečko',message:'Test message'}};
const header={text:'David Čečko'};const composer={editable:true,text:'Test message'};
test('generic contract verifies the exact target and draft',()=>{
 assert.equal(completionEvidence(job,{nodes:[header,composer]},tool,'preview').status,'prepared');
 assert.equal(completionEvidence(job,{nodes:[{text:'Someone else'},composer]},tool,'preview').ok,false);
});
test('old outputs and taps without new results do not pass verification',()=>{
 const executing={...job,effectAttempt:beforeEffect(job,{nodes:[header,{text:'Test message'},composer]},tool)};
 assert.equal(completionEvidence(executing,{nodes:[header,{text:'Test message'}]},tool,'completion').ok,false);
 assert.equal(completionEvidence({...executing,effectAttempt:null},{nodes:[header,{text:'Test message'},{text:'Test message'}]},tool,'completion').ok,false);
 assert.equal(completionEvidence(executing,{nodes:[header,{text:'Test message'},{text:'Test message'}]},tool,'completion').status,'verified');
 assert.equal(completionEvidence(executing,{nodes:[header,{text:'Test message'},{text:'Test message'},composer]},tool,'completion').ok,false);
});
test('the same verifier handles post title and body without app-specific code',()=>{
 const posting={effect:'external',parameters:[{name:'title'},{name:'body'}],verification:{finalAction:{label:'Post',resourceId:''},preview:[check('{{title}}','input'),check('{{body}}','input')],completion:[check('{{title}}','output','new')]}};
 const draft={nodes:[{editable:true,text:'My title'},{editable:true,text:'My body'}]};const run={arguments:{title:'My title',body:'My body'}};
 validateContract(posting);assert(completionEvidence(run,draft,posting,'preview').ok);
 run.effectAttempt=beforeEffect(run,draft,posting);assert.equal(completionEvidence(run,{nodes:[{text:'My title'}]},posting,'completion').status,'verified');
 assert(finalActionMatches(posting,{description:'Post'}));assert(!finalActionMatches(posting,{description:'Delete'}));
});
test('contracts require a new output and defined parameters',()=>{
 validateContract(tool);
 assert.throws(()=>validateContract({...tool,verification:{...tool.verification,completion:[check('Old','output')]}}),/new result/);
 assert.throws(()=>validateContract({...tool,verification:{...tool.verification,completion:[check('{{unknown}}','output','new')]}}),/Unknown/);
});
test('repeated decisions on unchanged UI are stopped; changed UI permits progress',()=>{
 const entry={snapshotId:'a',action:'tap',target:{label:'Search'},text:''};assert(repeatedAction([entry,entry],entry));assert(!repeatedAction([entry,entry],{...entry,snapshotId:'b'}));
});
test('test proposals never fabricate contacts or app-specific parameters',()=>{
 const suggestion=suggestedTest({parameters:[{name:'target'},{name:'body',example:'Test post'}]});assert.equal(suggestion.arguments.target,'');assert.equal(suggestion.arguments.body,'Test post');assert.equal(suggestion.status,'mapped');
});

test('mapping has no existing contract and can still navigate',()=>{assert.equal(finalActionMatches(undefined,{text:'Search'}),false);});

test('invalid older contracts cannot be offered as runnable tests',()=>{assert.equal(suggestedTest({effect:'none',parameters:[],verification:{finalAction:{label:'Send',resourceId:''},preview:[],completion:[check('Draft','input')]}}).checkable,false);});
