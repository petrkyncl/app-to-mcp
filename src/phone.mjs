import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {recognizeText,addVisualText} from './ocr.mjs';
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
    if(!node.label && node.clickable){const descendants=nodes.filter(child=>{let parent=child.parentId;while(parent!==null){if(parent===node.id)return true;parent=nodes[Number(parent)]?.parentId??null;}return false;});node.label=descendants.find(n=>n.text)?.text || descendants.find(n=>n.description)?.description || descendants.find(n=>n.resourceId)?.resourceId.split('/').at(-1).replaceAll('_',' ') || '';}
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
  return {app:snapshot.package,...(snapshot.inputContext?{focusedEditor:{...snapshot.inputContext,actions:['fill_focused']}}:{}),elements:useful.slice(0,65).map(n=>({id:n.id,...(n.resourceId?{resourceId:n.resourceId}:{}),role:n.editable?'input':n.clickable?'button':'text',label:(n.label || n.resourceId.split('/').at(-1) || 'Input').replace(/[\u200b-\u200f\ufeff]/g,'').slice(0,110),...(n.editable?{value:n.text.replace(/[\u200b-\u200f\ufeff]/g,''),actions:['fill','tap']} : n.clickable?{actions:['tap']} : {})})),truncated:useful.length>65};
}
export function parseInputContext(value) {
  const section=value.match(/curEditorInfo:\s+inputType=(0x[0-9a-f]+)([\s\S]{0,1400}?)hintLocales=/i);
  if(!section || !Number(section[1]))return null;
  const packageName=section[2].match(/packageName=([a-zA-Z0-9_.]+)/)?.[1];const fieldId=section[2].match(/fieldId=(0x[0-9a-f]+|-?\d+)/i)?.[1];
  if(!packageName || !fieldId)return null;
  return {packageName,fieldId,inputType:section[1],label:section[2].match(/hintText=(.*?) label=/)?.[1] || 'Focused text editor'};
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
  async inputContext(){return parseInputContext(await this.run(['shell','dumpsys','input_method']));}
  async snapshot() {
    const xml = await this.run(['shell', 'uiautomator dump --compressed /data/local/tmp/app-to-mcp-ui.xml >/dev/null && cat /data/local/tmp/app-to-mcp-ui.xml']);
    const nodes = flattenUI(parser.parse(xml.slice(xml.indexOf('<?xml'))));
    const packageName=nodes.find(n => n.package && !['com.android.systemui','com.google.android.inputmethod.latin','com.samsung.android.honeyboard'].includes(n.package))?.package || '';
    const inputContext=nodes.some(n=>n.editable && n.focused)?null:await this.inputContext();
    this.visualFallbackApps ||= new Set();
    if(inputContext?.packageName===packageName)this.visualFallbackApps.add(packageName);
    if(this.visualFallbackApps.has(packageName))addVisualText(nodes,await recognizeText(await this.screenshot()),packageName);
    return {inputContext:inputContext?.packageName===packageName?inputContext:null,nodes, package: nodes.find(n => n.package && !['com.android.systemui','com.google.android.inputmethod.latin','com.samsung.android.honeyboard'].includes(n.package))?.package || '', capturedAt: new Date().toISOString()};
  }
  async apps() {
    const result = await this.run(['shell', 'pm', 'list', 'packages', '--user', 'current', '-3']);
    const launchers=await this.run(['shell','cmd','package','query-activities','--user','current','--components','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER']);
    const launchable=new Set(launchers.split('\n').filter(line=>line.includes('/')).map(line=>line.trim().split('/')[0]));
    return result.split('\n').filter(Boolean).map(p => p.replace('package:', '').trim()).filter(p=>launchable.has(p)).sort();
  }
  async launch(packageName) {
    if (!/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/.test(packageName)) throw new Error('Invalid Android package name');
    this.launcherCache ||= new Map();
    const resolved = this.launcherCache.get(packageName) || await this.run(['shell','cmd','package','resolve-activity','--brief','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER',packageName]);
    const component=resolved.split('\n').map(s=>s.trim()).find(s=>s.startsWith(packageName+'/'));
    if(!component || !/^[a-zA-Z0-9_./$]+$/.test(component))throw new Error('This app has no launcher activity.');
    this.launcherCache.set(packageName,component);
    // A new task prevents Android from resuming a deeply nested activity stack.
    await this.run(['shell','am','start','-W','-S','-n',component,'-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-f','0x10008000']);
  }
  async act(action, snapshot) {
    if (action.kind === 'tap') {
      const node = snapshot.nodes.find(n => n.id === action.targetId);
      if (!node) throw new Error('Element no longer exists. Capture the screen again.');
      await this.run(['shell', 'input', 'tap', ...node.center.map(String)]);
    } else if (action.kind === 'type' || action.kind === 'fill' || action.kind === 'fill_focused') {
      if (typeof action.text!=='string' || !/^[\x20-\x7E]{0,2000}$/.test(action.text) || (action.kind==='type' && !action.text)) throw new Error('This prototype currently types ASCII text only. Use scrcpy for accented text.');
      // Single-quote the Android shell argument; execFile alone only protects the host shell.
      if(action.text.includes('%s')) throw new Error('Literal %s cannot be typed by Android input text. Use scrcpy for this text.');
      const text = action.text.replaceAll(' ', '%s');
      if(action.kind==='fill' && action.fast){
        const node=snapshot.nodes.find(n=>n.id===action.targetId && n.editable);if(!node)throw new Error('Select an editable input for fill.');
        const commands=[];if(!node.focused)commands.push('input tap '+node.center.join(' '),'sleep 0.3');
        if(node.text){commands.push('input keycombination 113 29','input keyevent 67');}
        if(text)commands.push("input text '"+text.replaceAll("'", "'\\''")+"'");
        if(commands.length)await this.run(['shell',commands.join(' && ')]);
        await new Promise(r=>setTimeout(r,action.settleMs ??100));return;
      }
      let eraseLength=0;let editorKey=null;
      if(action.kind==='fill_focused') {
        const current=await this.inputContext();const expected=snapshot.inputContext;
        if(!expected || !current || expected.packageName!==snapshot.package || current.packageName!==expected.packageName || current.fieldId!==expected.fieldId)throw new Error('The focused editor changed. Observe again before entering text.');
        editorKey=current.packageName+':'+current.fieldId;
        this.editorLengths ||= new Map();eraseLength=this.editorLengths.get(editorKey) ?? snapshot.nodes.filter(n=>n.source==='local-ocr').reduce((sum,n)=>sum+n.text.length,0);
        await this.run(['shell','input','keycombination','113','29']);await this.run(['shell','input','keyevent','67']);
      }
      if(action.kind==='fill') {
        const node=snapshot.nodes.find(n=>n.id===action.targetId && n.editable);if(!node)throw new Error('Select an editable input for fill.');
        eraseLength=node.text?.length || 0;
        await this.run(['shell','input','tap',...node.center.map(String)]);
        await this.run(['shell','input','keycombination','113','29']);
        await this.run(['shell','input','keyevent','67']);
      }
      if(eraseLength)await this.run(['shell','input','keyevent','123',...Array(Math.min(eraseLength,2000)).fill('67')]);
      if(text)await this.run(['shell', 'input text ' + "'" + text.replaceAll("'", "'\\''") + "'"]);
      if(editorKey)this.editorLengths.set(editorKey,action.text.length);
    } else if (action.kind === 'back') await this.run(['shell', 'input', 'keyevent', '4']);
    else if (action.kind === 'scroll') {
      const width = Math.max(...snapshot.nodes.map(n => n.bounds[2]), 500);
      const height = Math.max(...snapshot.nodes.map(n => n.bounds[3]), 1000);
      const [start, end] = action.direction === 'up' ? [.3, .75] : [.75, .3];
      await this.run(['shell', 'input', 'swipe', String(Math.round(width/2)), String(Math.round(height*start)), String(Math.round(width/2)), String(Math.round(height*end)), '450']);
    } else if (action.kind !== 'wait') throw new Error('Unsupported phone action');
    await new Promise(resolve => setTimeout(resolve, action.settleMs ?? 700));
  }
}
