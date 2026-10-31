# The Short Ball — design sheet

> Kept in sync with `README.md`, `src/scene/stage.js` (the beat table) and the
> QA frames. If a number here disagrees with `stage.js`, `stage.js` wins and this
> file is the bug.

## Premise

A Test-match over in miniature: **a fast bowler** (place: the pitch) **runs in and
bowls the same over again and again** (ritual), **a bouncer hits the batter on the
helmet** (interruption), and **the next ball swings, takes the outside edge and is
caught by second slip**; the batter walks off and the next one walks in (payoff
and seam).

- Archetype (router row): **arena / battle**. The bowler is the attacker, the batter's
  wicket is the goal, the slip cordon is the trap. No deaths: actors *exit*
  (social-diorama reading of the Death row).
- Assumption line: arena archetype, 46 s loop, 3 deliveries (outswinger beaten,
  bouncer to the helmet, edge to second slip), 8 roles including the incoming batter,
  40 x 14 slab, 64 colours.

## Game mode (added on request)

`?mode=game` is a second, interactive piece built on the same set. It deliberately
breaks the loop and locked-camera rules: it is stateful, it has a broadcast camera,
and it plays on a wider oval with a full XI. The diorama path never imports its
state, and `qa/frame-hash.mjs` proves the loop's frames are byte-identical. The
README covers the rules, the controls and the QA.

## Camera Side

- Locked angle: azimuth 45, elevation 33, fov 20.5; fillX 0.90, fillY 0.88. This is
  the default and the reset view. Viewer mode (`src/viewer.js`, requested) adds
  orbit, zoom, pan, speed and scrub as a deliberate exception to the locked-angle
  and empty-paper rules. Limits: polar 0.12 to PI/2 - 0.1, distance 5 m to 1.6x
  the fit, orbit target clamped to the slab. The bar is hidden under automation
  and with ?ui=0.
- Look-at target re-centred on the projected slab after the fit (camera.js):
  at 45/33 a 40 m slab projects low and left of the slab centre, wasting 25% of
  the frame. Angles, fov and subjectScale are unchanged. Calibrated, recorded here.
