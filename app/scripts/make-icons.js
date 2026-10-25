// Builds every icon the app ships from the masters in ../../assets-src/icons (AI-generated).
// Masters have a faint coloured glow around the tile; an alpha curve drops it,
// then the tile is trimmed and re-padded so all icons share one footprint.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');

const SRC = path.join(__dirname, '..', '..', 'assets-src', 'icons');
const BUILD = path.join(__dirname, '..', 'build');
const ASSETS = path.join(__dirname, '..', 'renderer', 'assets');
// master file -> output name (kind names match the engine's document types)
const ICONS = { app: 'app', docs: 'word', sheets: 'cell', slides: 'slide', pdf: 'pdf' };
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const ALPHA_FLOOR = 90; // alpha below this is glow, not tile

async function clean(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    data[i] = a <= ALPHA_FLOOR ? 0 : Math.round(((a - ALPHA_FLOOR) * 255) / (255 - ALPHA_FLOOR));
  }
  const trimmed = await sharp(data, { raw: info }).png().trim({ threshold: 1 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.round(Math.max(meta.width, meta.height) * 1.06);
  return sharp(trimmed)
    .extend({
      top: Math.floor((side - meta.height) / 2),
      bottom: Math.ceil((side - meta.height) / 2),
      left: Math.floor((side - meta.width) / 2),
      right: Math.ceil((side - meta.width) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(ASSETS, { recursive: true });
  for (const [master, name] of Object.entries(ICONS)) {
    const base = await clean(path.join(SRC, `${master}.png`));
    const sizes = await Promise.all(
      ICO_SIZES.map((s) => sharp(base).resize(s, s, { kernel: 'lanczos3' }).png().toBuffer()),
    );
    fs.writeFileSync(path.join(BUILD, `${name}.ico`), await pngToIco(sizes));
    await sharp(base).resize(256, 256).png().toFile(path.join(ASSETS, `${name}.png`));
    console.log('icon', name);
  }
  fs.copyFileSync(path.join(BUILD, 'app.ico'), path.join(BUILD, 'icon.ico'));
  await sharp(path.join(ASSETS, 'app.png')).resize(512, 512).png().toFile(path.join(BUILD, 'icon.png'));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
