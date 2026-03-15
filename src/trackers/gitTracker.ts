import * as vscode from 'vscode';
import { exec } from 'child_process';
import { DataStore, GitCommit } from '../storage/dataStore';
import { getToday } from '../utils/timeUtils';

/**
 * Tracks Git commits by periodically polling `git log`.
 * Captures commit messages, diffs, and file changes.
 */
export class GitTracker implements vscode.Disposable {
    private pollInterval: NodeJS.Timeout | undefined;
    private knownHashes: Set<string> = new Set();
    private readonly POLL_MS = 2 * 60 * 1000; // Every 2 minutes

    constructor(private dataStore: DataStore) {
        // Load already-known commits
        const existing = this.dataStore.getTodayCommits();
        for (const c of existing) {
            this.knownHashes.add(c.hash);
        }

        // Initial poll
        this.pollGitLog();

        // Set up periodic polling
        this.pollInterval = setInterval(() => this.pollGitLog(), this.POLL_MS);
    }

    private getWorkspaceRoot(): string | undefined {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
    }

    private pollGitLog(): void {
        const root = this.getWorkspaceRoot();
        if (!root) { return; }

        const today = getToday();

        // Get today's commits with diff stats
        const cmd = `git log --since="${today}T00:00:00" --format="%H|||%s|||%aI" --numstat`;

        exec(cmd, { cwd: root, maxBuffer: 1024 * 1024 }, (error, stdout) => {
            if (error) {
                // Not a git repo or other error — silently ignore
                return;
            }

            const commits = this.parseGitLog(stdout);
            for (const commit of commits) {
                if (!this.knownHashes.has(commit.hash)) {
                    this.knownHashes.add(commit.hash);
                    this.dataStore.addCommit(commit);
                }
            }
        });
    }

    private parseGitLog(output: string): GitCommit[] {
        const commits: GitCommit[] = [];
        const lines = output.trim().split('\n');

        let current: Partial<GitCommit> | null = null;

        for (const line of lines) {
            if (line.includes('|||')) {
                // This is a commit header line
                if (current && current.hash) {
                    commits.push(current as GitCommit);
                }

                const parts = line.split('|||');
                if (parts.length >= 3) {
                    current = {
                        hash: parts[0].trim(),
                        message: parts[1].trim(),
                        timestamp: new Date(parts[2].trim()).getTime(),
                        filesChanged: [],
                        insertions: 0,
                        deletions: 0
                    };
                }
            } else if (current && line.trim()) {
                // This is a numstat line: "insertions\tdeletions\tfilename"
                const statMatch = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
                if (statMatch) {
                    const ins = statMatch[1] === '-' ? 0 : parseInt(statMatch[1], 10);
                    const del = statMatch[2] === '-' ? 0 : parseInt(statMatch[2], 10);
                    const file = statMatch[3];

                    current.insertions = (current.insertions || 0) + ins;
                    current.deletions = (current.deletions || 0) + del;
                    current.filesChanged = current.filesChanged || [];
                    current.filesChanged.push(file);
                }
            }
        }

        // Push the last commit
        if (current && current.hash) {
            commits.push(current as GitCommit);
        }

        return commits;
    }

    /**
     * Force a poll now (useful before generating standup).
     */
    public async forceRefresh(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.pollGitLog();
            // Give the async exec a moment to complete
            setTimeout(resolve, 1000);
        });
    }

    dispose(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
    }
}
