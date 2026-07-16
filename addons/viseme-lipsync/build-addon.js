const fs = require('node:fs');
const path = require('node:path');
const { ZipArchive } = require('archiver');

const addonRoot = __dirname;
const releaseDir = path.join(__dirname, '..', '..', 'release');
const outputPath = path.join(releaseDir, 'Viseme-Lip-Sync-Addon.zip');

fs.mkdirSync(releaseDir, { recursive: true });
const output = fs.createWriteStream(outputPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

archive.on('error', error => { throw error; });
output.on('close', () => {
  console.log(`Created ${outputPath} (${archive.pointer()} bytes)`);
});

archive.pipe(output);
archive.glob('**/*', {
  cwd: addonRoot,
  ignore: ['build-addon.js'],
  dot: true
}, { prefix: 'Viseme Lip Sync Addon' });
archive.finalize();
