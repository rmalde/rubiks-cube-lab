const Cube = require('./cube.cjs');
const MOVES = 'U U2 U\' R R2 R\' F F2 F\' D D2 D\' L L2 L\' B B2 B\''.split(' ');
const SOLVED = new Cube().asString();
function apply(state, moves) {
  if (typeof state !== 'string' || state.length !== 54 || !/^[URFDLB]+$/.test(state)) throw Error('Invalid state');
  if (!Array.isArray(moves) || moves.length > 60 || moves.some(m => !MOVES.includes(m))) throw Error('Invalid moves');
  const cube = Cube.fromString(state);
  for (const move of moves) cube.move(move);
  return cube.asString();
}
module.exports = {MOVES, SOLVED, apply};
if (require.main === module) {
  try {
    const request = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const state = apply(request.state, request.moves);
    console.log(JSON.stringify({state, solved: state === SOLVED}));
  } catch (error) { console.log(JSON.stringify({error: error.message, solved: false})); }
}
