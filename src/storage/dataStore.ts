import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getToday } from '../utils/timeUtils';

// ─── Data Types ──────────────────────────────────────────

export interface ActivitySession {
    filePath: string;
    startTime: number;
    endTime: number;
    editCount: number;
    linesChanged: number;
}

export interface GitCommit {
    hash: string;
    message: string;
    timestamp: number;
    filesChanged: string[];
    insertions: number;
    deletions: number;
}

export interface TerminalCommand {
    command: string;
    timestamp: number;
    exitCode: number | undefined;
    isError: boolean;
    output: string;
}

export interface DayData {
    date: string;
    activities: ActivitySession[];
    commits: GitCommit[];
    terminalCommands: TerminalCommand[];
}

// ─── Data Store ──────────────────────────────────────────

export class DataStore {
    private dataDir: string;
    private currentDay: DayData;

    constructor(private context: vscode.ExtensionContext) {
        this.dataDir = path.join(os.homedir(), '.standup');
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        this.currentDay = this.loadDay(getToday());
        this.cleanOldData();
    }

    // ─── Persistence ─────────────────────────────────────

    private getFilePath(date: string): string {
        return path.join(this.dataDir, `${date}.json`);
    }

    private loadDay(date: string): DayData {
        const filePath = this.getFilePath(date);
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(raw) as DayData;
            } catch {
                // Corrupted file, start fresh
            }
        }
        return { date, activities: [], commits: [], terminalCommands: [] };
    }

    private saveCurrent(): void {
        try {
            const filePath = this.getFilePath(this.currentDay.date);
            fs.writeFileSync(filePath, JSON.stringify(this.currentDay, null, 2), 'utf-8');
        } catch (e) {
            console.error('[StandUp] Failed to save data:', e);
        }
    }

    private ensureToday(): void {
        const today = getToday();
        if (this.currentDay.date !== today) {
            this.saveCurrent();
            this.currentDay = this.loadDay(today);
        }
    }

    private cleanOldData(): void {
        const config = vscode.workspace.getConfiguration('standup');
        const retentionDays = config.get<number>('dataRetentionDays', 7);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retentionDays);

        try {
            const files = fs.readdirSync(this.dataDir);
            for (const file of files) {
                if (!file.endsWith('.json')) { continue; }
                const dateStr = file.replace('.json', '');
                const fileDate = new Date(dateStr);
                if (!isNaN(fileDate.getTime()) && fileDate < cutoff) {
                    fs.unlinkSync(path.join(this.dataDir, file));
                }
            }
        } catch (e) {
            console.error('[StandUp] Failed to clean old data:', e);
        }
    }

    // ─── Activity Methods ────────────────────────────────

    addActivity(session: ActivitySession): void {
        this.ensureToday();
        this.currentDay.activities.push(session);
        this.saveCurrent();
    }

    updateLastActivity(update: Partial<ActivitySession>): void {
        this.ensureToday();
        const last = this.currentDay.activities[this.currentDay.activities.length - 1];
        if (last) {
            Object.assign(last, update);
            this.saveCurrent();
        }
    }

    // ─── Git Methods ─────────────────────────────────────

    addCommit(commit: GitCommit): void {
        this.ensureToday();
        // Avoid duplicates by hash
        if (!this.currentDay.commits.some(c => c.hash === commit.hash)) {
            this.currentDay.commits.push(commit);
            this.saveCurrent();
        }
    }

    // ─── Terminal Methods ────────────────────────────────

    addTerminalCommand(cmd: TerminalCommand): void {
        this.ensureToday();
        this.currentDay.terminalCommands.push(cmd);
        this.saveCurrent();
    }

    // ─── Query Methods ───────────────────────────────────

    getTodayData(): DayData {
        this.ensureToday();
        return { ...this.currentDay };
    }

    getDayData(date: string): DayData {
        if (date === this.currentDay.date) {
            return { ...this.currentDay };
        }
        return this.loadDay(date);
    }

    getTodayActivities(): ActivitySession[] {
        this.ensureToday();
        return [...this.currentDay.activities];
    }

    getTodayCommits(): GitCommit[] {
        this.ensureToday();
        return [...this.currentDay.commits];
    }

    getTodayTerminalCommands(): TerminalCommand[] {
        this.ensureToday();
        return [...this.currentDay.terminalCommands];
    }

    getTodayErrors(): TerminalCommand[] {
        return this.getTodayTerminalCommands().filter(c => c.isError);
    }

    /**
     * Get a summary of time spent per file today.
     * Returns a Map of filePath → total milliseconds.
     */
    getFileTimeSummary(): Map<string, number> {
        const summary = new Map<string, number>();
        for (const session of this.getTodayActivities()) {
            const duration = session.endTime - session.startTime;
            const current = summary.get(session.filePath) || 0;
            summary.set(session.filePath, current + duration);
        }
        return summary;
    }

    /**
     * Clear all data for today.
     */
    clearToday(): void {
        this.currentDay = {
            date: getToday(),
            activities: [],
            commits: [],
            terminalCommands: []
        };
        this.saveCurrent();
    }

    /**
     * Force save (call on deactivate).
     */
    flush(): void {
        this.saveCurrent();
    }
}
