import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {FACES,MOVES,COLORS,SOLVED,scramble,applyMove,isSolved,matched,faceRows,textState,stickerGeometry,moveRotation} from '../cube.mjs';

const $=id=>document.getElementById(id);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initial=scramble();let runs=[],selectedRunId=null,selectedModel='astra',mode='live',replayIndex=0,replayTimer=null;
let manual={state:initial.state,moves:[],startedAt:null,endedAt:null},busy=false,viewState=initial.state,viewIdentity='',lastTraceKey='',polling=false;
let renderedState=null;
const names={astra:'GPT-6 Astra',jev:'Jev 1.13',luna:'GPT-5.6 Luna',sol:'GPT-5.6 Sol'};
const symbols={astra:'✳',jev:'⋈',luna:'◒',sol:'☀'};
const statusNames={credit_limit:'Credit limit',queued:'Queued',running:'Thinking',solved:'Solved',move_limit:'Not solved',time_limit:'Time limit',cost_limit:'Cost limit',error:'Response error',stopped:'Stopped',interrupted:'Interrupted'};
const modelStatus=m=>m?.status==='error'&&m.history?.at(-1)?.error?.includes('OpenRouter 402')?'Credit limit':statusNames[m?.status];
const run=()=>runs.find(r=>r.id===selectedRunId)||runs[0];
const model=()=>run()?.models.find(m=>m.key===selectedModel);
const validHistory=()=>model()?.history.filter(h=>h.move)||[];
const incompleteTiming=(m,request=Infinity)=>m?.history.some(h=>h.timingEstimated&&h.request<=request);
const elapsedLabel=ms=>ms<60000?`${(ms/1000).toFixed(1)}s`:`${Math.floor(ms/60000)}m ${Math.floor(ms/1000)%60}s`;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function notify(message){$('notice').textContent=message;$('notice').hidden=false;}
async function api(url,body){const res=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');return data;}

// The visual uses the same facelet coordinates as the tested cube engine.
class CubeView {
  constructor(container){
    this.container=container;this.scene=new THREE.Scene();this.scene.background=null;
    this.camera=new THREE.PerspectiveCamera(34,1,.1,100);this.camera.position.set(6,5.1,7.4);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.NeutralToneMapping;this.renderer.toneMappingExposure=1;container.append(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.enablePan=false;this.controls.minDistance=6;this.controls.maxDistance=15;this.controls.target.set(0,.05,0);this.controls.maxPolarAngle=Math.PI*.94;
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x374658,3));
    const key=new THREE.DirectionalLight(0xfff5e6,4);key.position.set(4,8,6);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-5;key.shadow.camera.right=5;key.shadow.camera.top=5;key.shadow.camera.bottom=-5;key.shadow.normalBias=.04;this.scene.add(key);
    const rim=new THREE.DirectionalLight(0x7eafff,2.5);rim.position.set(-5,2,-3);this.scene.add(rim);
    this.group=new THREE.Group();this.scene.add(this.group);this.parts=[];
    const plastic=new THREE.MeshStandardMaterial({color:0x11181b,roughness:.35,metalness:.12});
    const bodyGeo=new RoundedBoxGeometry(.975,.975,.975,3,.065);
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){if(!x&&!y&&!z)continue;const mesh=new THREE.Mesh(bodyGeo,plastic);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.position=[x,y,z];this.group.add(mesh);this.parts.push(mesh);}
    const stickerGeo=new RoundedBoxGeometry(.823,.823,.028,3,.045);this.stickers=[];
    this.materials=Object.fromEntries(FACES.map(f=>[f,new THREE.MeshStandardMaterial({color:COLORS[f],roughness:.3,metalness:.02})]));
    for(let i=0;i<54;i++){const g=stickerGeometry(i);const tile=new THREE.Mesh(stickerGeo,this.materials[SOLVED[i]]);tile.position.fromArray(g.position).addScaledVector(new THREE.Vector3(...g.normal),.503);tile.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(...g.normal));tile.castShadow=true;tile.receiveShadow=true;tile.userData.position=g.position;this.group.add(tile);this.stickers.push(tile);this.parts.push(tile);}
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.25}));ground.rotation.x=-Math.PI/2;ground.position.y=-1.59;ground.receiveShadow=true;this.scene.add(ground);
    const ring=new THREE.Mesh(new THREE.RingGeometry(2.15,2.16,100),new THREE.MeshBasicMaterial({color:0x50646b,transparent:true,opacity:.2,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=-1.58;this.scene.add(ring);
    const resize=()=>{const w=container.clientWidth,h=container.clientHeight;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();};new ResizeObserver(resize).observe(container);resize();
    this.renderer.setAnimationLoop(()=>{this.controls.update();this.renderer.render(this.scene,this.camera);});
  }
  resetView(){this.camera.position.set(6,5.1,7.4);this.controls.target.set(0,.05,0);this.controls.update();}
  setState(state){this.stickers.forEach((s,i)=>{s.material=this.materials[state[i]];});renderedState=state;}
  async turn(move,next){
    if(this.turning){this.pendingState=next;return;}this.turning=true;
    const rotation=moveRotation(move),pivot=new THREE.Group();this.group.add(pivot);const selected=this.parts.filter(p=>p.userData.position[rotation.axis]===rotation.layer);const original=selected.map(p=>({p,position:p.position.clone(),quaternion:p.quaternion.clone()}));selected.forEach(p=>pivot.attach(p));
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,duration=reduced?0:310,start=performance.now();
    await new Promise(resolve=>{const frame=()=>{const t=duration?Math.min((performance.now()-start)/duration,1):1;const ease=t*t*(3-2*t);pivot.rotation[['x','y','z'][rotation.axis]]=rotation.angle*ease;if(t<1)requestAnimationFrame(frame);else resolve();};frame();});
    for(const o of original){this.group.add(o.p);o.p.position.copy(o.position);o.p.quaternion.copy(o.quaternion);}this.group.remove(pivot);this.setState(this.pendingState||next);this.pendingState=null;this.turning=false;
  }
}
let cube;
try{cube=new CubeView($('scene'));cube.setState(initial.state);}catch(e){$('scene').innerHTML='<p class="webgl-fallback">The 3D view requires WebGL.<br>The cube net and all controls remain available.</p>';cube={setState:s=>{renderedState=s;},turn:async(m,s)=>{renderedState=s;},resetView:()=>{}};}

function currentView(){
  if(mode==='manual')return {state:manual.state,turns:manual.moves.length,elapsedMs:manual.startedAt?(manual.endedAt||Date.now())-manual.startedAt:0,classification:manual.moves.length?{move:manual.moves.at(-1)}:null,move:manual.moves.at(-1),identity:'manual',status:isSolved(manual.state)?'solved':'manual'};
  const r=run(),m=model(),history=validHistory();
  if(mode==='replay'){const h=history[replayIndex-1];return {state:h?.after||r?.initialState||initial.state,turns:replayIndex,elapsedMs:h?.elapsedMs||0,classification:h?.classification,move:h?.move,identity:`${r?.id}-${m?.key}-replay`,status:isSolved(h?.after||r?.initialState||initial.state)?'solved':'replay'};}
  return {state:m?.state||r?.initialState||initial.state,turns:m?.turns||0,elapsedMs:m?.elapsedMs||0,classification:history.at(-1)?.classification,move:history.at(-1)?.move,identity:`${r?.id}-${m?.key}-live`,status:m?.status||'queued'};
}
function drawNet(state){$('cube-net').innerHTML=FACES.map((f,fi)=>`<div class="net-face" data-face="${f}" aria-label="${f} face">${[...state.slice(fi*9,fi*9+9)].map((c,i)=>`<span class="sticker" style="background:${COLORS[c]}" title="${f}${i+1}: ${c}">${i===4?f:''}</span>`).join('')}</div>`).join('');}
let prevTurns=0;
function renderView(animate=true){const v=currentView();viewState=v.state;
  if(renderedState!==v.state){if(animate&&viewIdentity===v.identity&&v.turns===prevTurns+1&&v.move){cube.turn(v.move,v.state);}else if(cube.turning)cube.pendingState=v.state;else cube.setState(v.state);}
  prevTurns=v.turns;viewIdentity=v.identity;
  $('view-name').textContent=mode==='manual'?'Your cube':names[selectedModel];$('turns').textContent=String(v.turns).padStart(2,'0');
  $('matched').innerHTML=`${matched(v.state)}<span>/54</span>`;
  const solved=isSolved(v.state);$('cube-status').textContent=solved?(run()?.config.solverAssisted&&mode!=='manual'?'Solved · assisted':'Solved'):mode==='replay'?'Replay':mode==='manual'?'Manual':v.status==='running'?'Live test':modelStatus(model())||statusNames[v.status]||'Shuffled';$('cube-status').classList.toggle('solved',solved);
  drawNet(v.state);$('state-text').textContent=Object.entries(faceRows(v.state)).map(([f,rows])=>`${f}  ${rows.join(' / ')}`).join('\n');
  $('plan-panel').hidden=!v.classification?.plan;$('working-plan').textContent=v.classification?.plan||'';
  $('classification').textContent=v.classification?JSON.stringify({move:v.classification.move}):'Waiting for a move';
  $('manual-controls').hidden=mode!=='manual';$('replay-controls').hidden=mode!=='replay';$('live').classList.toggle('active',mode==='live');$('replay').classList.toggle('active',mode==='replay');$('manual').classList.toggle('active',mode==='manual');
  $('replay-slider').max=validHistory().length;$('replay-slider').value=replayIndex;$('replay-position').textContent=`${replayIndex} / ${validHistory().length}`;
  renderTrace();renderTimer();
}
function renderTimer(){const v=currentView();let elapsed=v.elapsedMs;if(mode==='live'&&model()?.status==='running')elapsed=(model().activeElapsedBaseMs||0)+Date.now()-Date.parse(model().startedAt);const seconds=elapsed/1000;
  $('elapsed').innerHTML=seconds<60?`${seconds.toFixed(1)}<span>s</span>`:`${Math.floor(seconds/60)}<span>m</span> ${String(Math.floor(seconds)%60).padStart(2,'0')}<span>s</span>`;
  if(mode!=='manual'&&incompleteTiming(model(),mode==='replay'?(validHistory()[replayIndex-1]?.request||0):Infinity))$('elapsed').prepend('≥ ');
  const m=model();$('request-status').textContent=mode==='manual'?(isSolved(v.state)?'Cube solved. Timer stopped.':'Use the move buttons or enter notation.'):mode==='replay'?`Recorded time · ${replayIndex} of ${validHistory().length} moves`:m?.pendingSince?`Request ${m.requests} · ${((Date.now()-m.pendingSince)/1000).toFixed(1)}s`:`${m?.requests||0} ${m?.requests===1?'request':'requests'} · ${modelStatus(m)||(run()?'Not in this test':'Ready')}`;
}
let lastModelKey='';
function renderModels(){const r=run(),key=JSON.stringify([r?.id,selectedModel,mode==='manual',r?.models.map(m=>[m.status,m.turns])]);if(key===lastModelKey)return;lastModelKey=key;const focused=$('models').contains(document.activeElement)?document.activeElement.dataset.model:null;$('models').innerHTML=(r?.models.map(m=>m.key)||['sol']).map(k=>{const m=r?.models.find(m=>m.key===k);return `<button class="model-card ${k===selectedModel&&mode!=='manual'?'selected':''}" data-model="${k}" aria-pressed="${k===selectedModel&&mode!=='manual'}"><div class="model-top"><span class="model-symbol">${symbols[k]}</span><div><div class="model-title">${names[k]}</div><div class="model-subtitle">${k==='jev'?'Decision model':'Reasoning model'}</div></div></div><div class="model-bottom"><span>${modelStatus(m)||(r?'Not in this test':'Ready')}</span><strong>${String(m?.turns||0).padStart(2,'0')} <span style="color:var(--muted);font-size:10px">${m?.turns===1?'move':'moves'}</span></strong></div><div class="model-progress"><i style="width:${((m?.turns||0)/(r?.config.maxMoves||60))*100}%"></i></div></button>`;}).join('');
  $('models').querySelectorAll('button').forEach(b=>b.onclick=()=>selectModel(b.dataset.model));
  if(focused)$('models').querySelector(`[data-model="${focused}"]`)?.focus({preventScroll:true});
}
function sparkline(m){const points=[matched(run().initialState),...m.history.filter(h=>h.move).map(h=>h.matched)];return `<svg viewBox="0 0 65 18" aria-hidden="true"><polyline points="${points.map((n,i)=>`${i/Math.max(1,points.length-1)*65},${18-n/54*18}`).join(' ')}" fill="none" stroke="${m.status==='solved'?'#bafa6c':'#728b94'}" stroke-width="1.3"/></svg>`;}
function renderResults(){const r=run();$('results-body').innerHTML=(r?.models.map(m=>m.key)||['sol']).map(k=>{const m=r?.models.find(x=>x.key===k);return `<tr data-model="${k}" tabindex="0" aria-label="View ${names[k]}"><td>${names[k]}</td><td><span class="table-status ${m?.status||''}">${modelStatus(m)||(r?'Not in this test':'Ready')}</span></td><td>${m?.turns||'—'}</td><td>${m?.requests||'—'}</td><td>${m?(incompleteTiming(m)?'≥ ':'')+elapsedLabel(m.elapsedMs):'—'}</td><td>${m?.history.length?(incompleteTiming(m)?'≥ ':'')+elapsedLabel(m.history.reduce((s,h)=>s+h.latencyMs,0)/m.history.length):'—'}</td><td>${m?(m.costKnown?'$'+m.costUSD.toFixed(m.costUSD<.01?5:3):'Incomplete'):'—'}</td><td><span class="spark">${m?m.matched:'—'} ${m?sparkline(m):''}</span></td></tr>`;}).join('');
  $('results-body').querySelectorAll('tr').forEach(tr=>{tr.onclick=()=>selectModel(tr.dataset.model);tr.onkeydown=e=>{if(e.key==='Enter')selectModel(tr.dataset.model);};});
  const completed=r&&r.status!=='running',solved=r?.models.filter(m=>m.solved)||[];
  $('result-note').textContent=completed?(solved.length?`${solved.map(m=>m.name).join(', ')} solved this shuffle. `:'No model solved this shuffle within this test. '):'The test is running. ';$('result-note').textContent+=r?.config.solverAssisted?'SOLVER-ASSISTED: the models follow a plan from a two-phase solver. This does not measure independent solving.':r?.scramble.length===1?'This is a separate one-move control, not the 20-move benchmark.':'One shared shuffle is an exploratory test, not a general model ranking.';
  if(r?.models.some(m=>incompleteTiming(m)))$('result-note').textContent+=' ≥ marks a lower bound: one or more interrupted requests have no recorded duration.';
}
function renderTrace(){const m=model(),moves=mode==='manual'?manual.moves:validHistory().map(h=>h.move);const key=`${run()?.id}-${mode}-${selectedModel}-${moves.join(' ')}-${replayIndex}-${m?.history.length}`;if(key===lastTraceKey)return;lastTraceKey=key;
  $('trace-model').textContent=mode==='manual'?'Your cube':names[selectedModel];$('trace-count').textContent=`${moves.length} face ${moves.length===1?'turn':'turns'}`;
  $('trace').innerHTML=moves.length?moves.map((move,i)=>`<button data-index="${i+1}" class="${mode==='replay'&&replayIndex===i+1?'selected':''}" title="Turn ${i+1}: ${escape(move)}" ${mode==='manual'?'disabled':''}>${escape(move)}</button>`).join(''):'<span class="trace-empty">Moves will appear here. Select a move to inspect its cube state.</span>';
  $('trace').querySelectorAll('button').forEach(b=>b.onclick=()=>{stopReplay();mode='replay';replayIndex=Number(b.dataset.index);renderView(false);renderModels();});
  $('error-log').innerHTML=mode==='manual'?'':(m?.history.filter(h=>h.error).map(h=>`<p>Request ${h.request}: ${escape(h.error)}</p>`).join('')||'');
}
function selectModel(key){stopReplay();selectedModel=key;if(mode==='manual')mode='live';replayIndex=Math.min(replayIndex,validHistory().length);renderModels();renderView(false);}
function render(){const r=run();if(r&&!r.models.some(m=>m.key===selectedModel))selectedModel=r.models[0].key;const active=runs.some(x=>x.status==='running');$('run').disabled=active;$('run').textContent=active?'Test running…':'▶ Run comparison';$('stop').hidden=!active;$('export').disabled=!r;
  $('test-description').textContent=(r?.config.solverAssisted?'SOLVER-ASSISTED CONTROL · ':'')+`${r?.scramble.length||20}-move shuffle. ${r?.config.maxRequests||500} requests per model.`;
  $('model-count').textContent=String(r?.models.length||1).padStart(2,'0');
  $('protocol-note').textContent=r?.config.protocol||'One move per request. The shuffle stays hidden.';
  $('seed').textContent=r?.seed||initial.seed;$('shuffle-length').textContent=`${r?.scramble.length||20} moves`;$('move-limit').textContent=`${r?.config.maxRequests||60} requests`;
  const options=runs.map(x=>`<option value="${x.id}">${x.scramble.length}-move shuffle · ${escape(x.label)} · ${x.status==='running'?'Live':new Date(x.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</option>`).join('');if($('run-select').innerHTML!==options)$('run-select').innerHTML=options;$('run-select').value=r?.id||'';$('run-select').hidden=!runs.length;
  renderModels();renderResults();renderView();
}
async function poll(){if(polling)return;polling=true;try{const data=await api('/api/state');runs=data.runs;if(!selectedRunId&&runs.length)selectedRunId=(runs.find(r=>r.scramble.length===20)||runs[0]).id;$('connection').textContent='Connected locally';$('connection').classList.remove('offline');render();}catch(e){$('connection').textContent='Server offline';$('connection').classList.add('offline');}finally{polling=false;}}
function stopReplay(){clearInterval(replayTimer);replayTimer=null;$('play').textContent='▶';$('play').setAttribute('aria-label','Play replay');}
$('run').onclick=async()=>{try{$('run').disabled=true;const r=await api('/api/benchmark',{seed:20260918,scrambleLength:20,maxMoves:Number($('request-limit').value),protocol:$('protocol').value,modelKeys:$('model-selection').value==='sol'?['sol']:['astra','jev','luna','sol']});selectedRunId=r.id;mode='live';stopReplay();$('notice').hidden=true;await poll();}catch(e){notify(e.message);$('run').disabled=false;}};
$('stop').onclick=async()=>{try{const active=runs.find(r=>r.status==='running');if(active)await api('/api/stop',{id:active.id});await poll();}catch(e){notify(e.message);}};
$('run-select').onchange=e=>{selectedRunId=e.target.value;stopReplay();replayIndex=0;lastTraceKey='';render();};
$('live').onclick=()=>{stopReplay();mode='live';render();};
$('replay').onclick=()=>{stopReplay();mode='replay';replayIndex=0;render();};
$('play').onclick=()=>{if(replayTimer){stopReplay();return;}if(replayIndex>=validHistory().length)replayIndex=0;$('play').textContent='Ⅱ';$('play').setAttribute('aria-label','Pause replay');replayTimer=setInterval(()=>{if(replayIndex>=validHistory().length){stopReplay();return;}replayIndex++;renderView();},650);};
$('replay-slider').oninput=e=>{stopReplay();replayIndex=Number(e.target.value);renderView(false);};
$('camera-reset').onclick=()=>cube.resetView();
$('manual').onclick=()=>{stopReplay();if(manual.runId!==run()?.id)manual={runId:run()?.id,state:run()?.initialState||initial.state,moves:[],startedAt:null,endedAt:null};mode='manual';renderModels();renderView(false);};
$('reset-manual').onclick=()=>{if(busy)return;manual={runId:run()?.id,state:run()?.initialState||initial.state,moves:[],startedAt:null,endedAt:null};renderView(false);};
async function manualMoves(moves){if(busy)return;if(moves.length>120){notify('Use 120 moves or fewer.');return;}if(moves.some(m=>!MOVES.includes(m))){notify('Use face moves such as R, U′, and F2. Separate moves with spaces.');return;}busy=true;mode='manual';$('notice').hidden=true;
  for(const move of moves){if(!manual.startedAt)manual.startedAt=Date.now();if(manual.endedAt){manual.startedAt=Date.now();manual.endedAt=null;manual.moves=[];}manual.state=applyMove(manual.state,move);manual.moves.push(move);if(isSolved(manual.state))manual.endedAt=Date.now();renderView();await wait(matchMedia('(prefers-reduced-motion: reduce)').matches?0:350);}
  busy=false;renderModels();
}
// Face columns with clockwise / inverse / half-turn rows.
$('move-buttons').innerHTML=['',"'",'2'].flatMap(suffix=>FACES.map(f=>`<button data-move="${f+suffix}" aria-label="Apply ${f+suffix}">${f+suffix}</button>`)).join('');
$('move-buttons').querySelectorAll('button').forEach(b=>b.onclick=()=>manualMoves([b.dataset.move]));
$('algorithm-form').onsubmit=e=>{e.preventDefault();const moves=$('algorithm').value.trim().replaceAll('′',"'").split(/\s+/).filter(Boolean);if(moves.length)manualMoves(moves);};
$('copy-state').onclick=async()=>{try{await navigator.clipboard.writeText(`URFDLB: ${viewState}\n${textState(viewState)}`);$('copy-state').textContent='Copied';setTimeout(()=>$('copy-state').textContent='Copy text',1600);}catch{notify('Clipboard access failed. Select the text in the model input panel to copy it.');}};
$('export').onclick=async()=>{if(!run())return;try{const fullRun=await api('/api/runs/'+run().id);const blob=new Blob([JSON.stringify(fullRun,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`cube-arena-${fullRun.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notify(e.message);}};
document.addEventListener('keydown',e=>{if(mode!=='manual'||e.ctrlKey||e.metaKey||e.altKey||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;const face=e.key.toUpperCase();if(FACES.includes(face)){e.preventDefault();manualMoves([face+(e.shiftKey?"'":'')]);}});
render();poll();setInterval(poll,1500);setInterval(renderTimer,100);
