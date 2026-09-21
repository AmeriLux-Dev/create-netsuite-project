import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultPrefixForProjectName, toKebabCase, toPascalCase, toTitleCase } from '../naming.js';
import { isInteractiveTerminal, promptConfirm, promptSelect, promptText, ui } from '../prompts.js';
import { initializeGitRepository, readGitUserName } from '../steps/git.js';
import { addJobSupport, installDependencies } from '../steps/install.js';
import { DEFAULT_TEMPLATE_REF, DEFAULT_TEMPLATE_REPOSITORY, downloadTemplate } from '../template/fetch.js';
import { renderTemplateDirectory, type RenderContext } from '../template/render.js';
import {
    isProjectType,
    isValidNpmPackageName,
    PROJECT_TYPES,
    validatePrefix,
    validateProjectName,
    type ProjectType,
} from '../validation.js';

/** `.netsuite-project.json`: written by the scaffold; records the template, its ref, the prefix and the chosen features. */
const PROJECT_CONFIG_FILE_NAME = '.netsuite-project.json';

export interface CreateCommandOptions {
    directory?: string;
    name?: string;
    prefix?: string;
    author?: string;
    description?: string;
    performanceTracker?: boolean;
    probity?: boolean;
    jobs?: boolean;
    install?: boolean;
    git?: boolean;
    yes?: boolean;
    ref?: string;
    repo?: string;
    localTemplate?: string;
    projectType?: string;
    /** Option names the user set explicitly (commander's `cli` source), so a default is not mistaken for an answer. */
    explicitOptions?: Set<string>;
}

export interface CreateAnswers {
    projectName: string;
    targetDir: string;
    prefix: string;
    author: string;
    description: string;
    performanceTracker: boolean;
    probity: boolean;
    /** True when the project starts with the job run machinery; `npm run add:jobs` adds it later otherwise. */
    jobs: boolean;
    projectType: ProjectType;
    install: boolean;
    git: boolean;
}

export class CreateCommandError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CreateCommandError';
    }
}

export const DEFAULT_DESCRIPTION = 'A Suitelet-hosted NetSuite application.';

export async function resolveCreateAnswers(options: CreateCommandOptions): Promise<CreateAnswers> {
    const explicit = options.explicitOptions ?? new Set<string>();
    const interactive = !options.yes && isInteractiveTerminal();
    if (!options.yes && !interactive) {
        ui.warn('Not an interactive terminal; taking defaults for every unanswered prompt (same as --yes).');
    }

    const projectNameFromDirectory = options.directory ? path.basename(path.resolve(options.directory)) : undefined;
    let projectName = options.name ?? projectNameFromDirectory;
    if (projectName === undefined) {
        if (!interactive) throw new CreateCommandError('A project name is required: pass a directory or --name.');
        projectName = await promptText({
            message: 'Project name',
            placeholder: 'MyApp',
            validate: validateProjectName,
        });
    }
    const projectNameProblem = validateProjectName(projectName);
    if (projectNameProblem) throw new CreateCommandError(projectNameProblem);
    if (!isValidNpmPackageName(toKebabCase(projectName))) {
        throw new CreateCommandError(`"${projectName}" does not convert to a valid npm package name.`);
    }

    const targetDir = path.resolve(options.directory ?? projectName);
    if (existsSync(path.join(targetDir, 'package.json'))) {
        throw new CreateCommandError(`${targetDir} already has a package.json; refusing to scaffold over an existing project.`);
    }

    let prefix = options.prefix;
    if (prefix === undefined) {
        const suggested = defaultPrefixForProjectName(projectName);
        prefix = interactive
            ? await promptText({
                message: 'Script id prefix (customscript_<prefix>_…)',
                initialValue: suggested,
                validate: validatePrefix,
            })
            : suggested;
    }
    const prefixProblem = validatePrefix(prefix);
    if (prefixProblem) throw new CreateCommandError(prefixProblem);

    let author = options.author;
    if (author === undefined) {
        const gitUserName = await readGitUserName();
        author = interactive
            ? await promptText({ message: 'Author or team', initialValue: gitUserName ?? '', placeholder: 'Your team' })
            : (gitUserName ?? '');
    }

    let description = options.description;
    if (description === undefined) {
        description = interactive
            ? await promptText({ message: 'One-line description', initialValue: DEFAULT_DESCRIPTION })
            : DEFAULT_DESCRIPTION;
    }

    let performanceTracker = options.performanceTracker;
    if (performanceTracker === undefined || (!explicit.has('performanceTracker') && interactive)) {
        performanceTracker = interactive
            ? await promptConfirm('Enable PerformanceTracker telemetry (netsuite-wrapper spans)?', false)
            : false;
    }

    let probity = options.probity;
    if (probity === undefined || (!explicit.has('probity') && interactive)) {
        probity = interactive
            ? await promptConfirm('Add Probity guardrails for AI coding agents (Claude Code hook)?', false)
            : false;
    }

    let jobs = options.jobs;
    if (jobs === undefined || (!explicit.has('jobs') && interactive)) {
        jobs = interactive
            ? await promptConfirm('Will this project have Map/Reduce jobs (background work a page can follow)?', false)
            : false;
    }

    let projectType: ProjectType = 'react-app';
    if (options.projectType !== undefined) {
        if (!isProjectType(options.projectType)) {
            throw new CreateCommandError(`Unknown project type "${options.projectType}". Known types: ${PROJECT_TYPES.join(', ')}.`);
        }
        projectType = options.projectType;
    } else if (interactive && PROJECT_TYPES.length > 1) {
        projectType = await promptSelect('Project type', PROJECT_TYPES.map((type) => ({ value: type, label: type })), 'react-app');
    }

    const install = explicit.has('install') || !interactive
        ? (options.install ?? true)
        : await promptConfirm('Run npm install now?', true);

    const git = explicit.has('git') || !interactive
        ? (options.git ?? true)
        : await promptConfirm('Initialise a git repository and make the first commit?', true);

    return { projectName, targetDir, prefix, author, description, performanceTracker, probity, jobs, projectType, install, git };
}

