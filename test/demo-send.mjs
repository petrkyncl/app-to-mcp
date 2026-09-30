// One-time hackathon demo. Requires confirmation of this exact recipient and text.
// Never run as part of npm test.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {writeFile,mkdir,access} from 'node:fs/promises';
const dir='work/demo';await mkdir(dir,{recursive:true});
try{await access(dir+'/send-started.json');throw new Error('A test send was already attempted. Inspect the phone before any repeat.');}catch(error){if(error.code!=='ENOENT')throw error;}
const base='http://127.0.0.1:4318';const session=await(await fetch(base+'/api/session')).json();
const client=new Client({name:'hackathon-whatsapp-demo',version:'1.0.0'});
await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+session.token}}}));
const {tools}=await client.listTools();const tool=tools.find(t=>/send_message$/.test(t.name));if(!tool)throw new Error('Map send_message first.');
const args={recipient:'David Čečko',message:'Ahoj, toto je test naseho hackathon MCP agenta. Muzes ignorovat.',allow_external_action:true};
await writeFile(dir+'/send-started.json',JSON.stringify({tool:tool.name,args,at:new Date().toISOString()}),'utf8');
console.log('Calling generated MCP tool '+tool.name+' for the authorized test message.');
try{const result=await client.callTool({name:tool.name,arguments:args},undefined,{timeout:240000});await writeFile(dir+'/send-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}finally{await client.close();}
