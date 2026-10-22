// Optional assistance only. The unaided protocols do not call this module.
// cube.js 1.3.2, MIT, two-phase solver. See vendor/cube.LICENSE.
import Cube from './vendor/cube.cjs';
import './vendor/solve.cjs';
import {applyMoves,isSolved,MOVES} from './cube.mjs';
let initialized=false;
export function solutionFor(state) {
  if(isSolved(state))return [];
  if(!initialized){Cube.initSolver();initialized=true;}
  const moves=Cube.fromString(state).solve().trim().split(/\s+/);
  if(moves.some(m=>!MOVES.includes(m))||!isSolved(applyMoves(state,moves)))throw new Error('Solver plan did not pass cube validation.');
  return moves;
}
