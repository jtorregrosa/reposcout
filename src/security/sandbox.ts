import type { RepoConfig } from '../config/config.js';

// Claude Code sandboxes Bash on macOS and on Linux, WSL2 included (it reports linux). Native Windows has no sandbox.
export function sandboxSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin' || platform === 'linux';
}

export interface Verification {
  // The test command the verifier may run, or null when verification is off for the repository.
  testCommand: string | null;
  sandboxed: boolean;
  // Why a configured test_command is not used, or that it runs unsandboxed; null when there is nothing to say.
  warning: string | null;
}

// The verifier writes the test it runs, so test_command is arbitrary code execution. Without a sandbox it would run
// with the user's rights and network, which only an explicit opt-in in repos.yaml may allow.
export function verificationFor(
  repo: Pick<RepoConfig, 'name' | 'test_command' | 'test_command_unsandboxed'>,
  platform: NodeJS.Platform = process.platform,
): Verification {
  if (!repo.test_command) return { testCommand: null, sandboxed: false, warning: null };
  if (sandboxSupported(platform)) return { testCommand: repo.test_command, sandboxed: true, warning: null };
  if (repo.test_command_unsandboxed) {
    return {
      testCommand: repo.test_command,
      sandboxed: false,
      warning: `test_command runs without a sandbox on ${platform}, with your rights and network (test_command_unsandboxed: true)`,
    };
  }
  return {
    testCommand: null,
    sandboxed: false,
    warning: `verification disabled: Claude Code has no sandbox on ${platform}, so test_command is ignored. Set test_command_unsandboxed: true to run it with your rights and network anyway.`,
  };
}

// Why a validation pass skips a repository, or null when the repository can run its tests here.
export function verificationOffReason(
  repo: Pick<RepoConfig, 'name' | 'test_command' | 'test_command_unsandboxed'>,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const state = verificationState(repo, platform);
  if (state === 'on') return null;
  return state === 'no-test-command'
    ? 'verification off: no test_command configured'
    : `verification off: Claude Code has no sandbox on ${platform}; set test_command_unsandboxed: true to run test_command anyway`;
}

// What the dashboard says about verification for a repository on this platform.
export function verificationState(
  repo: Pick<RepoConfig, 'name' | 'test_command' | 'test_command_unsandboxed'>,
  platform: NodeJS.Platform = process.platform,
): 'on' | 'no-test-command' | 'no-sandbox' {
  if (!repo.test_command) return 'no-test-command';
  return verificationFor(repo, platform).testCommand ? 'on' : 'no-sandbox';
}
