# The Short Ball

A pixel diorama of one over in a Test match, built with the Diorama playbook
(`~/skills/diorama` @ 077f604, v3.8.0). A fast bowler runs in three times on a
46 s loop:

1. A good-length outswinger: the batter pushes forward and is beaten outside off; the keeper takes it.
2. A bouncer: the batter goes back and across, is hit on the helmet, doubles up and kneels, then gets up and re-marks his guard.
3. A full outswinger: an outside edge, a full-length dive at second slip, the finger, the celebration. The batter walks off through the pavilion gate and the next one walks in.

A speed-gun scoreboard flips after each ball (`142 BEATEN`, `151 BOUNCER`,
`147 OUT c SLIP`).

## Open it

- `short-ball.html`: standalone, 757 kB, works over `file://`.
- `index.html` + `dist/app.js`: the served build (`python3 -m http.server 4180`).

Query parameters: `?rs=1` restores the chunky 1:1 pixel grid (the default is `rs=2`), `?t=16.12` freezes at a clock time, `?from=28` starts playback
there, `?grey=1` shows the grey blockout, `?dither=0` turns the dither off.

## Viewer controls

The page opens on the locked diorama view. A small bar at the bottom fades when
idle.

| Action | Mouse / touch | Keys |
| --- | --- | --- |
| rotate | drag (one finger) | — |
| zoom | scroll / pinch (5 m min, 1.6x the fitted distance max) | — |
| pan | right-drag / two fingers (orbit point stays on the slab) | — |
| reset to the diorama view | ⟲ View | R |
| pause / play | ❚❚ / ▶ | Space |
| speed 0.25x, 0.5x, 1x, 2x | buttons | [ and ] |
| seek | timeline slider (pauses) | — |

The camera can't go below the deck or straight overhead. Speed only changes how
fast the playhead moves: every frame is still a pure function of time, so
pausing, seeking and changing speed never drift. `?ui=0` hides the bar, and it
is hidden automatically under browser automation, so QA frames never contain it.

## Game mode: The Chase

`index.html?mode=game` (or **🏏 Play the chase** on the viewer bar) turns the
set into a 5-over chase. The AI sets a target and you bat. It bowls, sets the
field and learns where you score. You have 5 wickets.

The game uses the same renderer, palette and pixel pass as the diorama. It has
its own miniature oval (rope about 30 m straight, 20 m square and 14 m fine), a
full XI, a live scoreboard, a broadcast camera behind the bowler's arm and a
DOM HUD. The diorama loop is unchanged; `qa/frame-hash.mjs` proves its frames
are byte-identical.

| Keys | Shot | Best against |
| --- | --- | --- |
| ↓ | straight drive | full, on the stumps |
| ↓← | cover drive | full, outside off |
| ← | square cut: a horizontal slap through point | short, wide outside off |
| ↑← | late cut: a guide to third man, using the ball's pace | short-ish outside off, played late |
| ↑ | back-foot punch | short of a length, on the stumps |
| ↑→ | leg glance | full or good length, on the pads |
| → | **pull** to a short ball (pitching 6 m or more out): a horizontal slap, square · **flick** to a fuller one: front foot, wrists rolled to midwicket. The game picks from the ball's actual length. | short or bouncer / full or good at the pads |
| ↓→ | on drive | full, middle or leg |
| D alone | defence | anything (safe) |
| no key | leave | wide ones and bouncers (you duck) |
| **S** | sweep, on one knee | full or good length, at the pads |
| **S**+← | reverse sweep | full or good length, off stump |
| **S**+↑ | scoop over the keeper | full, straight |

The specials go down on the back knee. They pay well, but their timing windows
are narrower (×0.7, ×0.6 and ×0.55). Mistiming one costs more: it's likelier to
miss, and a missed sweep at the stumps is usually LBW.

Every shot also varies a little from its aim. Timing drags it (early toward
leg, late toward off), more so off a quicker ball; it scatters round the line,
more when mistimed. Pulls and cuts carry more power and stay square.

