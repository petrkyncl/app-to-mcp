import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {XMLParser} from 'fast-xml-parser';
export const exec = promisify(execFile);
const adb = process.env.ADB || '/Users/Petr/Tools/platform-tools/adb';
const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: ''});
export function flattenUI(parsed) {
  const nodes = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value.bounds) {
      const b = String(value.bounds).match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (b && Number(b[3]) > Number(b[1]) && Number(b[4]) > Number(b[2])) {
        nodes.push({id: String(nodes.length), text: String(value.text || ''), description: String(value['content-desc'] || ''), resourceId: String(value['resource-id'] || ''), class: String(value.class || ''), package: String(value.package || ''), clickable: value.clickable === 'true', editable: /EditText/.test(value.class || ''), bounds: b.slice(1).map(Number), center: [Math.round((+b[1] + +b[3])/2), Math.round((+b[2] + +b[4])/2)]});
      }
    }
    if (value.hierarchy) visit(value.hierarchy);
    if (value.node) visit(value.node);
  }
  visit(parsed); return nodes;
}
export class Phone {
  constructor(serial) { this.serial = serial; }
  async run(args, options = {}) {
    const {stdout} = await exec(adb, ['-s', this.serial, ...args], {timeout: 25000, maxBuffer: 25 * 1024 * 1024, ...options}); return stdout;
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
    return result.split('\n').filter(Boolean).map(p => p.replace('package:', '').trim()).sort();
  }
  async launch(packageName) {
    if (!/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/.test(packageName)) throw new Error('Invalid Android package name');
    await this.run(['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
  }
  async act(action, snapshot) {
    if (action.kind === 'tap') {
      const node = snapshot.nodes.find(n => n.id === action.targetId);
      if (!node) throw new Error('Element no longer exists. Capture the screen again.');
      await this.run(['shell', 'input', 'tap', ...node.center.map(String)]);
    } else if (action.kind === 'type') {
      if (!/^[\x20-\x7E]{1,2000}$/.test(action.text)) throw new Error('This prototype currently types ASCII text only. Use scrcpy for accented text.');
      // Single-quote the Android shell argument; execFile alone only protects the host shell.
      if(action.text.includes('%s')) throw new Error('Literal %s cannot be typed by Android input text. Use scrcpy for this text.');
      const text = action.text.replaceAll(' ', '%s');
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
