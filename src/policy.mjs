export function rebindTarget(oldNode, currentNodes) {
  if(!oldNode)return null;
  const matches=currentNodes.filter(n=>n.package===oldNode.package && n.class===oldNode.class && n.resourceId===oldNode.resourceId && n.text===oldNode.text && n.description===oldNode.description && n.label===oldNode.label && n.clickable===oldNode.clickable);
  if(matches.length===1)return matches[0];
  const stationary=matches.filter(n=>JSON.stringify(n.bounds)===JSON.stringify(oldNode.bounds));
  return stationary.length===1 ? stationary[0]:null;
}
export function assessAction(decision,node,mode,allowEffect,contract={}) {
  const label=[node?.text,node?.description,node?.label,node?.resourceId].filter(Boolean).join(' ');
  const forbidden=/(?:\bdelete\b|\bsmazat\b|\bremove\b|\bcall\b|\bvolat\b|\bbuy\b|\bkoupit\b|\bpay\b|\bzaplatit\b|\bpurchase\b)/i.test(label);
  if(decision.kind!=='tap')return decision.sensitive?{allowed:false,reason:'This action requires a defined final submission control.'}:{allowed:true};
  if(forbidden)return {allowed:false,reason:'Calls, deletion, purchases and account changes are outside this prototype.'};
  const actionLabel=[node?.text,node?.description,node?.label].find(Boolean)?.trim() || '';
  const submitting=contract.finalAction || decision.sensitive || /^(send|odeslat|poslat|post|publish|submit)$/i.test(actionLabel) || /:id\/(send|submit|publish)(?:_|\b)/i.test(node?.resourceId || '');
  if(submitting){
    if(mode!=='execute' || !allowEffect)return {allowed:false,stopBeforeSend:true,reason:'Draft ready. The final action needs authorization.'};
    if(!contract.finalAction)return {allowed:false,reason:'The final action does not match the mapped workflow. Map it again before submitting.'};
    return {allowed:true,external:true};
  }
  return {allowed:true};
}
