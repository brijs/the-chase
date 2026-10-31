# Sources

The research log for The Short Ball. Written before the first mesh. Clips are kept in
`refs/cricket/` (360p, reference only, never geometry) next to their contact sheets.

## Motion grammar, in words (the acceptance test)

**Fast bowler.** A walk back to a marker disc, a turn, then a run-up that
accelerates over 15–20 m: short strides at first, then long low strides with
the arms pumping and the ball held near the chin. Two strides out he **bounds**:
both feet leave the ground, both arms come up in front of the face, and the body
turns side-on in the air (`archer-delivery-12fps.png`, rows 1–2). He lands on the
back foot side-on, with the front arm pointing high at the batter
(row 2, frames 5–7). The front leg plants braced and nearly straight, the front arm
pulls down hard to the hip, and the bowling arm windmills up behind and **over the
top**, releasing at or just past vertical, beside the ear (row 3, frames 1–4). The
follow-through carries the arm down and **across** the body to the opposite hip,
the trunk folds forward to near horizontal (row 4), and he runs on 4–5 m, peeling
off the pitch to his left.

**Batter.** Side-on stance, chest to the off side, head turned square to the
bowler, knees flexed, bat grounded behind the back toe, hands together at the
top of the handle. A trigger step back and across as the ball is released.
Against the full ball: a front-foot stride and a push or drive, head over the
ball. Against the bouncer (`bouncer-leave-01.png`, `akhtar-bouncer-01.png` rows
2–3): back and across, the head turns away late, the ball hits the grille, the head
snaps back and round, he staggers, bends double and holds the helmet. Fielders and
the bowler walk in; he straightens up and re-marks his guard.

**Edge and slip catch** (`slip-dive-01.png`, `slip-edge-01.png`): slips crouch with
hands cupped low at release and rise as the ball passes. The edge flies low and
fast; second slip dives full length to his right, lands on his side with the ball
in both hands, rolls, springs up with the ball held high, and the cordon converges.
The batter looks back over his shoulder, drops his head, puts the bat under his arm
and walks off.

## Shape

| Question | Searched | Found | Decision |
| --- | --- | --- | --- |
| what a delivery looks like, in order | yt: `fast bowler run up slow motion side view` | `sdS96c6Lej8` Archer 90+ mph, `GxdP_lBE4Rs` Lee run-up | `refs/cricket/archer-delivery-12fps.png`, `lee-runup-0*.png` |
| bouncer to the helmet | yt: `bouncer hits batsman helmet slow motion` | `SjohqtGVZeo` Akhtar, `WW43JAowaY0` leaves | `akhtar-bouncer-01.png`, `bouncer-leave-01.png` |
| edge to slips | yt: `slip catch slow motion cricket`, `edged to second slip diving catch` | `55qa3G5WKIo` 2nd-slip dive, `8YK_kxds1ns` Kohli caught at slip | `slip-dive-01.png`, `slip-edge-01.png` |
| field geometry | Laws of Cricket (wicket 20.12 m stumps to stumps, popping crease 1.22 m in front, stumps 0.711 m) | standard | world units in `config.js` |

## Motion

| Question | Searched | Found | Decision |
| --- | --- | --- | --- |
| run-up speed and stride | Lee clip at 3 fps; biomechanics clip `hAP1dAyMd0Q` | final strides 6–8 m/s; bound flight ~0.3 s | 7.6 m run-up in 2.0 s ending ~6.6 m/s; bound 0.27 s |
| delivery phases | Archer sheet at 12 fps (slow-mo source) | bound → back-foot contact → front-foot contact → release → follow-through, in ratio ~5 : 2 : 1 : 6 | back-foot contact R-0.18, front-foot contact R-0.08, release R, follow-through to R+1.3 |
| ball speed | broadcast speed guns 140–150 km/h | 20 m in ~0.5 s | 0.56–0.62 s release → bat (compressed ~15% so it is traceable over 20+ frames) |
| helmet reaction | Akhtar sheet | snap, stagger, kneel ~3 s, re-mark guard | hit model: snap 0.15 s, stagger 0.8 s, kneel 3 s, recover |

## Assets

| Asset | Ladder step | Source / query | Licence | Decision |
| --- | --- | --- | --- | --- |
| player rig | 1 (on disk) | `templates/peopleModel-street.js` | MIT (skill) | used; cricket kit added in `kit.js` |
| cricket helmet | 3 (CC-BY) | Sketchfab API `cricket helmet` downloadable: 3 CC-BY hits; `license=cc0`: 0 hits | CC-BY | not imported: a download needs a Sketchfab token, and it would be ~6 px, textured and smooth. Hand-built (shell, peak, grille, neck guard) |
| stumps / bat / ball | 2–3 | Sketchfab `cricket stumps` (CC-BY `Stump`, `Cricket Set`), Poly Haven models (0 cricket hits), poly.pizza `cricket` (2 bat cards) | CC-BY / unknown | hand-built: the bat must sit between IK'd hands, and stumps at 2 px want hand-tuned widths |
| roller / scoreboard | 4 | Poly Haven: 0 hits | — | hand-built |
| animation clips | 2 | Quaternius UAL / Mixamo: no bowling or batting actions | — | hand-keyed from the 12 fps sheets |

## Proof

| Beat | Capture | Compared against | Result |
| --- | --- | --- | --- |
| delivery | `qa/frames/bowler/sheet.png` | `refs/cricket/archer-delivery-12fps.png` | see README QA section |
| helmet | `shots/wide-helmet.png` | `akhtar-bouncer-01.png` row 2 | see README |
| slip catch | `qa/frames/slip2/sheet.png` | `slip-dive-01.png` row 3 | see README |
