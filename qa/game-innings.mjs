import { simulateInnings, aiBatter, AI_SKILL } from '../src/game/aiInnings.js';
import { createMatch } from '../src/game/match.js';
import { makeRng } from '../src/game/rules.js';

/**
 * The toss game's balance (Node). For each level and length:
 *   AI sets      the AI's first-innings totals (mean, 10th-90th percentile),
 *                next to the chase targets the AI sets on its own (setTarget)
 *   you chase    a human-like batter (timing spread 28 ms) chasing those totals
 *   you set      the same batter batting first, then the AI chasing it
 *
 *   GAMES=150 FORMATS=5,10 node qa/game-innings.mjs
 */
const GAMES = +(process.env.GAMES || 120);
const FORMATS = (process.env.FORMATS || '5,10,20').split(',').map(Number);
const HUMAN = +(process.env.HUMAN || 0.028);

function humanInnings(difficulty, seed, format, target) {
  const m = createMatch({ difficulty, seed, format, target });
  const bat = aiBatter(HUMAN, makeRng(seed * 13 + 1));
  m.startOver();
  while (!m.result) {
    const ball = m.nextDelivery();
    const { overEnd } = m.record(m.resolve(ball, bat(m, ball)));
    if (overEnd && !m.result) m.startOver();
  }
  return m;
}
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
for (const format of FORMATS) {
  for (const difficulty of (process.env.LEVELS || 'easy,medium,hard').split(',')) {
    const sets = [], own = [];
    let chaseWins = 0, defendWins = 0, humanFirst = [];
    for (let g = 1; g <= GAMES; g++) {
      const ai = simulateInnings({ difficulty, seed: g, format }).m;
      sets.push(ai.runs);
      own.push(createMatch({ difficulty, seed: g, format }).target);
      if (humanInnings(difficulty, g + 5000, format, ai.runs + 1).result === 'won') chaseWins++;
      const me = humanInnings(difficulty, g + 9000, format, null);
      humanFirst.push(me.runs);
      if (simulateInnings({ difficulty, seed: g + 7000, format, target: me.runs + 1 }).m.result !== 'won') defendWins++;
    }
    const mean = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
    console.log(`${String(format).padStart(2)} ov ${difficulty.padEnd(6)} AI sets ${mean(sets)} (${pct(sets, 0.1)}-${pct(sets, 0.9)}) vs own targets ${mean(own)} | you chase: win ${((100 * chaseWins) / GAMES).toFixed(0)}% | you set ${mean(humanFirst)}: win ${((100 * defendWins) / GAMES).toFixed(0)}%`);
  }
}
