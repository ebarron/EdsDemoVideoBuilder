import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const KOKORO_PACKAGE = 'kokoro-js';
export const KOKORO_PACKAGE_VERSION = '1.2.1';
export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const KOKORO_MODEL_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const MODEL_FILES = {
  q8: {
    file: 'onnx/model_quantized.onnx',
    bytes: 92361116,
    algorithm: 'sha256',
    digest: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478',
  },
  q4: {
    file: 'onnx/model_q4.onnx',
    bytes: 305215966,
    algorithm: 'sha256',
    digest: '04cf570cf9c4153694f76347ed4b9a48c1b59ff1de0999e6605d123966b197c7',
  },
  q4f16: {
    file: 'onnx/model_q4f16.onnx',
    bytes: 154586422,
    algorithm: 'sha256',
    digest: 'd1a508a6a29671ead84fac99c7401fbd3c21a583fc6ed1406d1ec974d53bf45f',
  },
  fp16: {
    file: 'onnx/model_fp16.onnx',
    bytes: 163234740,
    algorithm: 'sha256',
    digest: 'ba4527a874b42b21e35f468c10d326fdff3c7fc8cac1f85e9eb6c0dfc35c334a',
  },
  fp32: {
    file: 'onnx/model.onnx',
    bytes: 325532232,
    algorithm: 'sha256',
    digest: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb',
  },
};
const MODEL_SUPPORT_FILES = [
  {
    file: 'config.json',
    bytes: 44,
    algorithm: 'git-sha1',
    digest: '790faf216e7e3f490e71e8bc80df79ed8941101c',
  },
  {
    file: 'tokenizer.json',
    bytes: 3497,
    algorithm: 'git-sha1',
    digest: '4280f55fc1c32211bc9bb4d55545759a00054ecd',
  },
  {
    file: 'tokenizer_config.json',
    bytes: 113,
    algorithm: 'git-sha1',
    digest: '5c81e9a3a06db9139900d6ee5b60e8bb701ccb0b',
  },
];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KOKORO_RUNTIME_RESOURCES = path.join(HERE, '..', 'resources', 'kokoro-runtime');
export const KOKORO_VOICES = [
  'af_heart',
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_fenrir',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_alice',
  'bf_emma',
  'bf_isabella',
  'bf_lily',
  'bm_daniel',
  'bm_fable',
  'bm_george',
  'bm_lewis',
];

export function defaultKokoroCacheDir() {
  return path.join(os.homedir(), 'Library', 'Caches', 'demo-video-builder', 'kokoro');
}

export function defaultKokoroRuntimeDir() {
  return path.join(HERE, '..', '.kokoro-runtime');
}

export function kokoroSettings(manifest) {
  const configured = manifest.narration.kokoro ?? {};
  const settings = {
    packageVersion: KOKORO_PACKAGE_VERSION,
    model: configured.model ?? KOKORO_MODEL,
    voice: configured.voice ?? 'af_heart',
    speed: configured.speed ?? 1,
    dtype: configured.dtype ?? 'q8',
    device: configured.device ?? 'cpu',
    cacheDir: configured.cacheDir ?? defaultKokoroCacheDir(),
    allowModelDownload: configured.allowModelDownload !== false,
  };
  if (!KOKORO_VOICES.includes(settings.voice)) {
    throw new Error(
      `Unsupported Kokoro voice ${settings.voice}; choose one of ${KOKORO_VOICES.join(', ')}`,
    );
  }
  if (settings.model !== KOKORO_MODEL) {
    throw new Error(
      `Kokoro model must be the pinned ${KOKORO_MODEL}; custom remote models are not downloaded implicitly`,
    );
  }
  if (manifest.output?.workDir) {
    const cache = path.resolve(settings.cacheDir);
    const work = path.resolve(manifest.output.workDir);
    if (
      cache === work ||
      cache.startsWith(`${work}${path.sep}`) ||
      work.startsWith(`${cache}${path.sep}`)
    ) {
      throw new Error('Kokoro cacheDir and output.workDir must not overlap; the work directory is replaced for each take');
    }
  }
  return settings;
}

function packageEntry(root = defaultKokoroRuntimeDir()) {
  const require = createRequire(path.join(root, 'package.json'));
  return require.resolve(KOKORO_PACKAGE);
}

function packageVersion(entry) {
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate)) {
      const metadata = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (metadata.name === KOKORO_PACKAGE) return metadata.version;
    }
    directory = path.dirname(directory);
  }
  return null;
}