- Subject scale: 1.0.
- Exterior. No street; the pitch runs along world X. +X (bowler's end) lands at
  lower-right on screen, -X (striker's end, slips) at upper-left.
- Night palette: none, it is a day Test.
- Render buffer: **2x CSS** (renderScale 2, maxDim 2600, `image-rendering: auto`); `?rs=1` gives the 1:1 chunky grid. Raised on request: the 1x grid read as too blocky. The page
  frame is 94vw x 82vh rather than the template's 64%, because a 40 m slab at 64%
  puts the figures at 31 px. Calibrated per the skill, recorded here.
- Slab: **40 x 14 x 0.42** (x -20..20, z -7..7). This breaks the 21 x 14 default
  on purpose: stumps to stumps is 20.12 m, plus an 8 m run-up and 8 m to the
  keeper. A shorter pitch would read as a back-garden game.
- Hero face: the batter stands side-on, so his chest faces +Z, toward the camera,
  and the slips stand on the off side (+Z), in front. The bowler is seen from
  behind and to his left, which is how a fast bowler is usually seen on TV.
- Threshold: the pavilion gate in the back boards at x -11.5..-7.5, z -6.7. Keep
  2 m clear inside it; the outgoing and incoming batters use it.
- Tall landmark: speed-gun scoreboard at (-1.5, -6.1), 4.6 m to the flag tips.
  Back edge, centre screen, offset from the batter.
- Foreground prop (near corner): heavy roller at (15.6, 5.4).
- Mid-ground prop: the umpire, plus the drinks crate and spare kit at (-2.5, 5.6).
- Must never be occluded: the ball's path from release to the batter, and the slips.
- Grey blockout frames: `?grey=1`, `shots/grey/` (shot before the clock offset; domain 6.2 / 19.12 / 33.0).

## Cast Sheet

| Role | Silhouette feature | Locomotion | Action | Reaction | Exit / death | Signature prop |
| --- | --- | --- | --- | --- | --- | --- |
| Bowler | bare head, zinc stripes, towel at the hip | walk back, accelerating run-up, bound | gather, side-on, windmill release, follow-through | hands on head (beaten); walk-down stare (bouncer) | sprint to the slips, celebration, jog back to the mark | red ball, marker disc |
| Striker A | maroon helmet with grille, pads, gloves | step to the crease | stance, forward push, drive | helmet hit: snap, stagger, kneel, recover | look back at the catch, bat under the arm, walk off through the gate | bat |
| Striker B | same kit (he is the loop seam) | walk in from the gate | takes guard (bat taps) | — | becomes A at t = 0 | bat |
| Non-striker | helmet, pads | backs up at every delivery | — | turns to watch | — | bat |
| Keeper | big gloves, deep crouch | rise and step | catch, throw back to the bowler | jumps to the deflection | runs to the catcher | gloves |
| 1st slip | navy cap | crouch / stand | hands cupped | hands on head after the play-and-miss | runs to second slip | cap |
| 2nd slip | navy cap, cream jumper | crouch / stand | full-length dive catch | rolls, ball held up | hands the ball to the bowler | ball |
| Umpire | wide-brim hat, navy shirt | sway, lean in at delivery | out signal (finger) | flinch at the bouncer | — | bowler's cap in his belt |

## Life / Service Sheet

Not a service scene, but the over is a queue: one delivery after another, each
served only after the bowler has reached the mark and the batter is set.

| Role | Entry | Slot | Order | Pay | Receive | Exit |
| --- | --- | --- | --- | --- | --- | --- |
| Striker A | in stance at t = 0 | crease (-7.7, -0.35) | stance by R-0.6 | — | ball at R+0.56 | gate 37 → 42 |
| Striker B | gate at 37.6 | crease | takes guard 44.6 → 46.4 | — | — | becomes A |

## System Sheet

- Loop length / DT: 46.0 s, 40 Hz. Timeline domain is [3, 49) and page clock =
  domain - 3, so the one identity swap (batter B becomes batter A, same kit, same
  stance) falls exactly on the loop boundary (the audit exempts the seam).
- Systems:
  1. **Delivery**: run-up → bound → back-foot contact → front-foot contact → release → follow-through. Origin is the bowler's hand. Output is a ball in flight.
  2. **Ball flight**: release → pitch (dust puff + mark) → swing / bounce → bat, helmet or keeper.
  3. **Slip cordon**: crouch at R-0.6, dive and catch on the edge, celebration.
  4. **Speed-gun scoreboard** (machine): engage (lamp blink) → flip panels → output (km/h + verdict) → settle. Updates at R+2.4.
- Crew: keeper and slips return the ball (throw / hand-off). The umpire signals.
- Goal / disruption: the bowler acts on the **batter's wicket**. The bouncer is
  the contact (helmet = goal response: flash, head snap, stagger). The edge is the
  consequence (wicket falls, batter exits).
- What changes: the batter is replaced; ball marks pile up on the pitch and fade;
  the scoreboard reads OUT.

### Shot / Event Count

| System | Shots / events | First at | Last at | Proof frame |
| --- | --- | --- | --- | --- |
| Delivery | 3 releases | 3.00 | 29.00 | `shots/final/*-release` |
| Ball contact | keeper 3.98, helmet 16.12, edge 29.56, catch 30.00 | 3.98 | 30.00 | `shots/final/*-helmet`, `*-edge`, `*-catch` |
| Ball returns | 3 (throw, throw, hand-off) | 5.40 | 34.10 | `qa/probe-contacts.mjs` |
| Scoreboard | 3 flips | 5.40 | 31.40 | `shots/final/proof-board.png` |

## Beat Sheet

All times are **page-clock seconds** (what `?t=` takes). The code keeps them in
domain time (clock + 3) in `stage.js`; `window.__diorama.clockTL` prints the
table in clock seconds.

| Time | Beat | Camera proof |
| --- | --- | --- |
| 0.0 | establish: batter set, bowler at the mark, board shows the last ball (OUT) | `wide-establish` |
| 0.55 | run-up begins | `wide-runup` (2.0) |
| 2.55–2.82 | bound: both feet off, gather, turning side-on | `wide-bound` (2.72) |
| 3.00 | release: outswinger | `wide-release` |
| 3.58 | beaten outside off | `wide-beaten` |
| 3.98 | keeper takes it | `wide-keeper-take` |
| 5.4 / 6.4 | ball thrown back / caught by the bowler; board flips to `142 KM/H BEATEN` at 5.4 | `wide-board-flip` (5.75) |
| 15.50 | bouncer release | — |
| **16.12** | **helmet hit**: ball on the grille, star, shell flash | `wide-helmet` |
| 16.32 | hit + 0.2: head snapped, ball looping off to the keeper | `wide-helmet-follow` |
| 17.4–21.0 | batter doubled up, then on one knee; keeper walks in; bowler stares | `wide-kneel` (18.5) |
| 23.4 | second return throw caught | probe |
| 29.00 | full outswinger release | — |
| 29.56 | outside edge | `wide-edge` |
| **30.00** | **second slip diving catch** | `wide-catch` |
| 30.6–32.6 | umpire's finger; cordon celebrates; bowler sprints in (arrives 32.15) | `wide-finger`, `wide-celebrate` |
| 33.85–34.1 | ball handed to the bowler | probe |
| 31.6–38.4 | batter A walks off through the gate | `wide-exit` (37.0) |
| 34.6–41.0 | batter B walks in, takes guard to 43.8 | `wide-exit` |
| 45.2 | bowler back at the mark, turns | `wide-seam` (45.975) |
| 46.0 = 0.0 | seam: B in stance = A in stance (identity swap, 0 m delta) | probe |

## Hero Objects

| Name | Type | Parts | Construction layers | Story detail | Contact |
| --- | --- | --- | --- | --- | --- |
| `batter` (kit) | person | 40+ | helmet shell, peak, grille bars, neck guard; pads with straps and knee rolls; gloves | scuff on the helmet after the hit | feet; contact shadow |
| `bat` | prop | 6 | blade, spine ridge, splice, handle, grip, sticker band | worn toe and an edge mark | palms (IK bottom hand) |
| `stumps` x2 | prop | 9 | 3 stumps, 2 bails, painted base band, crease sockets | footmarks and guard scratch at the crease | in the ground |
| `scoreboard` | landmark | 35+ | 2 legs, braces, cabinet, frame, 2 flip panels, lamp, roof, 2 flags, ladder | weathered sponsor plate, ladder | footings + shadow |
| `roller` | prop | 12 | drum x2, axle frame, yoke, handle bar, chain cover, seat | rag tied on the handle, rust patches | drum on the grass |
| `pitch` | environment | 10 | strip, worn ends, creases, return creases, ball marks | footmarks, guard mark, ball marks | slab |
| `bowler` | person | 30+ | rig + towel, zinc, sweatband | towel tucked at the hip | marker disc at the mark |

## Contact / Choreography Sheet

| Beat | Hands on | Prop / seat anchor | Start | Contact | Release | Proof |
| --- | --- | --- | --- | --- | --- | --- |
| Bat grip | striker: top hand (rig R) + IK bottom hand | bat handle | always | — | kneel (bottom hand off) | portrait |
| Release | bowler rig-L hand | ball | R-2.5 | — | R | release strip |
| Keeper take | keeper gloves | ball | R+0.9 | R+0.98 | throw R+2.4 | strip |
| Throw back 1 | keeper L palm → bowler L palm | ball | 4.95 (into the throwing hand) | 6.40 | — | probe: 0 m |
| Throw back 2 | keeper L palm → bowler L palm | ball | 21.95 | 23.40 | — | probe: 0 m |
| Slip catch | 2nd slip hands | ball | 32.86 | 33.00 | hand-off 36.9 | catch strip |

## Ambient Loops

| Loop | Period | Motion | Phase offset | What it touches |
| --- | --- | --- | --- | --- |
| scoreboard flags | 1.7 s / 2.3 s | pennant sway, 3 segments | 0 / 1.9 | scoreboard roof |
| fielders' breathing / weight shift | 3.1–4.4 s | torso and head | hash per actor | idle fielders |
| ball marks | fade 9 s | mark opacity | per delivery | pitch |

## Surface / Motion / FX Audit

- Slab edges: the grass runs flush to the slab edge; no terrain.
- Exit rule: batter A stays visible until his bounds clear z -7 - 0.35; B is
  hidden until he is outside the same margin.
- Event FX windows (clock): pitch dust at each bounce 3.40 / 15.77 / 29.46 (0.5 s);
  helmet star 16.12 (0.16 s); edge spark 29.56 (0.14 s); dive dust 30.10 (0.6 s). Each starts at the contact
  point.
- Idle effects allowed: none.
- Large translucent planes: contact shadows only (radial textured).
- Whole-object fades: none.
- `qa/audit.mjs` contract: slab, movers (batterA, batterB), emitters (dust).

## Detail Budget

| Element | Count | Parts each | Story detail |
| --- | --- | --- | --- |
| Machines | 1 scoreboard | 35 | weathered plate |
| People | 8 | 30–55 | per cast sheet |
| Props | stumps x2, bat x3, roller, kit crate | 6–15 | rag, marks |
| Landmark | 1 | 35+ | flags |
| Exits | 1 (batter walks off) | exit-only, no debris | changed board, ball marks |
| Ambient loops | 2+ | | |
| Triangles / draw calls | < 250k / < 1200 | | |

## Palette

- Length: 64 (must equal `uPalette[64]` in `post.js`; asserted at load).
- Base: paper and creams, a 10-step outfield green ramp, 7 pitch clays, skin,
  navy, maroon.
- Accents: ball red, scoreboard amber, sponsor blue/yellow.
- Forbidden: pure black, gradients, colours outside the palette.

## QA Frames

Kept in `shots/final/` (wide/ipad/phone x 16 timestamps) plus the zoomed proof
strips. See README "Proof" for what each one shows.

| Frame | Time | What it proves |
| --- | --- | --- |
| Grey blockout | 3.2 / 16.12 / 30.0 (old domain 6.2 / 19.12 / 33.0) | staging reads without colour: `shots/grey/` |
| Establish | 0.3 | composition, margin, bowler at the mark, board in seam state |
| Delivery | 2.0 / 2.72 / 3.0 | run-up, bound, release with the ball overhead |
| Helmet | 16.12 / 16.32 | contact + response, then follow-through |
| Kneel | 18.5 | consequence; keeper walking in |
| Edge / catch | 29.56 / 30.0 | edge on the bat; second slip horizontal with the ball |
| Celebrate / finger | 31.4 / 32.4 | out signal, cordon cluster |
| Exit | 37.0 | A out through the gate, B in, no jam (sweep) |
| Seam | 45.975 vs 0 | identical actors (probe: 0 m, 0 rad) |
| Standalone | — | `file://`, zero errors, camera locked, loop alive |

## Risks

- The ball (0.18 m drawn) is about 5 px; it needs a trail and a dark contour.
- The figures are about 45 px tall at 1280 x 800; the phone portrait will be small.
- Cream kit against white paper: kit only ever sits on green, never on the rim.
- Bat grip: two hands on one handle needs IK; check the palm distance.
- Batters A and B cross near the gate: check with the sweep.
