import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const minify = process.argv.includes('--minify');

await mkdir('dist', { recursive: true });

// A calibration exported from the game's Tuning panel, saved as calibration.json,
// becomes the game's defaults (the browser's own save still wins when present).
const calibration = existsSync('calibration.json') ? JSON.parse(await readFile('calibration.json', 'utf8')) : null;
if (calibration) console.log(`baking calibration.json (${Object.keys(calibration.params ?? {}).length} values)`);

await build({
  // The hash lets the game tell a newly baked file from one it has already seen.
  define: { __CHASE_CALIBRATION__: calibration ? JSON.stringify({ version: calibration.version, params: calibration.params, hash: createHash('sha1').update(JSON.stringify(calibration.params)).digest('hex').slice(0, 12) }) : 'null' },
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/app.js',
  minify,
  sourcemap: minify ? false : 'inline',
  legalComments: 'none',
  logLevel: 'info',
});

const js = await readFile('dist/app.js', 'utf8');
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const css = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #ffffff;
  }
  body { -webkit-tap-highlight-color: transparent; }
  #frame {
    position: fixed;
    left: 50%;
    top: 50%;
    width: 94vw;
    height: 82vh;
    transform: translate(-50%, -50%);
    background: #ffffff;
  }
  @media (max-width: 620px) {
    #frame { width: 94vw; height: 94vh; }
  }
  #stage {
    display: block;
    width: 100%;
    height: 100%;
    background: #ffffff;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    outline: none;
  }
  #fallback {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: #ffffff;
    color: #333a3d;
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.02em;
    text-align: center;
    padding: 2rem;
  }
  #fallback[hidden] { display: none; }
`;

function page(scriptTag) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<link rel="icon" href="data:," />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#ffffff" />
<title>The Short Ball — a cricket diorama</title>
<style>${css}</style>
</head>
<body>
<div id="frame"><canvas id="stage" aria-label="A real-time rendered miniature cricket diorama: a fast bowler, a bouncer and a slip catch" tabindex="-1"></canvas></div>
<div id="fallback" hidden>This diorama needs a browser with WebGL2 enabled.</div>
${scriptTag}
</body>
</html>
`;
}

await writeFile('index.html', page('<script src="./dist/app.js"></script>'));
await writeFile('short-ball.html', page(`<script>${safeJs}</script>`));

console.log(`built dist/app.js (${(js.length / 1024).toFixed(0)} kB), index.html, short-ball.html`);
