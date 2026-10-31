# Credits

No third-party models, textures or animation clips are imported. Every mesh is
built in code from primitives against the reference sheets in `refs/cricket/`.

| Asset | File | Source | Author | Licence |
| --- | --- | --- | --- | --- |
| player rig, post pass, camera, lighting, poses, track, detail helpers, QA harness | `src/`, `qa/` | Diorama playbook `templates/` @ 077f604 (github.com/sloemo01/diorama) | Nehal Kanak (sloemo) | MIT |
| cricket kit, bat, stumps, scoreboard, roller, pitch, choreography | `src/scene/*.js` | hand-built for this scene | this build | owned by the user |

Reference clips in `refs/cricket/*.mp4` were downloaded from YouTube for timing
and shape reference only. They are not part of the build and must not be
redistributed with it.

## Rules

- Allowed: CC0, public domain, CC-BY with attribution, assets the user owns or
  supplied, and AI-generated meshes the user commissioned.
- Not allowed without asking: NC, ND, editorial-only, game rips, or no stated licence.


Game-mode sound (`src/game/audio.js`) is synthesised at runtime with WebAudio (oscillators and filtered noise). No audio samples are imported.
