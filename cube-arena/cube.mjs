import Cube from './vendor/cube.cjs';

export const FACES = ['U','R','F','D','L','B'];
export const MOVES = FACES.flatMap(f => [f, f+"'", f+'2']);
export const SOLVED = FACES.map(f=>f.repeat(9)).join('');
export const DEFAULT_SEED = 20260918;
export const FACE_NAMES = {U:'up',R:'right',F:'front',D:'down',L:'left',B:'back'};
export const COLORS = {U:'#f4f5ee',R:'#fa5b49',F:'#37cba0',D:'#f6d45f',L:'#ff9d43',B:'#5688ff'};
export function applyMove(state, move) {
  if (!MOVES.includes(move)) throw new Error('Select one valid face move.');
  return Cube.fromString(state).move(move).asString();
}
export function applyMoves(state, moves) {return moves.reduce(applyMove,state);}
export function isSolved(state) {return state === SOLVED;}
export function matched(state) {return [...state].filter((c,i)=>c===SOLVED[i]).length;}
export function inverse(move) {return move.endsWith('2')?move:move.endsWith("'")?move[0]:move+"'";}
export function scramble(seed=DEFAULT_SEED,length=20) {
  let x=Number(seed)>>>0 || 1; const rand=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};
  const axis={U:0,D:0,R:1,L:1,F:2,B:2}; const moves=[];
  while(moves.length<length){const m=MOVES[Math.floor(rand()*18)];if(moves.length&&axis[m[0]]===axis[moves.at(-1)[0]])continue;moves.push(m);}
  return {seed:Number(seed),moves,state:applyMoves(SOLVED,moves)};
}
export function faceRows(state) {return Object.fromEntries(FACES.map((f,i)=>[f,[0,1,2].map(r=>state.slice(i*9+r*3,i*9+r*3+3))]));}
export function textState(state) {return Object.entries(faceRows(state)).map(([f,rows])=>`${f} (${FACE_NAMES[f]}): ${rows.join(' / ')}`).join('\n');}
// Standard URFDLB facelets, each face viewed from outside.
export function stickerGeometry(index) {
  const face=FACES[Math.floor(index/9)],r=Math.floor(index%9/3),c=index%3;
  const table={U:[[c-1,1,r-1],[0,1,0]],R:[[1,1-r,1-c],[1,0,0]],F:[[c-1,1-r,1],[0,0,1]],D:[[c-1,-1,1-r],[0,-1,0]],L:[[-1,1-r,c-1],[-1,0,0]],B:[[1-c,1-r,-1],[0,0,-1]]};
  return {face,position:table[face][0],normal:table[face][1]};
}
export function moveRotation(move) {
  const f=move[0],axis=({U:1,D:1,R:0,L:0,F:2,B:2})[f],layer=({U:1,D:-1,R:1,L:-1,F:1,B:-1})[f];
  return {axis,layer,angle:-layer*Math.PI/2*(move.endsWith('2')?2:move.endsWith("'")?-1:1)};
}
