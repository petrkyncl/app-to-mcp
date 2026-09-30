export function suggestedTest(tool) {
  let checkable=true;try{validateContract(tool);}catch{checkable=false;}
  return {arguments:Object.fromEntries(tool.parameters.map(p=>[p.name,p.example || ''])),status:tool.validation?.status || 'mapped',validation:tool.validation || null,effect:tool.effect || 'external',checks:(tool.verification?.completion || []).map(c=>c.description),checkable};
}
const normalize=value=>String(value || '').normalize('NFD').replace(/\p{M}/gu,'').trim().toLowerCase().replace(/\s+/g,' ');
function template(value,args){return value.replace(/\{\{([a-z0-9_]+)\}\}/g,(_,name)=>String(args[name] || ''));}
export function matchingNodes(check,snapshot,args) {
  const expected=normalize(template(check.text,args));
  if(!expected && !check.resourceId)return [];
  return snapshot.nodes.filter(n=>{
    if(check.role==='input' && !n.editable)return false;
    if(check.role==='output' && n.editable)return false;
    if(check.resourceId && n.resourceId!==check.resourceId)return false;
    const actual=normalize(n.text || n.description || n.label);
    return !expected || (check.match==='contains'?actual.includes(expected):actual===expected);
  });
}
export function finalActionMatches(tool,node) {
  const selector=tool?.verification?.finalAction;
  if(!selector || (!selector.resourceId && !selector.label))return false;
  return (!selector.resourceId || node?.resourceId===selector.resourceId) && (!selector.label || normalize(node?.text || node?.description || node?.label)===normalize(selector.label));
}
export function completionEvidence(job,snapshot,tool,phase) {
  const checks=tool?.verification?.[phase];
  if(!checks?.length)return {ok:false,reason:'This workflow needs observable result checks. Map it again to create a testable capability.'};
  if(phase==='completion' && tool.effect==='external' && (!job.effectAttempt || !checks.some(c=>c.state==='new' && c.role==='output')))return {ok:false,reason:'A real action and a new visible result are required before this capability is verified.'};
  for(const check of checks){
    const count=matchingNodes(check,snapshot,job.arguments || {}).length;
    const before=job.effectAttempt?.counts?.[JSON.stringify(check)] || 0;
    if(check.state==='absent'?count!==0:check.state==='new'?count<=before:count===0)return {ok:false,reason:'Result not verified: '+check.description+'. Inspect the phone before retrying.'};
  }
  return {ok:true,status:phase==='preview'?'prepared':'verified',reason:phase==='preview'?'Test inputs and final action checked. Nothing submitted.':'The expected result is visible on the phone. Remote delivery or processing is not confirmed.'};
}
export function beforeEffect(job,snapshot,tool){return {counts:Object.fromEntries((tool.verification?.completion || []).map(c=>[JSON.stringify(c),matchingNodes(c,snapshot,job.arguments).length]))};}
export function validateContract(tool) {
  if(!['none','external'].includes(tool.effect))throw new Error('Invalid workflow effect');
  const verification=tool.verification;
  if(tool.effect==='none' && (verification?.finalAction?.label || verification?.finalAction?.resourceId))throw new Error('A read-only workflow cannot define a submission action');
  if(!verification?.completion?.length || (tool.effect==='external' && !verification.preview?.length))throw new Error('Workflow must define observable checks');
  if(tool.effect==='external' && (!verification.finalAction?.label && !verification.finalAction?.resourceId))throw new Error('Workflow must identify its final action');
  if(tool.effect==='external' && !verification.completion.some(c=>c.state==='new' && c.role==='output'))throw new Error('External workflows must verify a new result');
  for(const check of [...verification.preview,...verification.completion]){
    if(!check.text && !check.resourceId)throw new Error('Empty result check');
    for(const [,name] of check.text.matchAll(/\{\{([a-z0-9_]+)\}\}/g))if(!tool.parameters.some(p=>p.name===name))throw new Error('Unknown check parameter: '+name);
  }
}
export function repeatedAction(history,entry) {
  const key=e=>JSON.stringify([e.snapshotId,e.action,e.target?.resourceId,e.target?.label,e.text]);
  return history.slice(-2).length===2 && history.slice(-2).every(h=>key(h)===key(entry));
}
