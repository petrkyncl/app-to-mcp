import test from 'node:test';
import assert from 'node:assert/strict';
import {addVisualText} from '../src/ocr.mjs';
test('visual fallback adds missing editor text but omits keyboard keys and duplicates',()=>{
 const nodes=[{text:'Title',editable:true,bounds:[0,0,100,50],package:'test.app'},{text:'',bounds:[0,100,200,200],package:'com.samsung.android.honeyboard'}];
 addVisualText(nodes,[{text:'Title',confidence:.9,bounds:[0,0,100,50]},{text:'Draft body',confidence:.9,bounds:[0,60,100,90]},{text:'Q',confidence:.9,bounds:[0,110,20,130]}],'test.app');
 assert.equal(nodes.length,3);assert.equal(nodes[2].text,'Draft body');assert.deepEqual(nodes[2].center,[50,75]);assert.equal(nodes[2].editable,false);
});
test('OCR text over an accessible input does not become a sent output',()=>{
 const nodes=[{text:'Long draft',editable:true,bounds:[0,0,100,100],package:'test.app'}];addVisualText(nodes,[{text:'Long',confidence:.9,bounds:[10,10,90,40]}],'test.app');assert.equal(nodes[1].editable,true);
});
