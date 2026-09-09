import { readFile, writeFile } from 'node:fs/promises';

const targetVersion = process.env.npm_package_version;
if (!targetVersion) throw new Error('npm_package_version is not set. Run this script through npm version.');

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
manifest.version = targetVersion;
await writeFile('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(await readFile('versions.json', 'utf8'));
versions[targetVersion] = manifest.minAppVersion;
await writeFile('versions.json', `${JSON.stringify(versions, null, 2)}\n`);
