import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {XMLParser} from 'fast-xml-parser';
export const exec = promisify(execFile);
const adb = process.env.ADB || '/Users/Petr/Tools/platform-tools/adb';
const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: ''});
export function flattenUI(parsed) {
  const nodes = [];
  function visit(value,parentId=null) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(child=>visit(child,parentId)); return; }
    if (value.bounds) {
      const b = String(value.bounds).match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (b && Number(b[3]) > Number(b[1]) && Number(b[4]) > Number(b[2])) {
      const id=String(nodes.length);
      nodes.push({id,parentId, text: String(value.text || ''), description: String(value['content-desc'] || ''), resourceId: String(value['resource-id'] || ''), class: String(value.class || ''), package: String(value.package || ''), clickable: value.clickable === 'true', focused: value.focused === 'true', editable: /EditText/.test(value.class || ''), bounds: b.slice(1).map(Number), center: [Math.round((+b[1] + +b[3])/2), Math.round((+b[2] + +b[4])/2)]});
      parentId=id;
      }
    }
    if (value.hierarchy) visit(value.hierarchy,parentId);
    if (value.node) visit(value.node,parentId);
  }
  visit(parsed);
  for(const node of nodes){
    node.label=node.text || node.description;
    if(!node.label && node.clickable){const descendants=nodes.filter(child=>{let parent=child.parentId;while(parent!==null){if(parent===node.id)return true;parent=nodes[Number(parent)]?.parentId??null;}return false;});node.label=descendants.find(n=>n.text)?.text || descendants.find(n=>n.description)?.description || '';}
  }
  return nodes;
}
export function compactUI(snapshot) {
  const nodes=snapshot.nodes;const byId=new Map(nodes.map(n=>[n.id,n]));
  const useful=nodes.filter(n=>{
    if(['com.android.systemui','com.samsung.android.honeyboard','com.google.android.inputmethod.latin'].includes(n.package))return false;
    if(n.clickable || n.editable)return Boolean(n.label || n.resourceId || n.editable);
    if(!n.text && !n.description)return false;
    let parent=byId.get(n.parentId);while(parent){if(parent.clickable)return false;parent=byId.get(parent.parentId);}
    return true;
  });
  return {app:snapshot.package,elements:useful.slice(0,65).map(n=>({id:n.id,role:n.editable?'input':n.clickable?'button':'text',label:(n.label || n.resourceId.split('/').at(-1) || 'Input').replace(/[\u200b-\u200f\ufeff]/g,'').slice(0,110),...(n.editable?{value:n.text.replace(/[\u200b-\u200f\ufeff]/g,''),actions:['fill','tap']} : n.clickable?{actions:['tap']} : {})})),truncated:useful.length>65};
}
export class Phone {
  constructor(serial) { this.serial = serial; }
  async run(args, options = {}) {
    try {const {stdout} = await exec(adb, ['-s', this.serial, ...args], {timeout: 25000, maxBuffer: 25 * 1024 * 1024, ...options}); return stdout;}
    catch(error) {const lines=String(error.stderr || error.stdout || error.message).split('\n').map(s=>s.trim()).filter(Boolean);const reason=lines.find(s=>/^(error:|adb:|java\.lang\.|Error:)/i.test(s)) || lines[0] || 'Command failed';throw new Error('ADB '+args[0]+': '+reason.slice(0,350));}
  }
  async devices() {
    const {stdout} = await exec(adb, ['devices', '-l'], {timeout: 10000});
    return stdout.split('\n').slice(1).filter(x => x.trim()).map(line => ({serial: line.split(/\s+/)[0], state: line.split(/\s+/)[1], model: line.match(/model:(\S+)/)?.[1] || 'Android'}));
  }
  async screenshot() { return this.run(['exec-out', 'screencap', '-p'], {encoding: 'buffer'}); }
  async snapshot() {
    await this.run(['shell', 'uiautomator', 'dump', '/data/local/tmp/app-to-mcp-ui.xml']);
    const xml = await this.run(['exec-out', 'cat', '/data/local/tmp/app-to-mcp-ui.xml']);
    const nodes = flattenUI(parser.parse(xml.slice(xml.indexOf('<?xml'))));
    return {nodes, package: nodes.find(n => n.package && !['com.android.systemui','com.google.android.inputmethod.latin','com.samsung.android.honeyboard'].includes(n.package))?.package || '', capturedAt: new Date().toISOString()};
  }
  async apps() {
    const result = await this.run(['shell', 'pm', 'list', 'packages', '-3']);
    const launchers=await this.run(['shell','cmd','package','query-activities','--components','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER']);
    const launchable=new Set(launchers.split('\n').filter(line=>line.includes('/')).map(line=>line.trim().split('/')[0]));
    return result.split('\n').filter(Boolean).map(p => p.replace('package:', '').trim()).filter(p=>launchable.has(p)).sort();
  }
  async launch(packageName) {
    if (!/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/.test(packageName)) throw new Error('Invalid Android package name');
    const resolved = await this.run(['shell','cmd','package','resolve-activity','--brief','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER',packageName]);
    const component=resolved.split('\n').map(s=>s.trim()).find(s=>s.startsWith(packageName+'/'));
    if(!component || !/^[a-zA-Z0-9_./$]+$/.test(component))throw new Error('This app has no launcher activity.');
    // A new task prevents Android from resuming a deeply nested activity stack.
    await this.run(['shell','am','start','-S','-n',component,'-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-f','0x10008000']);
  }
  async act(action, snapshot) {
    if (action.kind === 'tap') {
      const node = snapshot.nodes.find(n => n.id === action.targetId);
      if (!node) throw new Error('Element no longer exists. Capture the screen again.');
      await this.run(['shell', 'input', 'tap', ...node.center.map(String)]);
    } else if (action.kind === 'type' || action.kind === 'fill') {
      if (!/^[\x20-\x7E]{1,2000}$/.test(action.text)) throw new Error('This prototype currently types ASCII text only. Use scrcpy for accented text.');
      // Single-quote the Android shell argument; execFile alone only protects the host shell.
      if(action.text.includes('%s')) throw new Error('Literal %s cannot be typed by Android input text. Use scrcpy for this text.');
      const text = action.text.replaceAll(' ', '%s');
      if(action.kind==='fill') {
        const node=snapshot.nodes.find(n=>n.id===action.targetId && n.editable);if(!node)throw new Error('Select an editable input for fill.');
        await this.run(['shell','input','tap',...node.center.map(String)]);
        await this.run(['shell','input','keycombination','113','29']);
        await this.run(['shell','input','keyevent','67']);
      }
      await this.run(['shell', 'input text ' + "'" + text.replaceAll("'", "'\\''") + "'"]);
    } else if (action.kind === 'back') await this.run(['shell', 'input', 'keyevent', '4']);
    else if (action.kind === 'scroll') {
      const width = Math.max(...snapshot.nodes.map(n => n.bounds[2]), 500);
      const height = Math.max(...snapshot.nodes.map(n => n.bounds[3]), 1000);
      const [start, end] = action.direction === 'up' ? [.3, .75] : [.75, .3];
      await this.run(['shell', 'input', 'swipe', String(Math.round(width/2)), String(Math.round(height*start)), String(Math.round(width/2)), String(Math.round(height*end)), '450']);
    } else if (action.kind !== 'wait') throw new Error('Unsupported phone action');
    await new Promise(resolve => setTimeout(resolve, 700));
  }
}