Hold the arrows and press **D** to play along the ground, or **A** to loft it.
The other keys:

| Key | Does |
| --- | --- |
| Enter | start, or play again |
| N | nets (calibration), from the intro |
| K | controller panel |
| T | tuning panel |
| P / Esc | pause |
| C | broadcast or 45° diorama camera |
| Space | fast-forward the dead time (4×) |
| G | timing meter (on by default on Easy) |
| H | controls legend |
| M | sound on/off (remembered) |
| 1 / 2 / 3 | difficulty, on the intro card |

Touch devices get an on-screen 3×3 pad and a LOFT toggle.

### Conditions

**O**, or *Conditions* on the intro card, sets the day. It is fixed once a
match starts (the nets take changes from the next ball) and remembered in this
browser. 🎲 rolls a random day; *New random conditions every match* rolls one
per match.

| | Choices | What it does |
| --- | --- | --- |
| Sky | sunny, patchy cloud, overcast, heavy and humid | swing ×0.7 to ×1.75; the light dims under cloud |
| Wind | calm, breeze (13 km/h), strong (25 km/h); into the batter, behind, to off, to leg | drifts the delivery; carries or holds up anything in the air after the bat (a strong wind moves a lofted drive's carry by about 3 m) |
| Pitch | flat road, good, green top, dry and dusty, cracked | seam movement, bounce, uneven bounce (the odd shooter, the odd one that rears), pace off the surface; the strip's colour |
| Outfield | slow, normal, fast | how far a ground shot rolls |

The bowler bowls to them: more swing under cloud, more cutters and bouncers on
a pitch that helps them. The corner of the screen shows the day, with the
wind's direction as an arrow on screen.

### Umpires and DRS

The umpires get close calls wrong: a slider in the Conditions panel (default
25%) sets how often. A plumb LBW is rarely missed; a near miss, a faint edge
or a feather off the bat before the pad is where the mistakes are. A wrong
not-out just lets you off (*NOT OUT · the umpire says no*).

Given out **LBW**, or **caught off a faint edge** (or off nothing at all),
play holds with the finger up and you have **10 seconds to review**: **V** or
Enter (controller: R2 or Confirm), or Esc / Space (Back) to walk. Three
reviews an innings; a review that comes back *umpire's call* is kept. Thick
edges and catches in the field can't be reviewed.

The third umpire then goes through it on the frozen field, with a low pulse
under it and a bleep for each finding:

- **Replay:** the delivery again from the broadcast end at half speed.
- **UltraEdge:** side-on at the bat in slow motion with the snickometer trace
  underneath. A bat touch is a sharp spike; the pad is a broad hump.
- **Ball tracking** (LBW), as the playing conditions define it:
  - The pitching zone is drawn on the strip: in line between the outer
    edges of the stumps (blue), outside leg (red).
  - The track is drawn in red from the hand to where it **pitched**.
    Outside leg is never out.
  - Then on to the **impact**. The centre of the ball in the zone is in line;
    part of the ball in it is umpire's call. Outside off with no shot played
    counts as in line.
  - Then the projection in blue on to the **wickets**: the stumps up to the
    top of the bails, with the umpire's-call margin one ball wide drawn round
    them.
- **Decision:** a riser, then OUT or NOT OUT and why: *overturned*,
  *umpire's call · review retained* or *original decision stands · review
  lost*. The crowd, on the batter's side, cheers or boos.

Space during a review skips to the decision. The DRS dots in the score bar
show the reviews left. The nets have unlimited reviews.

### Scorecard

After every over, every wicket and the end of the innings, play pauses, the
camera flies to the ground's scoreboard and the full card zooms out of it. It
shows:

- batting: how out, R, B, 4s, 6s, SR, with * on strike;
- extras, the total, yet to bat and the fall of wickets;
- the bowling figures (O, M, R, W, Econ).

**B** (or **R3** on a controller) shows it any time; Enter, Esc or B carries
on, and it closes by itself after about 9 s. It never appears in the nets.

The teams and players are made up (plausible international names, seeded per
match), and the intro card names both sides. Three bowlers share the five
overs, never two in a row. Batters are tied to the three batting figures on
the field, so the card agrees with who you saw. `node qa/game-scorecard.mjs`
checks the triggers and that the figures add up (batters + extras = total;
bowlers' runs, wickets and balls match the match).

### Replays

After a ball, press **R** (or **L2** on a controller) to replay it. The live
game freezes. Every player, the ball, the bails and the dust are functions of
game time, so the replay redraws the past exactly; scrubbing back to a moment
shows it identically.

| Control | Key | Controller |
| --- | --- | --- |
| Play / pause | Space | Confirm (A) |
| Step a frame, hold to scrub | ← / → | direction left / right |
| Speed (0.1×, 0.25×, 0.5×, 1×) | [ / ] | n/a |
| Auto slow motion (eases to 0.25× around contact and the take) | S | n/a |
| View: ball cam, side-on, broadcast, free | C | Camera (L1) |
| Free camera: rotate · zoom · pan | drag · scroll / pinch · right-drag (dragging switches to it) | right stick · D-pad up / down |
| Restart | Home | n/a |
| Back to the game | R / Esc | Back (B) or L2 |

The bar also has a timeline with marks for the release, the contact and the
take, plus buttons for every control. The **ball cam** is front-on like the
broadcast: from behind the bowler for the delivery, then running ahead of the
ball looking back at it, so the ball comes at you with the striker and the
field behind. The **free** camera is yours to rotate, zoom and pan. **Follow
ball** (on by default) carries it with the ball, keeping your angle. The other
views are computed from replay time, so the camera scrubs too. In slow motion
the ball has no motion trail, so it stays sharp frame by frame. A replay is available for about 25 s after the ball, including
during the next run-up.

`node qa/game-replay.mjs` checks the freeze, exact scrubbing, a fielder's
replayed position against his live one, the slow motion, the three views and
the exit.

### Game controller

Any controller the browser reports with the standard mapping works; it was built
for a Stadia controller in Bluetooth mode. Connect it and press any button:
browsers only report a pad after its first press. A toast confirms the
connection.

| Action | Default |
| --- | --- |
| Direction | D-pad **and** left stick (8 ways, as the arrows) |
| Shot along the ground / lofted / special | **A** / **Y** / **X** |
| Skip dead time · pause | **B** · **Menu ≡** |
| Camera · feedback (nets) | **L1** · **R1** |
| Tuning panel · Controller panel | **Options ⋯** · **Stadia button** |
| On cards: confirm / back | **A** / **B** (with a direction held, **A** marks that shot on the feedback card) |

The **Controller panel** (**K**, or the Stadia button) shows what's connected,
a live view of every button and the stick, and each action's binding with
**Rebind** (then press the button you want) and **Clear**. You can also choose
the direction source (D-pad, stick or both) and set the stick's dead zone. The
mapping is saved in this browser. Shot timing uses the pad's own report
timestamp, so it is as precise as the keyboard.

`node qa/game-pad.mjs` drives a simulated Stadia pad: the connect toast, start
on A, D-pad and stick directions, the dead zone, the specials, and the panel's
live view, rebind and persistence.

### The broadcast camera

One continuous camera, never a cut (`src/scene/gameCamera.js`):

| Moment | What the camera does |
| --- | --- |
| Between balls | Wide: high behind the bowler's arm, the whole strip, with the bowler at his mark at the bottom of the frame. |
| Run-up | Pushes in: the lens tightens and the aim slides up the pitch as he runs in, so the release finds it tight on the striker (off side left, straight down, matching the arrows). |
| Off the bat | Cranes up, pans after the ball and opens the lens, leading the ball toward where it ends up. A ball coming back toward the camera (a straight drive) lifts it higher, so it looks down on the ball crossing the rope. |
| Ball dead | Glides back to the wide shot. |

Every move is damped toward its framing, so the camera's path is continuous.
**C** still switches to the 45° diorama view of the whole oval.
`node qa/game-camera.mjs` frames a run-up and four shots. It reports whether the
ball is in frame and the largest frame-to-frame camera move (0.4 m and under 1°
in this build).

### Fielding

Each fielder works out the earliest point he can reach the ball at each level of
effort, then takes the easiest one that isn't much later
(`resolveFielding` in `src/game/fielding.js`):

| Effort | Ground ball | Catch | Share of stops (simulated) |
| --- | --- | --- | --- |
| Set (in line early, waiting) | Two-handed gather; the long barrier (one knee down) for a hard-hit one | Settled under it | about half |
| Run | One-handed pick-up on the move | Taken on the run, at whatever height | about a quarter |
| Stretch | n/a | A lunging catch, one step out | rare |
| Slide | A slide on the hip to cut it off | n/a | about 15% |
| Dive | Full length | Full length | about 5% |

Harder efforts take longer to gather and throw (0.4 s set up to 1.0 s after a
dive), and catches get harder (98% set, 95% run, 80% lunge, 60% diving).
Fielders move at a fielder's pace: the fielding model starts from where each
one actually is at contact, budgets the time a dive, slide or lunge takes, and
the keeper runs to the stumps (or takes the throw where he has got to).
`node qa/game-speeds.mjs` samples every fielder through bot matches and fails
above 8 m/s; in this build the top speed is 7.2 m/s.
`node qa/game-fielding.mjs` finds one of each and shoots it close up in
`qa/game/fielding/`.

### The read

During the run-up a **NEXT BALL** card shows the delivery type, the aimed length
and the line. A maroon ring with an amber spot marks the pitching zone on the
strip. Both show from about 2.6 s before release, and a bar counts down until
they disappear. They show the bowler's *aim*, not the ball: he still misses his
spot. Difficulty sets how much the read gives away (`DIFFICULTY[*].preview`):

| Level | Zone error | Hidden before release | Type disguised |
| --- | --- | --- | --- |
| Easy | ±0.35 m | 0.25 s | never |
| Medium | ±0.8 m | 0.55 s | 15% (a cutter shown as a swinger, a slower ball as an outswinger) |
| Hard | ±1.3 m | 0.85 s | 30% |

The read draws on its own hash, not the match RNG, so seeds play out exactly as
before.

### Sound

All sound is synthesised with WebAudio in `src/game/audio.js`, so there are
still no imported assets. It covers:

- **The run-up:** footfalls that quicken into the bound, then the bowler's
  grunt (bigger for bouncers and yorkers).
- **The ball:** the pitch thud, the bat crack (sharper the better you time it),
  the thin tick of an edge, pad thuds, the stumps clattering, and glove pops
  for takes and return throws.
- **The crowd:** a constant murmur, cheers for fours and sixes, a roar for
  wickets, an "ooh" when you're beaten or edge it, an appeal for LBWs and
  catches behind, applause for runs, new batters, overs and the result.
  The crowd is made of voices, not noise: dozens of synthesised people
  chattering in syllables between balls and shouting open vowels when
  something happens, panned across the stands, with claps and whistles, all
  in a long stadium reverb. `node qa/crowd-preview.mjs` records it from the
  game into `qa/game/crowd-preview.wav` (plus a spectrogram).

Each sound is fired from the same game-time events as the visuals, so it stays
in sync when you pause or fast-forward. Fast-forward drops the small sounds.
Audio starts on your first key or tap, as browsers require.

### Calibration and tuning

The game's feel comes from numbers: timing windows, shot-fit tables, edge and
miss odds, fielding, pace and the read. You can tune all of them to your hands.

**Nets.** Press **N** on the intro card (or open `?mode=game&nets=1`). There is
no target and no result, and a dismissal doesn't end anything.
- **The picker** (left) chooses what is bowled next: type, length and line,
  each Auto or fixed, plus the field and the level.
- **Press F** to pause and give feedback on the last ball. Press it during a
  delivery and the card opens once that ball is decided. Nothing pops up
  unless you ask. The card asks:

  | Question | Keys |
  | --- | --- |
  | Timing felt | **1** Early · **2** Right · **3** Late |
  | Outcome, next time | **7** Be kinder · **8** Fair · **9** Be harsher |
  | Power, next time (clean hits) | **4** More power · **5** Keep · **6** Less power. The card shows the speed off the bat. |
  | Trajectory, next time (clean hits) | **Q** Higher · **W** Keep · **E** Flatter. The card shows the launch angle. |
  | Spread, next time (clean hits) | **Z** Narrower · **X** Keep · **C** Wider. On the map, a dark wedge shows the random scatter for this ball and a light one adds how far timing inside the good window can drag it. |
  | Should have gone | For a clean hit, a small field map (as on screen: batter at the top, off side on the left) shows where it went (red) and the shot's aim (dashed). Click where it should have gone. Shown for edges too, with that edge kind's range. |
  | Right shots | Click a shot (or arrows + **D**, or **S** for the specials): once = **ideal**, twice = **OK**, three times = clear. Several can be ideal or OK. The shot you played is outlined. |

  **Enter** submits and **Esc** skips. Every question is optional. The card
  then lists exactly what changed and why.

**What each answer nudges** (`src/game/tuner.js`; small, bounded steps):

| Answer | Nudges |
| --- | --- |
| Timing felt | Your **timing offset** (your latency) moves a quarter of the way toward where "right" is for you. Saying "right" when the game said early or late widens the window 3%; "off" when it said perfect narrows it. |
| Be kinder / be harsher | Whatever produced the outcome: the miss coefficient if you were beaten, the edge coefficients if you edged, catching skill (and lofted carry) if you were caught, and ground-shot speed and fielder speed if you middled it for nothing. Harsh on a "wrong shot" raises that shot's fit for that length and widens its line toward the ball. |
| Power | That shot's **power** ×1.05 (more) or ×0.95 (less). |
| Trajectory | That shot's **launch angle** +2° (higher) or −2° (flatter); ±3° for lofted shots and the scoop. |
| Edges | When the ball came off an edge, the card shows the same map and questions, and they tune **that kind of edge** (outside, inside, top or leading), not the shot: its direction moves toward your click (a top edge's distance from straight, since it flies either side), its range ×0.9 / ×1.1, its speed ×1.05 / ×0.95, its launch angle ±3°. All 24 edge values are in the tuning panel's **Edges** tab. |
| Spread | The random **scatter** ×0.9 (narrower) or ×1.1 (wider) for all shots, and this shot's timing **drag** ×0.95 / ×1.05. |
| Should have gone | The shot's **aim** moves a quarter of the way toward where you clicked, net of the timing drag, capped at 8° per ball. If you also said the timing felt right and the drag pulled it the wrong way, that shot's **drift** shrinks 15%. If the random scatter is what took it off line, the **scatter** shrinks 5%. Edges and misses don't teach direction. |
| Ideal / OK shots | Each ideal shot's fit for this length rises by 0.1, and each OK shot rises toward 0.65 (+0.06). Both widen their line toward the ball. If the shot you played was neither but was rewarded, its fit drops by 0.05. |

Nothing is saved until you choose **Save calibration** and confirm. **Discard**
goes back to what was saved. Regular matches use the saved calibration but
never ask questions or tune.

**Tuning panel (T)** shows every value and lets you override it live, from the
intro, the nets or a paused match:

| Tab | Shows |
| --- | --- |
| Timing | A histogram of your recent presses (raw and after the offset) over the perfect, good and miss bands; the offset, window width, and each shot's swing time and window. |
| Shots | The 13 × 5 fit heatmap (click a cell to edit), plus each shot's line band, power, launch angle, aim (degrees) and timing drift. |
| Outcomes, Fielding & running, Bowling & read | Every coefficient, with its default. |
| History | Every nudge, with undo. |

Changed values are marked, and each one resets on its own. The footer has
Save…, Revert to saved, Reset all to defaults, and Export / Import JSON.

**Where the values come from:**
1. Code defaults.
2. A repo `calibration.json`, if present: an export saved as
   `short-ball/calibration.json` is baked in by `node build.mjs` as the new
   defaults.
3. The browser's saved calibration (`localStorage`). A save remembers which
   baked file it was made on top of. When you bake a different
   `calibration.json`, the new file takes over on the next load, and the older
   browser save is kept under a backup key (`chase-calibration-v1-superseded`).
   Saves made after that win again until the next bake. **Forget browser
   save** in the tuning panel deletes this browser's save on demand.

`node qa/game-bake.mjs` checks this order. Run it against a build with a
`calibration.json` baked in.

The registry lives in `src/game/tuning.js`. The game modules keep their own
numbers (`K` in `batting.js`, `FK` in `fielding.js`, `SHOTS`, `DIFFICULTY`),
and with no calibration the outcome model is byte-for-byte unchanged.

### How it works

- **Timing.** `err = press + swing − contact`. Early drags the ball to the leg
  side and pops a drive up. Late sends it finer and finds the outside edge.
  Beyond the miss window you are beaten, and then the laws apply: bowled, LBW
  (not out if it pitched outside leg), or "hit on the pad".
- **Shot selection.** Each shot has the lengths and lines it suits (`SHOTS` in
  `src/game/batting.js`). A poor fit edges or misses. The wrong shape entirely,
  such as a pull to a yorker, almost never connects.
- **The bowler** (`src/game/bowlerAI.js`):
  - Picks an over plan: new ball, outside-off channel, short-ball barrage,
    attack the stumps, or death.
  - Sets the matching field: attacking, balanced, or death.
  - Chooses each ball: outswinger, inswinger, off- or leg-cutter, straight
    ball (no swing or seam, mostly at the stumps), bouncer, yorker or slower
    ball, plus pace, line and length.
  - Reacts to the required rate, wickets and your last shot, and avoids the
    zones you score in. It misses its spot a little and strays now and then
    (wides).
- **The ball** (`delivery.js`) is solved once at release. It pitches where the
  AI aimed, swings before the bounce, seams after it, and arrives at the line
  and height the length implies.
- **Off the bat,** `ballSim.js` integrates the ball over the outfield. Each
  fielder finds the earliest point it can reach (catch, dive or pick-up), and
  runs come from the throw time against 1.95 s per run (`fielding.js`).
- **Choreography** (`controller.js`): every actor and the ball run on a `Plan`,
  a list of segments plus open rests in game time. A segment is scheduled once
  the outcome is decided, so each throw lands in the hand that will be there.
  Pausing and fast-forwarding cannot desync anything.

| Query | Effect |
| --- | --- |
| `?level=easy\|medium\|hard` | difficulty |
| `?seed=7` | fixed match (target, balls, outcomes) |
| `?bot=1` | the computer bats |
| `?hud=0` | no HUD |
| `?manual=1` | time only moves through `__game.advance()` (QA) |

### Game QA

| Script | Checks |
| --- | --- |
| `node qa/game-rules.mjs` | Outcome rules over 300 forced balls each. A perfect cover drive to a full ball outside off hits (mostly boundaries); a leave on the stumps is out every time; a late drive at an outswinger edges or misses; a pull to a bouncer is middled and to a yorker misses; way early is beaten. |
| `GAMES=300 node qa/game-sim.mjs` | Balance: bots of different skill at each difficulty. Medium: a well-timed bot wins about 50%, an average one under 10%. |
| `node qa/game-test.mjs` | In the browser: a real keyboard ↓+←+D commits a cover drive; frame rate; the same seed and inputs give an identical scorecard; a whole match reaches the result card; a phone frame; zero page errors. |
| `node qa/game-audio.mjs` | Real time, with a real gesture: the read shows during the run-up and is gone by release; run-up, grunt, bounce and bat sounds fire; the output is audible (non-zero RMS). |
| `node qa/game-tuning.mjs` | The calibration core (Node). Eight "felt right" answers at +40 ms move the offset to 30–45 ms; harsh/kind move the edge coefficients the right way; an ideal-shot pick raises its cell and widens its band; 600 nudges stay in range; export/import round-trips; reset is exact; scales never compound. |
| `node qa/game-calibrate.mjs` | The flow in a browser. The picker forces the ball; 5 answers move the offset; panel edits and undo work live; a confirmed Save survives a reload into a regular match (presses corrected by the offset, no questions asked); Reset clears; Import restores. |
| `CAL=calibration.json node qa/game-sim.mjs` | Balance with a calibration applied (also works for `game-rules.mjs`). |
| `node qa/game-poses.mjs`, `node qa/game-moments.mjs` | Close-ups of every shot at impact and at the finish, plus bowled, keeper take, catches, dives, walk-off and new batter (`qa/game/`). |
| `node qa/game-conditions.mjs` | The Conditions panel and its effects on the match and the look; OUT, DROPPED, FOUR and SIX never show before the catch, drop or rope. |
| `node qa/game-drs.mjs` | With an umpire who errs whenever he can: an LBW pitching outside leg is overturned (review kept), a plumb one stands (review lost, wicket falls), a caught-behind off nothing is overturned on UltraEdge, and an offer left to run out walks the batter. Screenshots of every stage in `qa/game/drs/`. |
| `UMP=0.25 node qa/game-sim.mjs` | Balance with an erring umpire and no reviews (also `COND='{"sky":"humid"}'`). |
| `node qa/crowd-preview.mjs` | Records the crowd from the game's own mix to `qa/game/crowd-preview.wav`, with a spectrogram. |
| `node qa/frame-hash.mjs` | Diorama frames are unchanged. |

Known simplifications:

- The bowler bowls every over from the same end.
- There are no run-outs or byes; the batters only run what is safe.
- A six over the boards is lost, and the umpire tosses the bowler a new ball.

## Build

```bash
npm install
node build.mjs            # add --minify for shipping
```

## Layout

```
DESIGN.md        filled design sheet: premise, cast, systems, beats (clock seconds), budget
CREDITS.md       no imported assets; template provenance
refs/            reference contact sheets + SOURCES.md research log (clips are reference only)
src/config.js    slab, pitch, loop, clock<->domain mapping, helpers
src/core/        palette (64), post pass (+ world clip), materials (palette-validated), geometry
src/scene/       camera (re-centred fit), lighting, ground, scoreboard, kit, cast (actor +
                 grounding + bat + IK), ik, cricketPoses, stage (beat table, all actors, ball),
                 motion (shared pose/walk/flight helpers), gameGround (the oval), gameCamera
src/game/        the Chase: rules, delivery, batting, ballSim, fielding, bowlerAI, match (pure,
                 Node-testable); plan, controller, input, hud, index (the live game)
qa/              playbook harness + probe-contacts.mjs, standalone.mjs, tools/zoom.py
shots/final/     16 timestamps x 3 viewports + proof strips
shots/grey/      grey blockout frames
```

## Beat table (page clock)

| t | beat |
| --- | --- |
| 0.0 | establish; run-up 0.55 |
| 3.00 / 3.58 / 3.98 | release / beaten / keeper take |
| 15.50 / **16.12** / 16.32 | bouncer release / **helmet** / follow-through |
| 29.00 / 29.56 / **30.00** | release / edge / **second slip catch** |
| 30.6–32.6 | out signal; celebration; bowler gets the ball at 34.1 |
| 31.6–41.0 | batter A out through the gate, batter B in; guard until 43.8 |
| 46.0 = 0.0 | seam (identity swap B → A, zero delta) |

## QA results (this build)

| Check | Result |
| --- | --- |
| `qa/shoot.mjs` 1280x800, 1388x950, 390x844 | no console errors at all three; camera identical per viewport |
| `qa/audit.mjs` LOOP=46 STEP=0.1 | passed: no flat halos, fades, early hides, teleports; camera/render scale ok; no margin leaks |
| `qa/sweep.mjs` 0–45.9 s, STEP=0.1 | no pair under 0.6 m; no jump over 3 m |
| `qa/frames.mjs` (3 windows, 12 fps; delivery at 24 fps) | batters, keeper, slips, umpire, non-striker `ok`; bowler `ok` on the delivery window |
| `qa/probe-contacts.mjs` | every hold 0 m palm-to-ball; grip gap max 0.059 m; transition pop 0.001 m; seam delta 0 m / 0 rad for all actors |
| `qa/standalone.mjs` | `file://`, zero errors, camera locked, frames 1.5 s apart differ |
| `qa/viewer-test.mjs` | bar hidden under automation; drag rotates, wheel zooms (min distance held), pan keeps the target on the slab; 1x / 2x / 0.25x measured at 1.00 / 2.00 / 0.25 s/s; Space pauses; scrubber seeks; R returns to the locked camera (residual 7e-15 m) |

Known limits:

- **The phone portrait (390x844) is tiny.** The figures are ~10 px. It frames
  correctly, but a 40 m slab cannot read on a portrait phone without breaking the
  slab or the locked camera.
- **`frames.mjs` flags the bowler and ball over long windows.** They come back
  `NOT-IN-WINDOW` over the 3.8 s windows because a 15–35 m sweep makes them
  under 0.2% of the crop. They are proven instead by the 24 fps delivery window
  and by `probe-contacts.mjs`.
- **The ball is drawn 2.5x real size** and its flight is about 15% slower than
  145 km/h, so it is traceable over 20+ frames.

## Proof

| File | Shows |
| --- | --- |
| `shots/final/wide-establish.png` | the whole set: composition, margin, both ends, board, roller, crate |
| `shots/final/proof-bowler.png` | run-up → bound → release (ball overhead, umpire behind the stumps) |
| `shots/final/proof-helmet.png` | helmet contact + star → hit +0.2 s (ball looping off) → kneel |
| `shots/final/proof-catch.png` | edge on the bat → second slip horizontal with the ball → finger and celebration |
| `shots/final/proof-board.png` | scoreboard: seam state, mid-flip, BEATEN, BOUNCER |
| `qa/frames/delivery/bowler/sheet.png` | 24 fps delivery strip, compared with `refs/cricket/archer-delivery-12fps.png` |
| `qa/frames/d3/slip2/sheet.png` | the dive, roll and get-up, compared with `refs/cricket/slip-dive-01.png` |
| `shots/grey/` | grey blockout: staging reads without palette |

## Calibrations (recorded per the playbook)

- **Slab 40 x 14** instead of 21 x 14, for a real 20.12 m pitch plus the run-up and the keeper.
- **Render scale 2x** (maxDim 2600, CSS `image-rendering: auto`): the post pass quantises at twice the CSS grid and the browser box-filters it down. Audit RENDER_SCALE passes; portraits were re-shot at 2x.
- **Page frame 94vw x 82vh** instead of 64%, to keep the figures at 30–45 px on desktop.
- **Camera look-at target re-centred** on the projected slab after the fit. Angles, fov and `subjectScale` are unchanged.
- **Shadow frustum ±23 with a 4096 map** (template: ±13, 2048).
- **`post.js` applies the world clip planes** during the scene pass. The template's `render()` took no clip planes.
- **Viewer mode** (requested): orbit, zoom, pan, speed and scrub. It breaks the playbook's *locked angle* and *empty paper* rules on purpose. The locked view stays the default, reset is exact, and the bar never appears in QA frames.
- **Page clock = domain − 3**, so the batter identity swap falls on the loop seam.
