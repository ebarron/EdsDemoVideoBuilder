import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const LOAD_WITH_ALTERED_SEARCH_PATH = 0x00000008;
let prepared = false;

export function prepareWindowsOnnxRuntime(runtimeRequire) {
  if (process.platform !== 'win32' || prepared) return;
  const entry = runtimeRequire.resolve('onnxruntime-node');
  const bin = path.resolve(
    path.dirname(entry),
    '..',
    'bin',
    'napi-v3',
    'win32',
    process.arch,
  );
  const koffi = require('koffi');
  const kernel32 = koffi.load('kernel32.dll');
  const loadLibraryEx = kernel32.func('void* __stdcall LoadLibraryExW(str16, void*, uint32)');
  const getLastError = kernel32.func('uint32 __stdcall GetLastError()');
  for (const name of ['DirectML.dll', 'onnxruntime.dll']) {
    const file = path.join(bin, name);
    if (!fs.existsSync(file)) continue;
    const handle = loadLibraryEx(file, null, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!handle) {
      throw new Error(
        `Unable to load ${file} (Windows error ${getLastError()}). ` +
        'Windows is loading a different ONNX Runtime DLL.',
      );
    }
  }
  prepared = true;
}
