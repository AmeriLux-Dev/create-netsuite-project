import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * The template language: `{{token}}` substitution, `{{#if flag}}…{{/if}}` and
 * `{{#unless flag}}…{{/unless}}` blocks (nesting allowed), tokens in file names, and a rename
 * map for files npm would otherwise strip from a published package.
 */

export interface RenderContext {
    tokens: Record<string, string>;
    flags: Record<string, boolean>;
}

export const RENAMED_FILES: Record<string, string> = {
    _gitignore: '.gitignore',
    _npmrc: '.npmrc',
};

export const SUBSTITUTED_EXTENSIONS = new Set([
    '.ts', '.tsx', '.mts', '.cts', '.js', '.cjs', '.mjs', '.json', '.html', '.xml', '.md', '.css',
    '.yml', '.yaml', '.txt', '.example', '.code-snippets',
]);

export const SUBSTITUTED_FILE_NAMES = new Set(['_gitignore', '_npmrc', '.env.example', '.gitignore', '.npmrc']);

export class TemplateRenderError extends Error {
    constructor(message: string, readonly file: string) {
        super(`${file}: ${message}`);
        this.name = 'TemplateRenderError';
    }
}

const OPEN_TAG_PATTERN = /\{\{#(if|unless)\s+([A-Za-z0-9_]+)\}\}/g;
const TOKEN_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g;
const LEFTOVER_PATTERN = /\{\{/;

interface BlockSpan {
    kind: 'if' | 'unless';
    flag: string;
    openStart: number;
    bodyStart: number;
    bodyEnd: number;
    closeEnd: number;
}

/** Finds the close tag matching the open tag at `open`, skipping nested blocks of the same kind. */
function findBlockSpan(source: string, open: RegExpExecArray, fileLabel: string): BlockSpan {
    const kind = open[1] as 'if' | 'unless';
    const flag = open[2];
    const closeTag = `{{/${kind}}}`;
    const sameKindOpen = new RegExp(`\\{\\{#${kind}\\s+[A-Za-z0-9_]+\\}\\}`, 'g');
    let depth = 1;
    let cursor = open.index + open[0].length;
    for (;;) {
        const nextClose = source.indexOf(closeTag, cursor);
        if (nextClose === -1) {
            throw new TemplateRenderError(`unclosed {{#${kind} ${flag}}}`, fileLabel);
        }
        sameKindOpen.lastIndex = cursor;
        const nextOpen = sameKindOpen.exec(source);
        if (nextOpen && nextOpen.index < nextClose) {
            depth += 1;
            cursor = nextOpen.index + nextOpen[0].length;
            continue;
        }
        depth -= 1;
        cursor = nextClose + closeTag.length;
        if (depth === 0) {
            return { kind, flag, openStart: open.index, bodyStart: open.index + open[0].length, bodyEnd: nextClose, closeEnd: cursor };
        }
    }
}

/** Length of the whitespace-only run from `position` back to the start of its line, or -1 when the line has other text. */
function lineIndentBefore(source: string, position: number): number {
    let start = position;
    while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start -= 1;
    return start === 0 || source[start - 1] === '\n' ? position - start : -1;
}

/** Length of optional spaces plus the line break following `position`, or -1 when other text follows on the line. */
function lineEndAfter(source: string, position: number): number {
    const match = /^[ \t]*(\r?\n|$)/.exec(source.slice(position));
    return match ? match[0].length : -1;
}

/**
 * Evaluates every block, innermost included. A block whose tags stand alone on their lines
 * disappears with those lines; an inline block leaves the surrounding text untouched.
 */
function renderBlocks(source: string, context: RenderContext, fileLabel: string): string {
    let output = '';
    let index = 0;
    for (;;) {
        OPEN_TAG_PATTERN.lastIndex = index;
        const open = OPEN_TAG_PATTERN.exec(source);
        if (!open) {
            output += source.slice(index);
            return output;
        }
        const span = findBlockSpan(source, open, fileLabel);
        if (!(span.flag in context.flags)) {
            throw new TemplateRenderError(`unknown flag "${span.flag}" in {{#${span.kind}}} block`, fileLabel);
        }
        const keep = span.kind === 'if' ? context.flags[span.flag] : !context.flags[span.flag];

        const openIndent = lineIndentBefore(source, span.openStart);
        const openLineEnd = lineEndAfter(source, span.bodyStart);
        const openStandalone = openIndent >= 0 && openLineEnd >= 0;
        const closeIndent = lineIndentBefore(source, span.bodyEnd);
        const closeLineEnd = lineEndAfter(source, span.closeEnd);
        const closeStandalone = closeIndent >= 0 && closeLineEnd >= 0;

        const textBefore = source.slice(index, openStandalone ? span.openStart - openIndent : span.openStart);
        const bodyStart = openStandalone ? span.bodyStart + openLineEnd : span.bodyStart;
        const bodyEnd = closeStandalone ? span.bodyEnd - closeIndent : span.bodyEnd;
        const body = bodyStart <= bodyEnd ? source.slice(bodyStart, bodyEnd) : '';

        output += textBefore;
        if (keep) output += renderBlocks(body, context, fileLabel);
        index = closeStandalone ? span.closeEnd + closeLineEnd : span.closeEnd;
    }
}

export function isSubstitutedFile(fileName: string): boolean {
    if (SUBSTITUTED_FILE_NAMES.has(fileName)) return true;
    return SUBSTITUTED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/** Inside a JSON document a token value must be a valid string body: quotes, backslashes and control characters escaped. */
function escapeTokenValueForJson(value: string): string {
    return JSON.stringify(value).slice(1, -1);
}

export function renderTemplateString(source: string, context: RenderContext, fileLabel = '<string>'): string {
    const jsonContext = fileLabel.toLowerCase().endsWith('.json');
    const withBlocks = renderBlocks(source, context, fileLabel);

    const withTokens = withBlocks.replace(TOKEN_PATTERN, (_match, token: string) => {
        const value = context.tokens[token];
        if (value === undefined) {
            throw new TemplateRenderError(`unknown token "{{${token}}}"`, fileLabel);
        }
        return jsonContext ? escapeTokenValueForJson(value) : value;
    });

    if (LEFTOVER_PATTERN.test(withTokens)) {
        const line = withTokens.split(/\r?\n/).findIndex((text) => text.includes('{{')) + 1;
        throw new TemplateRenderError(`unrendered "{{" left on line ${line}`, fileLabel);
    }
    return withTokens;
}

export function renderTemplateFileName(fileName: string, context: RenderContext): string {
    const renamed = RENAMED_FILES[fileName] ?? fileName;
    return renamed.replace(TOKEN_PATTERN, (_match, token: string) => {
        const value = context.tokens[token];
        if (value === undefined) {
            throw new TemplateRenderError(`unknown token "{{${token}}}" in file name`, fileName);
        }
        return value;
    });
}

export interface RenderDirectoryOptions {
    /** Directory names never copied from the template (defaults to node_modules). */
    skipDirectories?: Set<string>;
}

/**
 * Optional `template.json` at the template root. It is never copied to the project.
 * `conditionalPaths` maps a template-relative POSIX path (file or directory) to the flag
 * that must be true for it to be emitted; prefix the flag with `!` to require false.
 * `derivedFlags` names a flag the template computes from the CLI's own: `{ "all": [...] }` is
 * true when every listed flag is, `{ "any": [...] }` when at least one is. A derived flag works
 * wherever a CLI flag does (blocks and conditionalPaths), so the template, not the CLI, decides
 * how its features combine.
 */
export const TEMPLATE_MANIFEST_FILE = 'template.json';

export type DerivedFlagRule = { all: string[] } | { any: string[] };

export interface TemplateManifest {
    conditionalPaths?: Record<string, string>;
    derivedFlags?: Record<string, DerivedFlagRule>;
}

async function readTemplateManifest(sourceDir: string): Promise<TemplateManifest> {
    const manifestPath = path.join(sourceDir, TEMPLATE_MANIFEST_FILE);
    let raw: string;
    try {
        raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
        return {};
    }
    const manifest = JSON.parse(raw) as TemplateManifest;
    for (const [conditionalPath, condition] of Object.entries(manifest.conditionalPaths ?? {})) {
        if (typeof condition !== 'string' || !/^!?[A-Za-z0-9_]+$/.test(condition)) {
            throw new TemplateRenderError(`conditionalPaths["${conditionalPath}"] must name a flag, optionally prefixed with "!"`, TEMPLATE_MANIFEST_FILE);
        }
    }
    for (const [derivedFlag, rule] of Object.entries(manifest.derivedFlags ?? {})) {
        const ruleEntries: [string, unknown][] = typeof rule === 'object' && rule !== null ? Object.entries(rule) : [];
        const [kind, listedFlags] = ruleEntries[0] ?? [];
        const validKind = kind === 'all' || kind === 'any';
        if (ruleEntries.length !== 1 || !validKind || !Array.isArray(listedFlags) || listedFlags.length === 0 || !listedFlags.every((flag) => typeof flag === 'string')) {
            throw new TemplateRenderError(`derivedFlags["${derivedFlag}"] must be { "all": [flags] } or { "any": [flags] }`, TEMPLATE_MANIFEST_FILE);
        }
    }
    return manifest;
}

/** The CLI's flags plus the template's derived ones; a derived flag is computed from the CLI's flags only. */
export function applyDerivedFlags(manifest: TemplateManifest, flags: Record<string, boolean>): Record<string, boolean> {
    const combined = { ...flags };
    for (const [derivedFlag, rule] of Object.entries(manifest.derivedFlags ?? {})) {
        if (derivedFlag in flags) {
            throw new TemplateRenderError(`derivedFlags["${derivedFlag}"] redefines a flag the CLI already sets`, TEMPLATE_MANIFEST_FILE);
        }
        const listedFlags = 'all' in rule ? rule.all : rule.any;
        for (const flag of listedFlags) {
            if (!(flag in flags)) {
                throw new TemplateRenderError(`derivedFlags["${derivedFlag}"] refers to unknown flag "${flag}"`, TEMPLATE_MANIFEST_FILE);
            }
        }
        combined[derivedFlag] = 'all' in rule ? listedFlags.every((flag) => flags[flag]) : listedFlags.some((flag) => flags[flag]);
    }
    return combined;
}

/** True when the manifest condition for this template-relative path (or any parent directory) says to skip it. */
export function isPathExcludedByManifest(templateRelativePath: string, manifest: TemplateManifest, flags: Record<string, boolean>): boolean {
    for (const [conditionalPath, condition] of Object.entries(manifest.conditionalPaths ?? {})) {
        const normalized = conditionalPath.replace(/\\/g, '/').replace(/\/+$/, '');
        if (templateRelativePath !== normalized && !templateRelativePath.startsWith(`${normalized}/`)) continue;
        const negated = condition.startsWith('!');
        const flag = negated ? condition.slice(1) : condition;
        if (!(flag in flags)) {
            throw new TemplateRenderError(`conditionalPaths["${conditionalPath}"] refers to unknown flag "${flag}"`, TEMPLATE_MANIFEST_FILE);
        }
        const required = !negated;
        if (flags[flag] !== required) return true;
    }
    return false;
}

/**
 * Copies `sourceDir` into `targetDir`, rendering text files and file names on the way.
 * Existing files in `targetDir` are left alone unless the template provides the same path,
 * so notes or docs that predate the scaffold survive it. Returns the written relative paths.
 */
export async function renderTemplateDirectory(
    sourceDir: string,
    targetDir: string,
    context: RenderContext,
    options: RenderDirectoryOptions = {},
): Promise<string[]> {
    const skipDirectories = options.skipDirectories ?? new Set(['node_modules']);
    const manifest = await readTemplateManifest(sourceDir);
    const renderContext: RenderContext = { ...context, flags: applyDerivedFlags(manifest, context.flags) };
    const written: string[] = [];

    async function walk(currentSource: string, currentTarget: string, relativePrefix: string, templatePrefix: string): Promise<void> {
        await fs.mkdir(currentTarget, { recursive: true });
        const entries = await fs.readdir(currentSource, { withFileTypes: true });
        for (const entry of entries) {
            const sourcePath = path.join(currentSource, entry.name);
            const templateRelativePath = templatePrefix ? `${templatePrefix}/${entry.name}` : entry.name;
            if (templateRelativePath === TEMPLATE_MANIFEST_FILE) continue;
            if (isPathExcludedByManifest(templateRelativePath, manifest, renderContext.flags)) continue;

            const renderedName = renderTemplateFileName(entry.name, renderContext);
            const targetPath = path.join(currentTarget, renderedName);
            const relativePath = relativePrefix ? `${relativePrefix}/${renderedName}` : renderedName;

            if (entry.isDirectory()) {
                if (skipDirectories.has(entry.name)) continue;
                await walk(sourcePath, targetPath, relativePath, templateRelativePath);
                continue;
            }
            if (!entry.isFile()) continue;

            if (isSubstitutedFile(entry.name)) {
                const source = await fs.readFile(sourcePath, 'utf8');
                const rendered = renderTemplateString(source, renderContext, relativePath);
                await fs.writeFile(targetPath, rendered, 'utf8');
            } else {
                await fs.copyFile(sourcePath, targetPath);
            }
            written.push(relativePath);
        }
    }

    await walk(sourceDir, targetDir, '', '');
    return written.sort();
}
