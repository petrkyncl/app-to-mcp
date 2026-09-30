import express from 'express';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema, CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Phone, exec, compactUI} from './phone.mjs';
import {Planner, agentModel} from './planner.mjs';
import {assessAction,rebindTarget} from './policy.mjs';
import {suggestedTest,completionEvidence,beforeEffect,finalActionMatches,validateContract,repeatedAction} from './workflow.mjs';
import {AppCatalog} from './app-labels.mjs';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4318);
const token = process.env.MCP_TOKEN || randomBytes(24).toString('hex');
const phone = new Phone(process.env.ANDROID_SERIAL || 'RFGL729B8JP');
const planner = new Planner(root);
const appCatalog = new AppCatalog(phone,root);
const storage = path.join(root,'work','state.json');
let state = {maps:[], tools:[]};
try {state = JSON.parse(await readFile(storage,'utf8'));} catch(error) {if(error.code !== 'ENOENT') throw error;}
const jobs = new Map(); let activeJob = null; let latest = null;
let queue = Promise.resolve();
function locked(fn) {const result = queue.then(fn); queue = result.catch(()=>{}); return result;}
function hash(snapshot) {return createHash('sha256').update(JSON.stringify(snapshot.nodes.filter(n=>!['com.android.systemui','com.samsung.android.honeyboard','com.google.android.inputmethod.latin'].includes(n.package)))).digest('hex').slice(0,16);}
async function capture(includeScreenshot=true) {return locked(async () => {const snapshot = await phone.snapshot(); snapshot.id = hash(snapshot); const screenshot = includeScreenshot ? await phone.screenshot() : null; latest = snapshot; return {snapshot,screenshot};});}
async function persist() {await mkdir(path.dirname(storage),{recursive:true}); await writeFile(storage+'.tmp',JSON.stringify(state,null,2)); await rename(storage+'.tmp',storage);}
function event(job, type, message, details = {}) {job.events.push({type,message,time:new Date().toISOString(),...details});}
function createJob(mode, goal, packageName, allowSend = false, arguments_ = {}, toolName = null) {
  if (activeJob) throw new Error('Phone is busy. Stop or finish the current run first.');
  if (!goal?.trim() || goal.length > 4000) throw new Error('Enter a goal between 1 and 4000 characters.');
  const job = {id:randomUUID(), mode, goal, packageName, allowSend, arguments:arguments_, toolName, status:'running', events:[], cancelled:false, result:''};
  jobs.set(job.id,job); activeJob = job;
  job.promise = run(job).finally(()=>{if(activeJob === job) activeJob = null;}); return job;
}
async function run(job) {
  const capability=state.tools.find(t=>t.name===job.toolName);
  const screens = []; const history = []; const map = state.maps.find(m=>m.packageName === job.packageName);
  try {
    event(job,'start','Launching the app from its main activity with a fresh task');
    await locked(()=>phone.launch(job.packageName)); await new Promise(r=>setTimeout(r,1200));
    for(let step=0; step < (job.mode === 'map' ? 12 : 24); step++) {
      if(job.cancelled) throw new Error('Stopped by user');
      event(job,'observe','Reading screen '+(step+1));
      const {snapshot} = await capture(false);
      const screenshot=compactUI(snapshot).elements.length<3 ? await locked(()=>phone.screenshot()):null;
      const compact=compactUI(snapshot);event(job,'observe',`${compact.elements.length} meaningful UI elements · ${JSON.stringify(compact).length} characters · ${agentModel}`);
      if (snapshot.package && snapshot.package !== job.packageName && !snapshot.package.includes('permissioncontroller')) {
        throw new Error('The foreground app changed. Return to the requested app and try again.');
      }
      event(job,'thinking','Agent is choosing the next step');
      const decision = await planner.decide({mode:job.mode.toUpperCase(),goal:job.goal,snapshot,screenshot,history,map:map || screens,allowSend:job.allowSend,packageName:job.packageName});
      if(job.cancelled) throw new Error('Stopped by user');
      const screen = {name:decision.screenName, id:snapshot.id, packageName:snapshot.package, elements:snapshot.nodes.filter(n=>n.text || n.description || n.clickable || n.editable)};
      if(!screens.some(s=>s.id === screen.id)) screens.push(screen);
      event(job,'decision',decision.reasoning,{action:decision.kind,screenName:decision.screenName});
      if(job.mode==='map' && decision.kind==='ready') {history.push({action:'feedback',text:'Mapping requires a done result with a tool for the FULL requested capability, not draft-only. Inspect the final action if needed; do not execute it.'});continue;}
      if(decision.kind === 'done' || decision.kind === 'ready') {
        if(job.mode === 'map') {
          const mapped = {id:randomUUID(),packageName:job.packageName,goal:job.goal,screens:[...(map?.screens || []).filter(old=>!screens.some(s=>s.id===old.id)),...screens],workflow:history.length?history:(map?.workflow || []),createdAt:new Date().toISOString()};
          const generated = decision.tools.map(t=> {
            validateContract(t);
            if(!/^[a-z][a-z0-9_]{1,63}$/.test(t.name) || !t.goal || !t.description) throw new Error('Planner returned an invalid tool');
            if(!t.parameters.every(p=>/^[a-z][a-z0-9_]{0,40}$/.test(p.name))) throw new Error('Invalid tool parameter');
            return {...t,name:job.packageName.replaceAll('.','_')+'_'+t.name,packageName:job.packageName,mapId:mapped.id,validation:{status:'mapped'}};
          });
          if(!generated.length) throw new Error('No supported tools were discovered. Try a more specific goal.');
          state.maps = [...state.maps.filter(m=>m.packageName !== job.packageName),mapped];
          state.tools = [...state.tools.filter(t=>t.packageName !== job.packageName),...generated]; await persist();
          job.result = `${screens.length} screens mapped; ${generated.length} MCP tools created.`;
        } else {
          const evidence=completionEvidence(job,snapshot,capability,job.allowSend || capability?.effect==='none'?'completion':'preview');
          job.result=evidence.reason;
          if(!evidence.ok){job.status='blocked';event(job,'blocked',job.result);return;}
          job.validation=evidence.status;
          const tool=state.tools.find(t=>t.name===job.toolName);
          if(tool){tool.validation={status:evidence.status,at:new Date().toISOString(),result:job.result,arguments:job.arguments};await persist();}
        }
        job.status = 'completed'; event(job,'complete',job.result); return;
      }
      if(decision.kind === 'blocked') {job.status='blocked'; job.result=decision.result || decision.reasoning; event(job,'blocked',job.result); return;}
      const node = snapshot.nodes.find(n=>n.id === decision.targetId);
      const policy = assessAction(decision,node,job.mode,job.allowSend,{finalAction:finalActionMatches(capability,node),external:capability?.effect==='external'});
      if(!policy.allowed) {
        if(policy.stopBeforeSend && job.mode==='execute' && !job.allowSend) {
          const evidence=completionEvidence(job,snapshot,capability,job.allowSend || capability?.effect==='none'?'completion':'preview');
          if(evidence.ok){job.validation='prepared';job.status='completed';job.result=evidence.reason;
            const tool=state.tools.find(t=>t.name===job.toolName);if(tool){tool.validation={status:'prepared',at:new Date().toISOString(),result:job.result,arguments:job.arguments};await persist();}
            event(job,'complete',job.result);return;}
        }
        job.status='blocked'; job.result=policy.reason; event(job,'blocked',job.result); return;
      }
      const entry={snapshotId:snapshot.id,screenName:decision.screenName,action:decision.kind,target:node ? {label:node.label,text:node.text,description:node.description,resourceId:node.resourceId}:null,text:decision.text,reasoning:decision.reasoning};
      if(repeatedAction(history,entry))throw new Error('The same step repeated without progress. Check the phone or refine the capability, then retry.');
      const applied=await locked(async()=>{
        const current = await phone.snapshot();
        if(decision.kind==='tap' || decision.kind==='fill') {
          const rebound=rebindTarget(node,current.nodes);if(!rebound)return false;
          const verified=assessAction(decision,rebound,job.mode,job.allowSend,{finalAction:finalActionMatches(capability,rebound),external:capability?.effect==='external'});if(!verified.allowed)throw new Error(verified.reason);
          if(verified.external){
            const prepared=completionEvidence(job,current,capability,'preview');if(!prepared.ok)throw new Error(prepared.reason);
            if(job.effectAttempt)throw new Error('Submission was already attempted. Check the phone before trying again.');
            job.effectAttempt=beforeEffect(job,current,capability);
          }
          await phone.act({...decision,targetId:rebound.id},current);
        } else if(decision.kind==='type') {
          const oldFocus=snapshot.nodes.find(n=>n.editable && n.focused);const newFocus=current.nodes.find(n=>n.editable && n.focused);
          if(!oldFocus || !newFocus || oldFocus.resourceId!==newFocus.resourceId || oldFocus.package!==newFocus.package)return false;
          await phone.act(decision,current);
        } else {if(hash(current)!==snapshot.id)return false;await phone.act(decision,current);}
        return true;
      });
      if(!applied){event(job,'observe','UI changed; observing again before acting');continue;}
      history.push(entry);
    }
    job.status='blocked'; job.result='Step limit reached. Narrow the goal and retry.'; event(job,'blocked',job.result);
  } catch(error) {job.status=job.cancelled ? 'cancelled':'failed'; job.result=error.message; event(job,'error',error.message);}
}
function publicJob(job) {return job && {id:job.id,mode:job.mode,goal:job.goal,status:job.status,events:job.events,result:job.result,validation:job.validation};}
function toolSchema(tool) {
  const properties = Object.fromEntries(tool.parameters.map(p=>[p.name,{type:'string',description:p.description}]));
  if(tool.effect!=='none')properties.allow_external_action = {type:'boolean',default:false,description:'Set true only when the user authorizes the final action with these exact inputs. False prepares a preview.'};
  return {name:tool.name,description:tool.description,inputSchema:{type:'object',properties,required:tool.parameters.map(p=>p.name),additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}};
}
function instantiate(tool, args) {
  for(const param of tool.parameters) if(typeof args[param.name] !== 'string' || !args[param.name].trim()) throw new Error('Missing parameter: '+param.name);
  if(args.allow_external_action !== undefined && typeof args.allow_external_action !== 'boolean') throw new Error('allow_external_action must be boolean');
  return tool.goal.replace(/\{\{([a-z0-9_]+)\}\}/g,(_,name)=>{if(typeof args[name] !== 'string') throw new Error('Unknown goal parameter: '+name); return args[name];});
}
const app = express(); app.disable('x-powered-by');
app.use((req,res,next)=>{
  const permitted = [`127.0.0.1:${port}`,`localhost:${port}`];
  if(!permitted.includes(req.headers.host)) return res.status(403).json({error:'Invalid local host'});
  if(req.headers.origin && !permitted.some(host=>req.headers.origin === 'http://'+host)) return res.status(403).json({error:'Cross-origin access denied'});
  if(req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({error:'Cross-site access denied'});
  if(req.path.startsWith('/api/') && req.method !== 'GET' && req.headers['x-app-token'] !== token) return res.status(401).json({error:'Missing local session token'});
  if(req.path === '/mcp' && req.headers.authorization !== 'Bearer '+token) return res.status(401).json({error:'Missing MCP bearer token'});
  next();
});
app.use(express.json({limit:'1mb'}));
app.get('/api/session',async(req,res)=>{
  let auth; try {const result=await exec(process.env.CODEX_BIN || 'codex',['login','status'],{timeout:10000});auth=(result.stdout+'\n'+result.stderr).split('\n').find(line=>line.startsWith('Logged in')) || 'Codex sign-in available';} catch {auth='Codex is not authenticated. Run codex login.';}
  res.json({token,serial:phone.serial,auth,model:agentModel,mcpUrl:`http://127.0.0.1:${port}/mcp`,mcpConfig:{mcpServers:{android:{url:`http://127.0.0.1:${port}/mcp`,headers:{Authorization:'Bearer '+token}}}}});
});
app.get('/api/status',async(req,res)=>res.json({devices:await phone.devices(),activeJob:publicJob(activeJob),maps:state.maps.map(m=>({...m,screens:m.screens.map(s=>({name:s.name,id:s.id,elementCount:s.elements.length}))})),tools:state.tools.map(t=>({...toolSchema(t),test:suggestedTest(t)}))}));
app.get('/api/apps',async(req,res)=>res.json(await appCatalog.list()));
app.get('/api/screenshot',async(req,res)=>{const png=await locked(()=>phone.screenshot()); res.set('Cache-Control','no-store').type('png').send(png);});
app.get('/api/snapshot',async(req,res)=>{const {snapshot}=await capture();res.json(snapshot);});
app.get('/api/jobs/:id',(req,res)=>{const job=jobs.get(req.params.id); if(!job)return res.status(404).json({error:'Unknown run'});res.json(publicJob(job));});
app.post('/api/launch',async(req,res)=>{if(activeJob)throw new Error('Phone is busy');await locked(()=>phone.launch(req.body.packageName));res.json({ok:true});});
app.post('/api/map',(req,res)=>res.json(publicJob(createJob('map',req.body.goal,req.body.packageName))));
app.post('/api/execute',(req,res)=>{
  const tool=state.tools.find(t=>t.name === req.body.name);if(!tool)throw new Error('Unknown MCP tool');
  const args=req.body.arguments || {};res.json(publicJob(createJob('execute',instantiate(tool,args),tool.packageName,args.allow_external_action === true,args,tool.name)));
});
app.post('/api/jobs/:id/stop',(req,res)=>{const job=jobs.get(req.params.id);if(job?.status==='running'){job.cancelled=true;planner.cancel();}res.json({ok:true});});
app.post('/api/action',async(req,res)=>{
  if(activeJob)throw new Error('Phone is busy'); if(!latest || req.body.snapshotId !== latest.id)throw new Error('Refresh the UI before tapping.');
  await locked(async()=>{const current=await phone.snapshot();if(hash(current)!==latest.id)throw new Error('Screen changed. Refresh the UI.');await phone.act(req.body.action,latest);});res.json({ok:true});
});
app.post('/mcp',async(req,res)=>{
  const server=new Server({name:'app-to-mcp',version:'0.1.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'android_observe',description:'Read the current UI of the connected Android device.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},...state.tools.filter(t=>t.validation?.status==='verified').map(toolSchema)]}));
  server.setRequestHandler(CallToolRequestSchema,async request=>{
    try {
      if(request.params.name === 'android_observe'){const {snapshot,screenshot}=await capture();return {content:[{type:'text',text:JSON.stringify(snapshot)},{type:'image',data:screenshot.toString('base64'),mimeType:'image/png'}]};}
      const tool=state.tools.find(t=>t.name === request.params.name);if(!tool)throw new Error('Unknown tool');if(tool.validation?.status!=='verified')throw new Error('Test this workflow in the studio before using it through MCP.');
      const args=request.params.arguments || {};const job=createJob('execute',instantiate(tool,args),tool.packageName,args.allow_external_action === true,args,tool.name);await job.promise;
      return {content:[{type:'text',text:JSON.stringify(publicJob(job))}],isError:job.status !== 'completed'};
    } catch(error) {return {content:[{type:'text',text:error.message}],isError:true};}
  });
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{transport.close();server.close();});await server.connect(transport);await transport.handleRequest(req,res,req.body);
});
app.get('/mcp',(req,res)=>res.status(405).set('Allow','POST').end());
app.delete('/mcp',(req,res)=>res.status(405).set('Allow','POST').end());
app.use(express.static(path.join(root,'public')));
app.use((error,req,res,next)=>{console.error(error.message);if(!res.headersSent)res.status(400).json({error:error.message});});
app.listen(port,'127.0.0.1',()=>console.log(`App to MCP: http://127.0.0.1:${port}`));
