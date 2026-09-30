export function rebindTarget(oldNode, currentNodes) {
  if(!oldNode)return null;
  const matches=currentNodes.filter(n=>n.package===oldNode.package && n.class===oldNode.class && n.resourceId===oldNode.resourceId && n.text===oldNode.text && n.description===oldNode.description && n.clickable===oldNode.clickable);
  return matches.length===1 ? matches[0]:null;
}
export function assessAction(decision, node, mode, allowSend) {
  const label = [node?.text, node?.description, node?.resourceId].filter(Boolean).join(' ');
  const send = /(?:\bsend\b|\bodeslat\b|\bposlat\b|:id\/send(?:_|\b))/i.test(label);
  const forbidden = /(?:\bdelete\b|\bsmazat\b|\bremove\b|\bcall\b|\bvolat\b|\bbuy\b|\bkoupit\b|\bpay\b|\bzaplatit\b|\bpurchase\b)/i.test(label);
  if(decision.kind !== 'tap') return decision.sensitive ? {allowed:false, reason:'The planner flagged this action as sensitive.'} : {allowed:true};
  if(forbidden) return {allowed:false,reason:'Calls, deletion, purchases and account changes are outside this prototype.'};
  if(send) return mode === 'execute' && allowSend ? {allowed:true} : {allowed:false,reason:'Ready to send. Preview and mapping stop before sending.'};
  if(decision.sensitive) return {allowed:false,reason:'This external action has not been authorized.'};
  return {allowed:true};
}
