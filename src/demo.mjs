const norm=t=>String(t || '').normalize('NFD').replace(/\p{M}/gu,'').trim().toLowerCase();
const label=n=>n.label || n.text || n.description || '';
export const demoApps={'com.whatsapp':'WhatsApp','com.reddit.frontpage':'Reddit'};
const check=(description,text,role='any',state='visible',resourceId='')=>({description,text,role,state,resourceId,match:'equals'});
export function demoTool(packageName){
 if(packageName==='com.whatsapp')return {name:'com_whatsapp_send_message',displayName:'Send a WhatsApp message',packageName,demoProfile:'whatsapp',effect:'external',description:'Demo profile: find an exact contact and send a message. A preview prepares the draft without sending.',goal:'Send {{message}} to the exact WhatsApp contact {{recipient}}.',parameters:[{name:'recipient',description:'Exact contact name',example:'David Čečko'},{name:'message',description:'Message text (ASCII for this demo)',example:'Hi, this is a test of our hackathon MCP demo.'}],verification:{finalAction:{label:'Send',resourceId:''},preview:[check('Correct chat','{{recipient}}'),check('Exact message draft','{{message}}','input','visible','com.whatsapp:id/entry')],completion:[check('Correct chat','{{recipient}}'),check('New message bubble','{{message}}','output','new'),check('Composer no longer contains the draft','{{message}}','input','absent')]},validation:{status:'demo_ready'}};
 if(packageName==='com.reddit.frontpage')return {name:'com_reddit_frontpage_publish_text_post',displayName:'Publish a Reddit post',packageName,demoProfile:'reddit',effect:'external',description:'Demo profile: choose a community, fill title and body, then publish when authorized. A preview stops before publishing.',goal:'Publish {{title}} with body {{body}} to r/{{community}}.',parameters:[{name:'community',description:'Community name, without r/',example:'test'},{name:'title',description:'Post title (ASCII for this demo)',example:'MCP hackathon demo'},{name:'body',description:'Post text (ASCII for this demo)',example:'This draft was prepared by our Android MCP demo.'}],verification:{finalAction:{label:'Přidat příspěvek',resourceId:''},preview:[check('Correct community','r/{{community}}'),check('Exact title','{{title}}','input','visible','post_title_field'),check('Visible body','{{body}}')],completion:[check('New post title','{{title}}','output','new')]},validation:{status:'demo_ready'}};
 throw new Error('No fast demo profile for this app. Use AI exploration.');
}
class Navigation {
 constructor(io){this.io=io;this.s=null;this.screens=[];}
 async observe(name){this.s=await this.io.observe();if(this.s.package!==this.io.packageName)throw new Error('The phone switched apps. Return to '+demoApps[this.io.packageName]+'.');this.screens.push({name,id:this.s.id || String(this.screens.length),packageName:this.s.package,elements:this.s.nodes});return this.s;}
 find(predicate){return this.s.nodes.find(predicate);}
 async tap(predicate,name){let node=this.find(n=>n.clickable && predicate(n));if(!node){await this.observe(name);node=this.find(n=>n.clickable && predicate(n));}if(!node)throw new Error('Cannot find '+name+'. Check the phone, then retry.');this.io.event(name);await this.io.act({kind:'tap',targetId:node.id,settleMs:100},this.s);return this.observe(name);}
 async fill(predicate,text,name){const node=this.find(n=>n.editable && predicate(n));if(!node)throw new Error('Cannot find '+name+'.');this.io.event(name);await this.io.act({kind:'fill',targetId:node.id,text,settleMs:100},this.s);return this.observe(name);}
 async launch(){this.io.event('Opening '+demoApps[this.io.packageName]);await this.io.launch();await this.observe('App home');}
 async whatsapp(recipient){
  if(!this.find(n=>n.editable && /:id\/entry$/.test(n.resourceId))) {
   await this.tap(n=>/search|hledat|vyhled/i.test(label(n)+' '+n.resourceId),'Contact search');
   await this.fill(()=>true,recipient.normalize('NFD').replace(/\p{M}/gu,''),'Finding '+recipient);
   await this.tap(n=>norm(label(n))===norm(recipient),'Opening '+recipient);
  }
  if(!this.s.nodes.some(n=>norm(label(n))===norm(recipient)))throw new Error('The visible chat does not match '+recipient+'. Nothing sent.');
 }
 async reddit(community){
  if(!this.find(n=>n.resourceId==='post_title_field'))await this.tap(n=>/^(create|vytvorit|new post|create post)$/.test(norm(label(n))),'Create post');
  const target='r/'+community;
  if(!this.find(n=>norm(label(n))===norm(target))){
   await this.tap(n=>/community|komunit|^r\//i.test(label(n)),'Choosing a community');
   await this.fill(()=>true,community,'Finding '+target);
   await this.tap(n=>norm(label(n))===norm(target),'Selecting '+target);
  }
  if(!this.find(n=>n.resourceId==='post_title_field'))throw new Error('The post composer did not open. Nothing published.');
 }
}
export async function scanDemo(io){
 const nav=new Navigation(io);await nav.launch();
 if(io.packageName==='com.whatsapp')await nav.whatsapp('David Čečko');else await nav.reddit('test');
 io.event('Building MCP tools from the prepared demo profile');
 return {screens:nav.screens,tool:demoTool(io.packageName)};
}
export async function executeDemo(io,tool,args,allowEffect){
 const nav=new Navigation(io);await nav.launch();
 if(tool.demoProfile==='whatsapp'){
  await nav.whatsapp(args.recipient);await nav.fill(n=>/:id\/entry$/.test(n.resourceId),args.message,'Preparing the message');
 }else{
  const community=args.community.replace(/^r\//i,'').trim();if(!/^[a-z0-9_]{1,30}$/i.test(community))throw new Error('Enter a valid community name.');args.community=community;
  await nav.reddit(community);await nav.fill(n=>n.resourceId==='post_title_field',args.title,'Filling the title');
  await nav.tap(n=>/post body field|hlavni text|body/i.test(norm(label(n))),'Opening the body editor');
  const bodyEditor=nav.s.nodes.find(n=>n.editable && n.focused && n.resourceId!=='post_title_field');
  if(!bodyEditor && !nav.s.inputContext)throw new Error('The custom text editor is not focused. Nothing published.');
  io.event('Filling the body');await io.act(bodyEditor?{kind:'fill',targetId:bodyEditor.id,text:args.body,settleMs:100}:{kind:'fill_focused',text:args.body,settleMs:100},nav.s);await nav.observe('Prepared post');
 }
 const ready=await io.verify(nav.s,'preview');if(!ready.ok)throw new Error(ready.reason);
 if(!allowEffect)return {status:'prepared',result:ready.reason,screens:nav.screens};
 const submit=nav.find(n=>n.clickable && (tool.demoProfile==='whatsapp'?/^(send|odeslat)$/.test(norm(label(n))):/^(post|publish|pridat prispevek)$/.test(norm(label(n)))));
 if(!submit)throw new Error('The final action is unavailable. Nothing submitted.');
 io.event('Performing the authorized final action');await io.submit({kind:'tap',targetId:submit.id,sensitive:true,settleMs:200},nav.s,submit);
 for(let attempt=0;attempt<3;attempt++){await nav.observe('Checking the result');const evidence=await io.verify(nav.s,'completion');if(evidence.ok)return {status:'verified',result:evidence.reason,screens:nav.screens};}
 throw new Error('The final action was attempted but the result is not verified. Inspect the phone before retrying.');
}
