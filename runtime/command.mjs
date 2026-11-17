import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

function needsWindowsShell(command) {
  return process.platform === 'win32' && path.win32.extname(command).toLowerCase() !== '.exe';
}

function quoteCmd(value) {
  if (value.length === 0) return '""';
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${String(value).replace(/"/g, '""')}"`;
}

function launch(command, args, options) {
  if (!needsWindowsShell(command)) {
    return { command, args, options: { windowsHide: true, ...options } };
  }
  const commandLine = [command, ...args].map((arg) => quoteCmd(String(arg))).join(' ');
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', commandLine],
    options: {
      windowsHide: true,
      ...options,
      shell: false,
      windowsVerbatimArguments: true,
    },
  };
}

export function spawnCommand(command, args = [], options = {}) {
  const launched = launch(command, args, options);
  return spawn(launched.command, launched.args, launched.options);
}

export function spawnCommandSync(command, args = [], options = {}) {
  const launched = launch(command, args, options);
  return spawnSync(launched.command, launched.args, launched.options);
}
