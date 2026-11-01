import { makeRng } from './rules.js';

/**
 * The scorebook: two made-up sides with made-up (plausible, international)
 * names, and every ball credited to a batter and a bowler. Batters are tied to
 * the three batting actors on the field, so the card agrees with who you saw.
 * Three bowlers share five overs, five share ten or twenty (at most two, or
 * four in a T20), never two overs in a row.
 *
 * opts.aiBats: the same two sides (same seed, same names) with the AI's side
 * batting and yours in the field, for the innings the AI plays.
 */
const FIRST = ['Arjun', 'Rohan', 'Kabir', 'Imran', 'Faisal', 'Danish', 'Kasun', 'Dilshan', 'Tamim', 'Mehedi', 'Rashid', 'Naveen', 'Oliver', 'Harry', 'Jack', 'Liam', 'Ethan', 'Mitchell', 'Cameron', 'Tom', 'Kane', 'Devon', 'Quinton', 'Aiden', 'Lungi', 'Kagiso', 'Shai', 'Jason', 'Andre', 'Nicholas', 'Paul', 'Andrew', 'Sikandar', 'Ryan', 'Josh', 'Sam', 'Ben', 'Callum', 'Theo', 'Dev', 'Nikhil', 'Sanjay', 'Hasan', 'Usman', 'Charith', 'Litton', 'Ibrahim', 'Gareth', 'Marcus', 'Keshav'];
const LAST = ['Raghavan', 'Menon', 'Kulkarni', 'Iyer', 'Siddiqui', 'Qureshi', 'Malik', 'Perera', 'Fernando', 'Wickrama', 'Rahman', 'Hossain', 'Zadran', 'Stanekzai', 'Whitfield', 'Ashworth', 'Pemberton', 'Harrow', 'Cartwright', 'Delaney', 'McAllister', 'Brennan', 'Okafor', 'Van der Berg', 'Botha', 'Naidoo', 'Mokoena', 'Joseph', 'Thomas', 'Bascombe', 'Greenidge', 'Walcott', 'Tennant', 'Lockhart', "O'Rourke", 'Doherty', 'Gallagher', 'Fairweather', 'Ellison', 'Kingsley', 'Pathirana', 'Chowdhury', 'Mahmood', 'Sharif', 'Rasool', 'Bhandari', 'Deshpande', 'Talwar', 'Ferreira', 'Holloway'];
const PLACE = ['Harbourside', 'Kingsbridge', 'Marlow', 'Eastwick', 'Riverton', 'Ashcombe', 'Northgate', 'Fernhill', 'Westerly', 'Copper Bay', 'Highfield', 'Larkspur'];
const MASCOT = ['Kestrels', 'Mariners', 'Rovers', 'Stags', 'Falcons', 'Otters', 'Comets', 'Lancers', 'Herons', 'Corsairs', 'Wolves', 'Pilots'];
const FIELD_IDS = ['slip1', 'slip2', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];
const BOWLING_ORDER = [0, 1, 0, 2, 1]; // overs 1-5: openers, first change, opener again

/** Who bowls each over: nobody twice running, a cap each. */
export function bowlingOrder(overs) {
  if (overs <= 5) return BOWLING_ORDER;
  const cap = overs <= 10 ? 2 : 4;
  const left = [cap, cap, cap, cap, cap];
  const order = [];
  for (let o = 0; o < overs; o++) {
    // Most overs left first (so the caps always work out), a nudge toward
    // whoever bowled from this end two overs ago, never the same bowler twice.
    const prev = order[o - 1];
    const spell = order[o - 2];
    const pick = left
      .map((n, i) => ({ i, score: n + (i === spell ? 0.6 : 0) - i * 0.01 }))
      .filter(({ i }) => left[i] > 0 && i !== prev)
      .sort((a, b) => b.score - a.score)[0].i;
    left[pick]--;
    order.push(pick);
  }
  return order;
}

export function createScorebook(seed, { aiBats = false, overs = 5 } = {}) {
  const rng = makeRng(seed * 7919 + 11);
  const used = new Set();
  const person = () => {
    for (;;) {
      const n = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
      const last = n.split(' ').slice(1).join(' ');
      if (!used.has(last)) {
        used.add(last);
        return n;
      }
    }
  };
  const team = () => {
    let name;
    do name = `${rng.pick(PLACE)} ${rng.pick(MASCOT)}`;
    while (used.has(name));
    used.add(name);
    return { name, xi: Array.from({ length: 11 }, person) };
  };
  // Your side is always drawn first, so the names hold whichever side bats.
  const yours = team();
  const theirs = team();
  const [bat, bowl] = aiBats ? [theirs, yours] : [yours, theirs];
  const keeper = bowl.xi[5];
  const order = bowlingOrder(overs);
  const bowlerNames = [bowl.xi[8], bowl.xi[9], bowl.xi[7], bowl.xi[10], bowl.xi[6]].slice(0, Math.max(...order) + 1);
  const short = (n) => n.split(' ').slice(1).join(' ');

  const book = {
    teams: { bat, bowl },
    aiBats,
    overs,
    keeper,
    batters: bat.xi.map((name) => ({ name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: '', batted: false })),
    bowlers: bowlerNames.map((name) => ({ name, balls: 0, runs: 0, wkts: 0, maidens: 0, overRuns: 0 })),
    actor: { batterA: 0, nonStriker: 1 },
    next: 2,
    fow: [],
    wides: 0,
    over: 0,
  };
  book.batters[0].batted = book.batters[1].batted = true;
  const bowlerNow = () => book.bowlers[order[Math.min(book.over, order.length - 1)]];

  /** Who a fielding position is this over: everyone but the keeper and the bowler. */
  function fielderName(id) {
    if (id === 'keeper') return keeper;
    const pool = bowl.xi.filter((n) => n !== keeper && n !== bowlerNow().name);
    return pool[FIELD_IDS.indexOf(id)] ?? pool[0];
  }

  /** One ball. e: { o, striker, incoming, overEnd } from the controller; m the match. */
  function ball(e, m) {
    const o = e.o;
    const b = book.batters[book.actor[e.striker] ?? 0];
    const bw = bowlerNow();
    if (o.legal) {
      b.balls++;
      bw.balls++;
    }
    b.runs += o.runs;
    if (o.runs === 4 && o.fielding?.type === 'boundary') b.fours++;
    if (o.runs === 6) b.sixes++;
    book.wides += o.extras;
    bw.runs += o.runs + o.extras;
    bw.overRuns += o.runs + o.extras;
    if (o.out) {
      bw.wkts++;
      b.out = true;
      const by = o.fielding?.by;
      b.how = o.out === 'bowled' ? `b ${short(bw.name)}` : o.out === 'lbw' ? `lbw b ${short(bw.name)}` : by === 'keeper' ? `c †${short(keeper)} b ${short(bw.name)}` : `c ${short(fielderName(by))} b ${short(bw.name)}`;
      book.fow.push({ score: m.runs, wkts: m.wkts, name: b.name, over: m.overText() });
      if (e.incoming && book.next < 11) {
        book.actor[e.incoming] = book.next;
        book.batters[book.next].batted = true;
        book.next++;
      }
    }
    if (e.overEnd) {
      if (bw.overRuns === 0) bw.maidens++;
      bw.overRuns = 0;
      book.over++;
    }
  }

  return Object.assign(book, { ball, bowlerNow, fielderName, short });
}