export function buildRenderContext(answers: CreateAnswers, templateRef: string, cliVersion: string): RenderContext {
    const appName = toPascalCase(answers.projectName);
    return {
        tokens: {
            appName,
            appNameKebab: toKebabCase(answers.projectName),
            appTitle: toTitleCase(answers.projectName),
            prefix: answers.prefix,
            author: answers.author,
            description: answers.description,
            cliVersion,
            year: String(new Date().getFullYear()),
            templateRef,
            projectType: answers.projectType,
            // JSON literals for .netsuite-project.json, where a token sits outside a string.
            performanceTrackerJson: String(answers.performanceTracker),
            probityJson: String(answers.probity),
        },
        flags: {
            performanceTracker: answers.performanceTracker,
            probity: answers.probity,
        },
    };
}

async function acquireTemplate(options: CreateCommandOptions, projectType: ProjectType): Promise<{ templateDir: string; templateRef: string; cleanup: () => Promise<void> }> {
    if (options.localTemplate) {
        const templateDir = path.resolve(options.localTemplate);
        if (!existsSync(path.join(templateDir, 'package.json'))) {
            throw new CreateCommandError(`--local-template ${templateDir} does not look like a template (no package.json).`);
        }
        return { templateDir, templateRef: `local:${templateDir.replace(/\\/g, '/')}`, cleanup: async () => undefined };
    }

    const repository = options.repo ?? DEFAULT_TEMPLATE_REPOSITORY;
    const ref = options.ref ?? DEFAULT_TEMPLATE_REF;
    const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-netsuite-project-template-'));
    const templateDir = path.join(scratchDir, projectType);
    ui.step(`Downloading template ${projectType} from ${repository}@${ref}`);
    try {
        await downloadTemplate({ repository, ref, projectType, destinationDir: templateDir });
    } catch (error) {
        await fs.rm(scratchDir, { recursive: true, force: true });
        throw error;
    }
    return { templateDir, templateRef: `${repository}@${ref}`, cleanup: () => fs.rm(scratchDir, { recursive: true, force: true }) };
}

export async function runCreate(options: CreateCommandOptions, cliVersion: string): Promise<void> {
    ui.intro(`create-netsuite-project v${cliVersion}`);
    const answers = await resolveCreateAnswers(options);
    const appName = toPascalCase(answers.projectName);

    const template = await acquireTemplate(options, answers.projectType);
    try {
        const context = buildRenderContext(answers, template.templateRef, cliVersion);

        if (existsSync(answers.targetDir)) {
            const existing = await fs.readdir(answers.targetDir);
            if (existing.length > 0) {
                ui.info(`${answers.targetDir} already has ${existing.length} entr${existing.length === 1 ? 'y' : 'ies'}; merging the template around ${existing.join(', ')}.`);
            }
        }

        ui.step(`Writing ${appName} to ${answers.targetDir}`);
        const written = await renderTemplateDirectory(template.templateDir, answers.targetDir, context);
        await fs.mkdir(path.join(answers.targetDir, 'netsuite', 'FileCabinet', 'SuiteScripts', appName), { recursive: true });
        ui.success(`Wrote ${written.length} files (${PROJECT_CONFIG_FILE_NAME} records the template and prefix).`);
    } finally {
        await template.cleanup();
    }

    let installed = false;
    if (answers.install) {
        ui.step('Installing dependencies (npm install)');
        const result = await installDependencies(answers.targetDir);
        installed = result.ok;
        if (!result.ok) ui.warn(`npm install failed. Run \`${result.manualCommand}\` in ${answers.targetDir}.`);
    }

    if (answers.jobs) {
        ui.step('Setting up jobs (npm run add:jobs)');
        const result = await addJobSupport(answers.targetDir);
        if (result.ok) ui.success('Jobs are set up: the run record, the daily cleanup script, and the endpoint a page follows a run with.');
        else ui.warn(`Job setup failed. Run \`${result.manualCommand}\` in ${answers.targetDir}.`);
    }

    if (answers.git) {
        const result = await initializeGitRepository(answers.targetDir, `chore: scaffold ${appName} with create-netsuite-project ${cliVersion}`);
        if (result.status === 'committed') ui.success('Initialised git repository with the first commit.');
        else if (result.status === 'skipped-existing') ui.info('Existing git repository found; left as is.');
        else if (result.status === 'skipped-no-git') ui.warn('git is not installed; skipped repository setup.');
        else ui.warn(`git setup failed: ${result.detail}`);
    }

    const relativeDir = path.relative(process.cwd(), answers.targetDir) || '.';
    const displayDir = relativeDir.startsWith('..') ? answers.targetDir : relativeDir;
    const nextSteps = [
        `cd ${displayDir}`,
        ...(installed ? [] : ['npm install']),
        'cp client/.env.example client/.env   # then fill in the sandbox OAuth 2.0 values',
        'npm run dev                          # Vite + local restlet proxy',
        '',
        'The user controller and its page are the starting point; how-to-use/ lays out the',
        'folders and writes a repository, a controller and a job end to end.',
        '',
        'npx suitecloud account:setup         # once per account, writes the gitignored project.json',
        'npm run deploy                       # build, then suitecloud project:deploy',
        `The Suitelet then appears under Customization › Scripting › Scripts as "${toTitleCase(answers.projectName)} Home"`,
    ];
    ui.note(nextSteps.join('\n'), 'Next steps');
    ui.outro(`${appName} is ready.`);
}
