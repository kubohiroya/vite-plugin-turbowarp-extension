import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const errors = [];

// Vite 7 and later require this range, so the plugin cannot support less.
const NODE_ENGINE_RANGE = '^20.19.0 || >=22.12.0';

const packageMetadata = JSON.parse(await readFile('package.json', 'utf8'));
const policy = JSON.parse(await readFile('repo-policy.json', 'utf8'));
const readme = await readFile('README.md', 'utf8');
const license = await readFile('LICENSE', 'utf8');

checkPolicy();
checkPackageMetadata();
checkReadme();
checkLicense();
await checkPackContents();

if (errors.length > 0) {
  throw new Error(`Repository policy check failed:\n- ${errors.join('\n- ')}`);
}

process.stdout.write('Repository policy is aligned.\n');

function checkPolicy() {
  if (policy.schemaVersion !== 1) errors.push('repo-policy.json schemaVersion must be 1');
  if (policy.productName !== packageMetadata.name.split('/').at(-1)) {
    errors.push('repo-policy.json productName must match the package slug');
  }
  if (policy.packageType !== 'vite-plugin') errors.push('repo-policy.json packageType must be vite-plugin');
  if (policy.licensePolicy !== 'mpl-2.0') errors.push('repo-policy.json licensePolicy must be mpl-2.0');
  if (policy.packageManager !== 'npm') errors.push('repo-policy.json packageManager must be npm');
  if (policy.node?.minimum !== packageMetadata.engines?.node) {
    errors.push('repo-policy.json node.minimum must match package.json engines.node');
  }
  if (policy.vite?.peerRange !== packageMetadata.peerDependencies?.vite) {
    errors.push('repo-policy.json vite.peerRange must match package.json peerDependencies.vite');
  }
  if (!policy.templateBoundary?.templateOwns?.includes('README generation wiring')) {
    errors.push('repo-policy.json must document the template responsibility boundary');
  }
}

function checkPackageMetadata() {
  const requiredStrings = ['description', 'author', 'license', 'homepage', 'packageManager'];
  for (const key of requiredStrings) {
    if (typeof packageMetadata[key] !== 'string' || packageMetadata[key].trim().length === 0) {
      errors.push(`package.json ${key} must be a non-empty string`);
    }
  }
  if (packageMetadata.license !== 'MPL-2.0') errors.push('package.json license must be MPL-2.0');
  if (!packageMetadata.packageManager?.startsWith('npm@')) {
    errors.push('package.json packageManager must pin npm exactly');
  }
  if (packageMetadata.engines?.node !== NODE_ENGINE_RANGE) {
    errors.push(`package.json engines.node must be ${NODE_ENGINE_RANGE}`);
  }
  if (packageMetadata.peerDependencies?.vite !== '>=6.0.0') {
    errors.push('package.json peerDependencies.vite must be >=6.0.0');
  }
  if (packageMetadata.repository?.url !== 'git+https://github.com/kubohiroya/vite-plugin-turbowarp-extension.git') {
    errors.push('package.json repository.url must point to the current repository');
  }
  if (packageMetadata.bugs?.url !== 'https://github.com/kubohiroya/vite-plugin-turbowarp-extension/issues') {
    errors.push('package.json bugs.url must point to the current issue tracker');
  }
  for (const file of ['dist', 'docs', 'README.md', 'LICENSE']) {
    if (!packageMetadata.files?.includes(file)) errors.push(`package.json files must include ${file}`);
  }
}

function checkReadme() {
  if (!readme.startsWith(`# ${policy.productName}\n`)) {
    errors.push('README.md H1 must match repo-policy.json productName');
  }
  for (const heading of [
    '## Status',
    '## Requirements',
    '## Installation',
    '## Usage',
    '## Build guarantees',
    '## Architecture / contract',
    '## Development',
    '## Release',
    '## License'
  ]) {
    if (!readme.includes(heading)) errors.push(`README.md must include ${heading}`);
  }
  if (!readme.includes(`@kubohiroya/vite-plugin-turbowarp-extension@${packageMetadata.version}`)) {
    errors.push('README.md Installation must pin the current package version');
  }
  if (!readme.includes(NODE_ENGINE_RANGE) || !readme.includes('Vite 6 or later')) {
    errors.push('README.md Requirements must match package Node/Vite support');
  }
  if (!readme.includes('Template responsibility') || !readme.includes('Plugin responsibility')) {
    errors.push('README.md must explain the plugin/template responsibility boundary');
  }
  if (!readme.includes('SPDX-License-Identifier: MPL-2.0')) {
    errors.push('README.md License section must include the SPDX identifier');
  }
}

function checkLicense() {
  if (!license.startsWith('Mozilla Public License Version 2.0\n==================================')) {
    errors.push('LICENSE must contain the Mozilla Public License Version 2.0 full text');
  }
  if (!license.includes('Exhibit A - Source Code Form License Notice')) {
    errors.push('LICENSE must include the MPL-2.0 Exhibit A text');
  }
}

async function checkPackContents() {
  const {stdout} = await execFileAsync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json']);
  const [pack] = JSON.parse(stdout);
  const files = new Set(pack.files.map((file) => file.path));
  for (const file of ['dist/index.js', 'dist/index.d.ts', 'docs/architecture.md', 'docs/readme-generation.md', 'README.md', 'LICENSE']) {
    if (!files.has(file)) errors.push(`npm pack must include ${file}`);
  }
  if (pack.version !== packageMetadata.version) {
    errors.push('npm pack version must match package.json version');
  }
}
