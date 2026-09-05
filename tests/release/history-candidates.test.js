import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { candidateHistoryFiles, scanText } from '../../tools/release/security-check.mjs';

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'cavalry-history-test-'));
  directories.push(directory);
  const runGit = (command, args) => spawnSync(command, args, { cwd: directory, encoding: 'utf8' });
  const git = (...args) => {
    const result = runGit('git', args);
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  const commit = (message) =>
    git(
      '-c',
      'user.name=Cavalry Test',
      '-c',
      'user.email=cavalry@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      message
    );
  git('init', '--quiet');
  return { directory, runGit, git, commit };
}

describe('Git history candidate enumeration', () => {
  it('batches repeated blobs while retaining every path-specific review boundary', () => {
    const { directory, runGit, git, commit } = createRepository();
    const allowedPath = 'apps/desktop/tests/host/in-app-advisor-ipc.test.js';
    const unusualPath = 'src/copy with space\nand unicode-é.js';
    const paths = [
      allowedPath,
      unusualPath,
      ...Array.from({ length: 64 }, (_, i) => `src/copy-${i}.js`)
    ];
    const fixtureToken = ['sk', 'voice', 'with', 'local', 'chat'].join('-');
    const contents = `const apiKey = "${fixtureToken}";\n`;
    for (const path of paths) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), contents);
    }
    git('add', '.');
    commit('Initial fixtures');
    const firstCommit = git('rev-parse', 'HEAD');
    git('rm', '--quiet', '--', unusualPath);
    commit('Remove one fixture');
    const secondCommit = git('rev-parse', 'HEAD');
    let resolutionCalls = 0;
    const candidates = candidateHistoryFiles([secondCommit, firstCommit], (command, args) => {
      if (args[0] === 'rev-parse') resolutionCalls += 1;
      return runGit(command, args);
    });

    expect(resolutionCalls).toBeLessThan(5);
    expect(candidates.size).toBe(1);
    const [[objectId, candidatePaths]] = [...candidates];
    expect(git('cat-file', 'blob', objectId)).toBe(contents.trim());
    expect([...candidatePaths.keys()].sort()).toEqual([...paths].sort());
    expect(candidatePaths.get(unusualPath)).toBe(firstCommit);
    expect(candidatePaths.get(allowedPath)).toBe(secondCommit);
    expect(scanText(allowedPath, contents)).toEqual([]);
    expect(scanText(unusualPath, contents)).toContainEqual(
      expect.objectContaining({ rule: 'OpenAI secret key', path: unusualPath })
    );
  });

  it('fails closed if candidate object resolution fails', () => {
    const revision = 'a'.repeat(40);
    expect(() =>
      candidateHistoryFiles([revision], (_command, args) =>
        args[0] === 'grep'
          ? { status: 0, stdout: `${revision}:src/example.js\0`, stderr: '' }
          : { status: 1, stdout: '', stderr: 'missing object' }
      )
    ).toThrow('could not resolve Git history candidate objects');
  });
});
