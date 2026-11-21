import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {jiti,source} from './host.mjs';
const {loadEgregorePrefs,egregoreSnapshot}=await jiti.import(join(source,'settings-files.ts'));
const {saveFooter}=await jiti.import(join(source,'footer.ts'));
const {savedEgregoreVisuals}=await jiti.import(join(source,'../../packages/pi-ask/extensions/ask-user-question/appearance.ts'));
test('Egregore reads legacy Egregore settings, preserves bytes, detects stale writes and shares primary authority with Ask',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'egregore-migration-')), old=process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=dir;
 try{
  const legacy=join(dir,'pi-workspace.json'),primary=join(dir,'pi-egregore.json');
  const bytes=JSON.stringify({version:1,displayName:'Legacy user',density:'compact',ask:{version:1,title:'Legacy questions'}})+'\n';
  writeFileSync(legacy,bytes);
  assert.equal((await loadEgregorePrefs(dir)).displayName,'Legacy user');
  assert.equal(savedEgregoreVisuals().appearance.title,'Legacy questions');
  assert.equal(existsSync(primary),false);
  const snapshot=await egregoreSnapshot(dir);writeFileSync(legacy,bytes+'\n');
  await assert.rejects(saveFooter(primary,await loadEgregorePrefs(dir),snapshot),/changed/);
  await saveFooter(primary,await loadEgregorePrefs(dir),await egregoreSnapshot(dir));
  assert.equal(readFileSync(legacy,'utf8'),bytes+'\n');
  writeFileSync(primary,JSON.stringify({version:1,displayName:'New user',ask:{version:1,title:'New questions'}}));
  assert.equal((await loadEgregorePrefs(dir)).displayName,'New user');assert.equal(savedEgregoreVisuals().appearance.title,'New questions');
  writeFileSync(primary,'{"version":99}');await assert.rejects(loadEgregorePrefs(dir),/Unsupported/);
  assert.equal(savedEgregoreVisuals().appearance.title,'Questions');
 }finally{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old;await rm(dir,{recursive:true,force:true})}
});
