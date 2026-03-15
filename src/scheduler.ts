import * as vscode from 'vscode';
import { parseTime } from './utils/timeUtils';

/**
 * Scheduler that checks the current time against the configured standup time
 * and triggers auto-generation when it matches.
 */
export class Scheduler implements vscode.Disposable {
    private checkInterval: NodeJS.Timeout | undefined;
    private hasTriggeredToday: boolean = false;
    private lastCheckedDate: string = '';
    private readonly CHECK_MS = 60 * 1000; // Check every minute

    constructor(private onTrigger: () => void) {
        this.checkInterval = setInterval(() => this.check(), this.CHECK_MS);
    }

    private check(): void {
        const config = vscode.workspace.getConfiguration('standup');
        const autoGenerate = config.get<boolean>('autoGenerate', true);
        if (!autoGenerate) { return; }

        const standupTime = config.get<string>('standupTime', '09:00');
        const { hours: targetH, minutes: targetM } = parseTime(standupTime);

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];

        // Reset trigger flag on new day
        if (todayStr !== this.lastCheckedDate) {
            this.hasTriggeredToday = false;
            this.lastCheckedDate = todayStr;
        }

        if (this.hasTriggeredToday) { return; }

        const currentH = now.getHours();
        const currentM = now.getMinutes();

        // Trigger if within 1-minute window of target time
        if (currentH === targetH && currentM === targetM) {
            this.hasTriggeredToday = true;
            this.onTrigger();
        }
    }

    dispose(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }
}