export function kokoroRuntimeStatus(root = defaultKokoroRuntimeDir()) {
  try {
    const expectedLock = path.join(KOKORO_RUNTIME_RESOURCES, 'package-lock.json');
    const runtimeLock = path.join(root, 'package-lock.json');
    const entry = packageEntry(root);
    const version = packageVersion(entry);
    const runtimeRequire = createRequire(path.join(root, 'package.json'));
    const dependencyEntries = [
      entry,
      runtimeRequire.resolve('@huggingface/transformers'),
      runtimeRequire.resolve('phonemizer'),
      runtimeRequire.resolve('onnxruntime-node'),
      runtimeRequire.resolve('onnxruntime-common'),
    ];
    const isolated = dependencyEntries.every((file) => {
      const relative = path.relative(path.resolve(root), path.resolve(file));
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    const lockMatches =
      fs.existsSync(runtimeLock) &&
      digestFile(runtimeLock, 'sha256') === digestFile(expectedLock, 'sha256');
    const sharpMetadata = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules', 'sharp', 'package.json'), 'utf8'),
    );
    const ttsOnlySharpStub =
      sharpMetadata.version === '0.34.5' &&
      sharpMetadata.demoVideoBuilderTtsStub === true;
    const tree = spawnSync('npm', ['ls', '--prefix', root, '--all', '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const treeHealthy = tree.status === 0;
    runtimeRequire(KOKORO_PACKAGE);
    return {
      installed:
        version === KOKORO_PACKAGE_VERSION &&
        isolated &&
        lockMatches &&
        ttsOnlySharpStub &&
        treeHealthy,
      entry,
      version,
      isolated,
      lockMatches,
      ttsOnlySharpStub,
      treeHealthy,
      dependencyFingerprint: digestFile(expectedLock, 'sha256'),
      package: `${KOKORO_PACKAGE}@${KOKORO_PACKAGE_VERSION}`,
      ...(!treeHealthy ? {
        error: 'the locked dependency tree is incomplete or inconsistent',
      } : {}),
    };
  } catch (error) {
    return {
      installed: false,
      entry: null,
      version: null,
      isolated: false,
      lockMatches: false,
      ttsOnlySharpStub: false,
      treeHealthy: false,
      dependencyFingerprint: digestFile(
        path.join(KOKORO_RUNTIME_RESOURCES, 'package-lock.json'),
        'sha256',
      ),
      package: `${KOKORO_PACKAGE}@${KOKORO_PACKAGE_VERSION}`,
      error: error.message,
    };
  }
}

function installTtsOnlySharpStub(root) {
  const directory = path.join(root, 'node_modules', 'sharp');
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    `${JSON.stringify({
      name: 'sharp',
      version: '0.34.5',
      demoVideoBuilderTtsStub: true,
      type: 'module',
      exports: {
        import: './index.mjs',
        require: './index.cjs',
      },
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const source =
    "function unsupportedImagePath() { throw new Error('Image processing is unavailable in the Kokoro TTS-only runtime'); }\n";
  fs.writeFileSync(
    path.join(directory, 'index.mjs'),
    `${source}export default unsupportedImagePath;\n`,
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(directory, 'index.cjs'),
    `${source}module.exports = unsupportedImagePath;\n`,
    { mode: 0o600 },
  );
}

export function setupKokoroRuntime({
  root = defaultKokoroRuntimeDir(),
  npm = 'npm',
} = {}) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const name of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(
      path.join(KOKORO_RUNTIME_RESOURCES, name),
      path.join(root, name),
    );
    fs.chmodSync(path.join(root, name), 0o600);
  }
  const install = spawnSync(npm, [
    'ci',
    '--prefix', root,
    '--no-audit',
    '--no-fund',
  ], { encoding: 'utf8', timeout: 10 * 60_000 });
  if (install.error?.code === 'ETIMEDOUT') {
    throw new Error('Kokoro runtime installation exceeded its safety bound');
  }
  if (install.status !== 0) {
    throw new Error(`Kokoro runtime installation failed:\n${install.stderr || install.stdout}`);
  }
  // Transformers.js imports its optional image processor at module load. Kokoro
  // uses no image path, so replace sharp only inside this dedicated TTS runtime
  // to avoid loading unrelated native libvips code.
  installTtsOnlySharpStub(root);
  const status = kokoroRuntimeStatus(root);
  if (!status.installed) throw new Error('Kokoro runtime was not resolvable after installation');
  return {
    ...status,
    runtimeDir: root,
    modelAndAudioCache: defaultKokoroCacheDir(),
    note:
      'Local installed runtime. Kokoro weights are Apache-2.0; the current phonemizer includes eSpeak-NG and must not be redistributed without GPL review.',
  };
}

export function splitKokoroText(text, maxCharacters = 700) {
  const sentences = String(text)
    .match(/[^.!?]+(?:[.!?]+|$)/g)
    ?.map((entry) => entry.trim())
    .filter(Boolean) ?? [];
  const chunks = [];
  let current = '';
  const append = (value) => {
    if (!value) return;
    if (!current) {
      current = value;
    } else if (current.length + value.length + 1 <= maxCharacters) {
      current = `${current} ${value}`;
    } else {
      chunks.push(current);
      current = value;
    }
  };
  for (const sentence of sentences) {
    if (sentence.length <= maxCharacters) {
      append(sentence);
      continue;
    }
    for (const rawWord of sentence.split(/\s+/)) {
      let word = rawWord;
      while (word.length > maxCharacters) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        chunks.push(word.slice(0, maxCharacters));
        word = word.slice(maxCharacters);
      }
      if (!word) continue;
      if (current && current.length + word.length + 1 > maxCharacters) {
        chunks.push(current);
        current = '';
      }
      append(word);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function concatWaveFiles(ffmpeg, inputs, output) {
  const args = ['-v', 'error', '-y'];
  for (const input of inputs) args.push('-i', input);
  if (inputs.length === 1) {
    args.push('-map', '0:a:0');
  } else {
    const labels = inputs.map((_, index) => `[${index}:a]`).join('');
    args.push(
      '-filter_complex', `${labels}concat=n=${inputs.length}:v=0:a=1[a]`,
      '-map', '[a]',
    );
  }
  args.push('-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', output);
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8', timeout: 5 * 60_000 });
  if (result.error?.code === 'ETIMEDOUT') throw new Error('Kokoro audio assembly timed out');
  if (result.status !== 0) throw new Error(`Kokoro audio assembly failed:\n${result.stderr}`);
}

function digestFile(file, algorithm) {
  const hash = crypto.createHash(algorithm === 'git-sha1' ? 'sha1' : algorithm);
  if (algorithm === 'git-sha1') {
    hash.update(`blob ${fs.statSync(file).size}\0`);
  }
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes;
    do {
      bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function validModelFile(file, expected) {
  return (
    fs.existsSync(file) &&
    fs.statSync(file).size === expected.bytes &&
    digestFile(file, expected.algorithm) === expected.digest
  );
}

export function kokoroModelStatus(settings) {
  const model = MODEL_FILES[settings.dtype];
  if (!model) throw new Error(`No pinned Kokoro asset is available for ${settings.dtype}`);
  const expectedFiles = [...MODEL_SUPPORT_FILES, model];
  const root = path.join(settings.cacheDir, 'models', KOKORO_MODEL);
  const missing = expectedFiles.filter(
    (expected) => !validModelFile(path.join(root, expected.file), expected),
  );
  return {
    root,
    installed: missing.length === 0,
    missing: missing.map((entry) => entry.file),
    verified: expectedFiles.length - missing.length,
    expected: expectedFiles.length,
  };
}

export function ensureKokoroModel(settings, { curl = 'curl' } = {}) {
  const model = MODEL_FILES[settings.dtype];
  if (!model) throw new Error(`No pinned Kokoro asset is available for ${settings.dtype}`);
  const expectedFiles = [...MODEL_SUPPORT_FILES, model];
  const status = kokoroModelStatus(settings);
  const { root } = status;
  const missing = expectedFiles.filter((entry) => status.missing.includes(entry.file));
  if (!missing.length) return { root, downloaded: [], verified: expectedFiles.length };
  if (!settings.allowModelDownload) {
    throw new Error(
      `Kokoro model cache is incomplete for ${settings.dtype}, and allowModelDownload is false`,
    );
  }
  const downloaded = [];
  for (const expected of missing) {
    const destination = path.join(root, expected.file);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
    const url =
      `https://huggingface.co/${KOKORO_MODEL}/resolve/` +
      `${KOKORO_MODEL_REVISION}/${expected.file}`;
    const result = spawnSync(curl, [
      '--fail',
      '--location',
      '--retry', '3',
      '--show-error',
      '--silent',
      '--output', temporary,
      url,
    ], { encoding: 'utf8', timeout: 10 * 60_000 });
    if (result.error?.code === 'ETIMEDOUT') {
      fs.rmSync(temporary, { force: true });
      throw new Error(`Kokoro model download timed out: ${expected.file}`);
    }
    if (result.status !== 0 || !validModelFile(temporary, expected)) {
      fs.rmSync(temporary, { force: true });
      throw new Error(
        `Kokoro model download failed integrity validation for ${expected.file}` +
        (result.stderr ? `:\n${result.stderr}` : ''),
      );
    }
    fs.renameSync(temporary, destination);
    downloaded.push(expected.file);
  }
  return { root, downloaded, verified: expectedFiles.length };
}

const providers = new Map();

async function loadProvider(settings, ffmpeg) {
  const key = JSON.stringify([
    settings.cacheDir,
    settings.model,
    settings.dtype,
    settings.device,
    settings.allowModelDownload,
    settings.voice,
    settings.speed,
  ]);
  if (!providers.has(key)) {
    providers.set(key, (async () => {
      let status = kokoroRuntimeStatus();
      if (!status.installed) {
        setupKokoroRuntime();
        status = kokoroRuntimeStatus();
      }
      ensureKokoroModel(settings);
      const runtimeRequire = createRequire(
        path.join(defaultKokoroRuntimeDir(), 'package.json'),
      );
      const transformers = runtimeRequire('@huggingface/transformers');
      transformers.env.cacheDir = path.join(settings.cacheDir, 'models');
      transformers.env.allowLocalModels = true;
      transformers.env.allowRemoteModels = false;
      transformers.env.useFSCache = true;
      const module = await import(pathToFileURL(status.entry).href);
      const tts = await module.KokoroTTS.from_pretrained(settings.model, {
        dtype: settings.dtype,
        device: settings.device,
      });
      return {
        async generateScene(text, output) {
          const chunks = splitKokoroText(text);
          if (!chunks.length) throw new Error('Cannot synthesize empty Kokoro narration');
          const temporary = fs.mkdtempSync(
            path.join(path.dirname(output), `.kokoro-${process.pid}-`),
          );
          try {
            const files = [];
            for (const [index, chunk] of chunks.entries()) {
              const file = path.join(temporary, `${index}.wav`);
              const audio = await tts.generate(chunk, {
                voice: settings.voice,
                speed: settings.speed,
              });
              await audio.save(file);
              files.push(file);
            }
            concatWaveFiles(ffmpeg, files, output);
          } finally {
            fs.rmSync(temporary, { recursive: true, force: true });
          }
        },
      };
    })());
  }
  try {
    return await providers.get(key);
  } catch (error) {
    providers.delete(key);
    throw error;
  }
}

export function kokoroAudioCacheKey(text, settings) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      text,
      package: `${KOKORO_PACKAGE}@${settings.packageVersion}`,
      dependencies: digestFile(
        path.join(KOKORO_RUNTIME_RESOURCES, 'package-lock.json'),
        'sha256',
      ),
      audioFormatVersion: 1,
      model: settings.model,
      modelRevision: KOKORO_MODEL_REVISION,
      voice: settings.voice,
      speed: settings.speed,
      dtype: settings.dtype,
      device: settings.device,
    }))
    .digest('hex');
}

export async function prepareKokoroScene({
  text,
  output,
  settings,
  ffmpeg,
  provider,
}) {
  const key = kokoroAudioCacheKey(text, settings);
  const cacheDirectory = path.join(settings.cacheDir, 'audio');
  const cached = path.join(cacheDirectory, `${key}.wav`);
  fs.mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  let cacheHit = fs.existsSync(cached);
  if (!cacheHit) {
    const temporary = `${cached}.tmp-${process.pid}-${Date.now()}.wav`;
    const activeProvider = provider ?? await loadProvider(settings, ffmpeg);
    try {
      await activeProvider.generateScene(text, temporary);
      if (!fs.existsSync(temporary) || fs.statSync(temporary).size === 0) {
        throw new Error('Kokoro generated an empty narration clip');
      }
      fs.renameSync(temporary, cached);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    cacheHit = false;
  }
  fs.copyFileSync(cached, output);
  return { output, cached, cacheHit, key };
}
