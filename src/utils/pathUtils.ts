import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Extract a meaningful component/directory name from a file path.
 * e.g. "/project/src/auth/login.ts" → "auth"
 */
export function getComponentName(filePath: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let relativePath = filePath;

    if (workspaceFolders && workspaceFolders.length > 0) {
        for (const folder of workspaceFolders) {
            if (filePath.startsWith(folder.uri.fsPath)) {
                relativePath = path.relative(folder.uri.fsPath, filePath);
                break;
            }
        }
    }

    const parts = relativePath.split(path.sep);
    // Skip common top-level dirs like 'src', 'lib', 'app'
    const skipDirs = new Set(['src', 'lib', 'app', 'source', 'packages']);
    
    for (const part of parts) {
        if (!skipDirs.has(part) && !part.includes('.')) {
            return part;
        }
    }

    // Fallback to filename without extension
    return path.basename(filePath, path.extname(filePath));
}

/**
 * Shorten a file path to make it human-readable.
 * e.g. "/Users/dev/project/src/auth/login.ts" → "src/auth/login.ts"
 */
export function shortenPath(filePath: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (workspaceFolders && workspaceFolders.length > 0) {
        for (const folder of workspaceFolders) {
            if (filePath.startsWith(folder.uri.fsPath)) {
                return path.relative(folder.uri.fsPath, filePath);
            }
        }
    }

    // Fallback: show last 3 segments
    const parts = filePath.split(path.sep);
    if (parts.length > 3) {
        return '...' + path.sep + parts.slice(-3).join(path.sep);
    }
    return filePath;
}

/**
 * Group file paths by their parent directory.
 */
export function groupByDirectory(filePaths: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();

    for (const fp of filePaths) {
        const dir = getComponentName(fp);
        const existing = groups.get(dir) || [];
        existing.push(fp);
        groups.set(dir, existing);
    }

    return groups;
}
