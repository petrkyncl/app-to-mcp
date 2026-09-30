import test from 'node:test';
import assert from 'node:assert/strict';
import {demoTool} from '../src/demo.mjs';
import {validateContract} from '../src/workflow.mjs';
test('demo profiles expose parameterized external workflows with preview and new-output verification',()=>{for(const app of ['com.whatsapp','com.reddit.frontpage']){const tool=demoTool(app);assert.equal(tool.validation.status,'demo_ready');validateContract(tool);assert(tool.verification.completion.some(c=>c.state==='new'));assert(tool.parameters.every(p=>tool.goal.includes('{{'+p.name+'}}')));}});
test('unsupported apps cannot silently get a fake supported demo profile',()=>assert.throws(()=>demoTool('com.example.other'),/No fast demo profile/));
