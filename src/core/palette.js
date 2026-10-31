/**
 * 64-colour sRGB palette for a day Test match. The scene is quantised to these
 * values after an 8x8 ordered dither. The length must equal `uPalette[64]` in
 * post.js; main.js asserts it at load.
 */
export const PALETTE_HEX = [
  // paper and cricket whites (cream, not paper white, so kit never melts into the page)
  '#ffffff', '#f6f2e6', '#ebe4d0', '#dcd3ba', '#c9bfa4', '#b0a68a', '#918a70',
  '#6f6a55',
  // outfield greens, dark to light (two mown-stripe tones plus shade/light)
  '#26391f', '#304a27', '#3b5a2e', '#466b35', '#517b3c', '#5c8a43', '#69994b', '#77a755',
  '#86b460', '#9cc472',
  // pitch clays and footmarks
  '#e6d7a9', '#d8c592', '#c9b27c', '#b49c66', '#9b8353', '#7f6a44', '#625236',
  // skin
  '#f0cfae', '#dcae86', '#c48f66', '#a06d48', '#704831',
  // hair and the darkest darks (never pure black)
  '#2a211c', '#41332a', '#5a4737', '#171a18',
  // navy (fielding caps, umpire shirt, sponsor boards)
  '#1c2847', '#283a63', '#3a5185', '#5770a6', '#8ca0c6',
  // maroon helmets and the red ball
  '#4f1219', '#741c26', '#9a2731', '#c13a3c', '#e2675c',
  // willow and wood
  '#f1dfb2', '#dbbf88', '#b99760', '#7c5d39',
  // greys and steel (roller, stumps paint, grille)
  '#d3d7d6', '#a9b0b1', '#7d8789', '#58625f', '#3b4340', '#262d2b', '#4a4f3c',
  // scoreboard: board green, amber lamps and text, lamp core
  '#1d2c25', '#f3c94a', '#e39a2e', '#fff1b8',
  // flags and sponsors
  '#3a83c6', '#7dbbe3', '#e5843a', '#2f8f86', '#c9d86a',
];

export const PALETTE_RGB = PALETTE_HEX.map((hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
});
