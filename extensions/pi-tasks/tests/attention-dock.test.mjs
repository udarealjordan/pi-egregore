import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const local=p=>jiti.import(fileURLToPath(new URL(p,import.meta.url)));
import {jiti,theme,visibleWidth,plain} from '../../pi-egregore/tests/host.mjs';
const {attentionDockRows}=await local('../attention-dock.ts');
const {dockRows}=await local('../typography.ts');
const {emptyPlan,mutate}=await local('../state.ts');
const {taskPanelRows,taskPanelDefaults}=await local('../../pi-egregore/task-presentation.ts');
const {layoutDock}=await jiti.import('pi-agent-contracts/dock');
const {taskFrame}=await local('../../../lib/task-frame.ts');
function plan(titles, phases = []){
 const empty=emptyPlan();
 return mutate(empty,empty.revision,{op:'add',items:titles.map((title,i)=>({title,...(phases[i]?{phase:phases[i]}:{})}))},'agent');
}
const update=(p,id,changes)=>mutate(p,p.revision,{op:'update',id,changes},'agent');
const q={id:'q1',revision:1,question:'Authorize credential creation or keep it deferred?',urgency:'blocking',state:'awaiting',planId:'p1',taskIds:['t2'],boundary:'Credential work waits; source review can continue'};

test('the dock is a checklist in plan order: last finished task, the active one, then what follows',()=>{
 let p=plan(['Inspect files','Review the prompt','Pick a layout','Check status display','Write docs','Ship it','Celebrate','Tidy up']);
 p=update(p,'t1',{status:'done',note:'Listed'}); p=update(p,'t2',{status:'active'});
 p=update(p,'t3',{status:'blocked',reason:'Needs a running Pi'});
 const before=structuredClone(p);
 const {rows,more}=dockRows(p,true,5);
 assert.deepEqual(rows.map(r=>r.text),['✓ Inspect files','◉ Review the prompt','! Pick a layout · Needs a running Pi','○ Check status display','○ Write docs','○ Ship it']);
 assert.deepEqual(rows.map(r=>r.tone),['muted','accent','warning','text','text','text']);
 assert.equal(more,2,'unshown open tasks become a count'); assert.deepEqual(p,before,'rendering never edits the plan');
 assert.match(dockRows(p,false).rows[1].text,/◉ Review the prompt · paused/);
 p=update(p,'t2',{status:'done',note:'Reviewed'});
 assert.equal(dockRows(p,true).rows[0].text,'✓ Review the prompt','the finished lead walks down the list');
 const deps=update(plan(['Build','Test']),'t2',{dependsOn:['t1']});
 assert.deepEqual(dockRows(deps,true).rows.map(r=>r.text),['○ Build','○ Test · after Build']);
});

test('multi-phase plans get headers with each phase\'s progress',()=>{
 let p=plan(['Read code','Sketch','Build','Verify'],['Research','Research','Build','Build']);
 p=update(p,'t1',{status:'done',note:'Read'});
 assert.deepEqual(dockRows(p,true).rows.map(r=>r.text),['Research · 1/2','✓ Read code','○ Sketch','Build · 0/2','○ Build','○ Verify']);
});

test('questions waiting on you lead the dock; answers already sent are not shown',()=>{
 let p=plan(['Review sources','Create credentials']); p=update(p,'t1',{status:'active'});
 const result=attentionDockRows(p,true,[q],'p1');
 assert.equal(result.rows[0].text,'? Authorize credential creation or keep it deferred? · /questions q1');
 assert.equal(result.rows[0].tone,'warning'); assert.equal(result.hint,'');
 assert.equal(attentionDockRows(p,true,[{...q,urgency:'deferred'}],'p1').rows[0].tone,'muted');
 for(const state of ['submitted','delivered','applied']) assert.doesNotMatch(attentionDockRows(p,true,[{...q,state}],'p1').rows.map(r=>r.text).join('\n'),/\?/);
 const many=attentionDockRows(p,true,[1,2,3].map(n=>({...q,id:`q${n}`})),'p1');
 assert.equal(many.rows.filter(r=>r.text.startsWith('?')).length,2); assert.equal(many.more,1,'a third question becomes a count');
});

test('both dock hosts fit every width',()=>{
 let p=plan(['Review and publish the verified implementation '.repeat(3),'Run the empty backend','Reconcile onboarding gates']);
 p=update(p,'t1',{status:'active'});
 const result=attentionDockRows(p,true,[q],'p1');
 const dock={version:1,sessionId:'s',id:'pi-tasks',title:'Inspect installation',summary:'1 waiting on you · 0 of 3 done',...result};
 const frame={state:'working',active:false,progress:0,phase:0};
 for(const width of [16,24,40,80,120,180]) {
  const egregore=taskPanelRows(theme,width,dock,taskPanelDefaults(),frame,7);
  const fallback=taskFrame(theme,width,layoutDock(dock,width-2,7).map(r=>r.text),dock.title,dock.summary,dock.hint,'heavy');
  for(const rows of [egregore,fallback]) for(const line of rows) assert.ok(visibleWidth(line)<=width);
  if(width>=80) { const text=egregore.map(plain).join('\n'); assert.match(text,/\? Authorize/); assert.match(text,/◉ Review and publish/); assert.match(text,/○ Run the empty backend/); }
 }
});

test('a short dock keeps the question and the active task; headers and finished work go first',async ()=>{
 const {fitDock,prioritizeDock}=await jiti.import('pi-agent-contracts/dock');
 let p=plan(['Locate albums','Shortlist photos','Pick cover','Print','Mail'],['Gather','Gather','Gather','Ship','Ship']);
 p=update(p,'t1',{status:'done',note:'Found'}); p=update(p,'t2',{status:'active'});
 const {rows,more}=attentionDockRows(p,true,[{...q,urgency:'deferred'}],'p1');
 assert.deepEqual(rows.map(r=>r.kind),['question','header','task','task','task','header','task','task']);
 const picked=prioritizeDock(rows,3);
 assert.deepEqual(picked.rows.map(r=>r.text),['? Authorize credential creation or keep it deferred? · /questions q1','◉ Shortlist photos','○ Pick cover']);
 assert.equal(picked.hidden,3,'finished and unshown tasks count; headers do not');
 const fitted=fitDock({version:1,sessionId:'s',id:'pi-tasks',title:'Photos',rows,more},4);
 assert.equal(fitted.at(-1).text,'+ 3 more'); assert.ok(fitted.some(r=>r.text.startsWith('◉ Shortlist photos')));
 const egregore=taskPanelRows(theme,80,{version:1,sessionId:'s',id:'pi-tasks',title:'Photos',rows,more},taskPanelDefaults(),{state:'working',active:false,progress:0,phase:0},5).map(plain).join('\n');
 assert.match(egregore,/◉ Shortlist photos/,'the Egregore dock keeps the active task at its default height');
});
