import { runCommand } from '../util/run.js';

export interface InstallResult {
    ok: boolean;
    manualCommand: string;
}

/** `npm install` with output streamed to the terminal; a failure is reported, never thrown. */
export async function installDependencies(projectDir: string): Promise<InstallResult> {
    const result = await runCommand('npm', ['install'], { cwd: projectDir, stdio: 'inherit' });
    return { ok: result.code === 0, manualCommand: 'npm install' };
}

/**
 * `npm run add:jobs` in the new project: the record a job run lives in, the cleanup script that clears
 * old runs, the endpoint a page polls a run with and the hook that polls it. The script needs no
 * dependencies, so it works whether or not npm install ran, and it adds nothing that is already there.
 */
export async function addJobSupport(projectDir: string): Promise<InstallResult> {
    const result = await runCommand('npm', ['run', 'add:jobs'], { cwd: projectDir, stdio: 'inherit' });
    return { ok: result.code === 0, manualCommand: 'npm run add:jobs' };
}
