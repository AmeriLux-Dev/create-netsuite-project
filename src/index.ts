import { Command } from 'commander';
import { runCreate, type CreateCommandOptions } from './commands/create.js';
import { PromptCancelledError, ui } from './prompts.js';
import { DEFAULT_TEMPLATE_REF, DEFAULT_TEMPLATE_REPOSITORY } from './template/fetch.js';
import { PROJECT_TYPES } from './validation.js';

const cliVersion = __CLI_VERSION__;

const program = new Command();

program
    .name('create-netsuite-project')
    .description('Scaffold a Suitelet-hosted React application for NetSuite.')
    .version(cliVersion, '-v, --version');

const createCommand = program
    .command('create', { isDefault: true })
    .description('Create a new project (default command).')
    .argument('[directory]', 'Folder to create; its base name is the project name unless --name is given.')
    .option('--name <name>', 'Project name (PascalCase or kebab-case, 2-40 characters).')
    .option('--prefix <prefix>', 'Script id prefix: 2-10 lowercase letters or digits.')
    .option('--author <author>', 'Author or owning team, written to package.json and the README owners table.')
    .option('--description <text>', 'One-line project description.')
    .option('--performance-tracker', 'Enable PerformanceTracker telemetry through netsuite-wrapper.')
    .option('--no-performance-tracker', 'Disable telemetry (the default).')
    .option('--probity', 'Add Probity guardrails for AI coding agents (probity.config.ts + Claude Code hook).')
    .option('--no-probity', 'Skip Probity (the default).')
    .option('--netsuite-api', 'Build controllers on @amerilux/netsuite-api: typed endpoints and a generated client (default).')
    .option('--no-netsuite-api', 'Leave @amerilux/netsuite-api out: the controller and client folders are there, their code is yours.')
    .option('--netsuite-repository', 'Build data access on @amerilux/netsuite-repository: models and a generated query context (default).')
    .option('--no-netsuite-repository', 'Leave @amerilux/netsuite-repository out: the repository folder is there, its code is yours.')
    .option('--jobs', 'Set up Map/Reduce jobs: the run record, the cleanup script and the endpoint a page polls (needs netsuite-api).')
    .option('--no-jobs', 'Skip the job setup (the default; `npm run add:jobs` adds it later).')
    .option('--install', 'Run npm install after scaffolding (default).')
    .option('--no-install', 'Skip npm install.')
    .option('--git', 'Initialise a git repository with a first commit (default).')
    .option('--no-git', 'Skip git.')
    .option('-y, --yes', 'Accept every default instead of prompting.')
    .option('--ref <gitref>', `Template git ref to download (default: ${DEFAULT_TEMPLATE_REF}).`)
    .option('--repo <owner/repo>', `GitHub repository holding the templates (default: ${DEFAULT_TEMPLATE_REPOSITORY}).`)
    .option('--local-template <path>', 'Scaffold from a template folder on disk instead of downloading.')
    .option('--project-type <type>', `Template flavour: ${PROJECT_TYPES.join(', ')}.`)
    .action(async (directory: string | undefined, rawOptions: Record<string, unknown>) => {
        const explicitOptions = new Set<string>();
        for (const option of createCommand.options) {
            const key = option.attributeName();
            if (createCommand.getOptionValueSource(key) === 'cli') explicitOptions.add(key);
        }
        const options: CreateCommandOptions = { ...(rawOptions as CreateCommandOptions), directory, explicitOptions };
        await runCreate(options, cliVersion);
    });

program.parseAsync(process.argv).catch((error: unknown) => {
    if (error instanceof PromptCancelledError) {
        ui.cancel('Cancelled. Nothing was written.');
        process.exit(130);
    }
    const message = error instanceof Error ? error.message : String(error);
    ui.error(message);
    process.exit(1);
});
