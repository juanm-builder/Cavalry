import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const app = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, app));
const [style, mark, script, document] = await Promise.all([
  read('cloudkit-sign-in/style.css'),
  read('src/renderer/assets/cavalry-mark.png'),
  read('cloudkit-sign-in/bridge.js'),
  read('cloudkit-sign-in/index.html')
]);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 12);

// Bundle the same presentation into the single-file native host. Reading assets
// beside the source at runtime would fail in the signed packaged sidecar.
await writeFile(
  new URL('src/host/cloudkit-sign-in-presentation.json', app),
  JSON.stringify(
    { style: style.toString(), mark: `data:image/png;base64,${mark.toString('base64')}` },
    null,
    2
  ) + '\n'
);
await writeFile(new URL('cloudkit-sign-in/cavalry-mark.png', app), mark);
await writeFile(
  new URL('cloudkit-sign-in/index.html', app),
  document
    .toString()
    .replace(/style\.css\?v=[a-f0-9]{12}/, `style.css?v=${hash(style)}`)
    .replace(/bridge\.js\?v=[a-f0-9]{12}/, `bridge.js?v=${hash(script)}`)
);
