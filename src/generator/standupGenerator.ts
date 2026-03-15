import { DayData } from '../storage/dataStore';
import { formatDuration, getToday, getYesterday, getRelativeDay } from '../utils/timeUtils';
import { shortenPath, getComponentName, groupByDirectory } from '../utils/pathUtils';

/**
 * Generates a natural-language standup update from tracked data.
 * Uses template-based generation — no external AI API needed.
 */
export class StandupGenerator {

    /**
     * Generate a standup message for the given day's data.
     * If yesterdayData is provided, it reports "Yesterday" for that data 
     * and "Today" based on inference.
     */
    generate(todayData: DayData, yesterdayData?: DayData): string {
        const reportData = yesterdayData || todayData;
        const reportLabel = yesterdayData ? 'Yesterday' : getRelativeDay(reportData.date);

        const sections: string[] = [];

        // ─── Yesterday (or reported day) ─────────────────
        const workItems = this.generateWorkItems(reportData);
        if (workItems.length > 0) {
            sections.push(`🔄 **${reportLabel}:**`);
            for (const item of workItems) {
                sections.push(`- ${item}`);
            }
        } else {
            sections.push(`🔄 **${reportLabel}:**`);
            sections.push(`- No tracked activity`);
        }

        sections.push('');

        // ─── Today ───────────────────────────────────────
        const todayItems = this.generateTodayPlan(reportData, todayData);
        sections.push(`📋 **Today:**`);
        for (const item of todayItems) {
            sections.push(`- ${item}`);
        }

        // ─── Blockers ────────────────────────────────────
        const blockers = this.generateBlockers(reportData);
        if (blockers.length > 0) {
            sections.push('');
            sections.push(`🚧 **Blockers:**`);
            for (const blocker of blockers) {
                sections.push(`- ${blocker}`);
            }
        }

        return sections.join('\n');
    }

    /**
     * Generate a plain-text version (no markdown) for Slack.
     */
    generatePlainText(todayData: DayData, yesterdayData?: DayData): string {
        return this.generate(todayData, yesterdayData)
            .replace(/\*\*/g, '')
            .replace(/`/g, '');
    }

    // ─── Internal Methods ────────────────────────────────

    private generateWorkItems(data: DayData): string[] {
        const items: string[] = [];

        // 1. Group commits by area and summarize
        if (data.commits.length > 0) {
            const commitsByArea = this.groupCommitsByArea(data);
            for (const [area, commits] of commitsByArea) {
                if (commits.length === 1) {
                    items.push(this.humanizeCommitMessage(commits[0].message, area));
                } else {
                    // Summarize multiple commits in same area
                    const summary = this.summarizeCommits(commits, area);
                    items.push(summary);
                }
            }
        }

        // 2. Add file work not captured by commits
        const fileTimeSummary = this.getFileTimeSummary(data);
        const commitFiles = new Set(data.commits.flatMap(c => c.filesChanged));

        for (const [filePath, duration] of fileTimeSummary) {
            // Skip files already covered by commits
            if (commitFiles.has(filePath)) { continue; }
            // Only include files worked on for > 5 minutes
            if (duration < 5 * 60 * 1000) { continue; }

            const shortPath = shortenPath(filePath);
            const component = getComponentName(filePath);
            const durationStr = formatDuration(duration);
            items.push(`Worked on ${component} (${shortPath}, ${durationStr})`);
        }

        // Limit to top 5 items
        return items.slice(0, 5);
    }

    private generateTodayPlan(yesterdayData: DayData, todayData: DayData): string[] {
        const items: string[] = [];

        // Infer "today" plan from incomplete work
        // 1. Files that were being actively worked on late in the day
        const lateSessions = yesterdayData.activities
            .filter(a => {
                const hour = new Date(a.endTime).getHours();
                return hour >= 16; // After 4 PM
            })
            .sort((a, b) => b.endTime - a.endTime);

        if (lateSessions.length > 0) {
            const topFile = lateSessions[0];
            const component = getComponentName(topFile.filePath);
            items.push(`Continuing work on ${component}`);
        }

        // 2. If there are any commits from today already, mention continuing
        if (todayData.commits.length > 0) {
            const areas = new Set(todayData.commits.flatMap(c => 
                c.filesChanged.map(f => getComponentName(f))
            ));
            for (const area of Array.from(areas).slice(0, 2)) {
                if (!items.some(i => i.includes(area))) {
                    items.push(`Working on ${area}`);
                }
            }
        }

        // 3. If there were errors/blockers, mention fixing them
        const errors = yesterdayData.terminalCommands.filter(c => c.isError);
        if (errors.length > 0) {
            items.push('Investigating and fixing build/test issues');
        }

        // Default if nothing could be inferred
        if (items.length === 0) {
            items.push('Continuing development work');
            items.push('Reviewing PRs');
        }

        return items.slice(0, 3);
    }

    private generateBlockers(data: DayData): string[] {
        const blockers: string[] = [];
        const errors = data.terminalCommands.filter(c => c.isError);

        if (errors.length === 0) { return blockers; }

        // Group errors by command
        const errorGroups = new Map<string, number>();
        for (const err of errors) {
            const baseCmd = err.command.split(/\s+/).slice(0, 3).join(' ');
            errorGroups.set(baseCmd, (errorGroups.get(baseCmd) || 0) + 1);
        }

        for (const [cmd, count] of errorGroups) {
            if (count >= 2) {
                blockers.push(`\`${cmd}\` failing repeatedly (${count} occurrences)`);
            } else {
                blockers.push(`\`${cmd}\` failed`);
            }
        }

        return blockers.slice(0, 3);
    }

    private groupCommitsByArea(data: DayData): Map<string, typeof data.commits> {
        const groups = new Map<string, typeof data.commits>();
        for (const commit of data.commits) {
            // Use the most common component name from files changed
            const components = commit.filesChanged.map(f => getComponentName(f));
            const area = this.getMostCommon(components) || 'project';
            
            const existing = groups.get(area) || [];
            existing.push(commit);
            groups.set(area, existing);
        }
        return groups;
    }

    private humanizeCommitMessage(message: string, area: string): string {
        // Clean up common commit prefixes
        let cleaned = message
            .replace(/^(feat|fix|refactor|chore|docs|style|test|perf|ci|build)(\(.+?\))?:\s*/i, '')
            .replace(/^(WIP|wip):\s*/, '')
            .trim();

        // Capitalize first letter
        if (cleaned.length > 0) {
            cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }

        // If message is too short or generic, add context
        if (cleaned.length < 10) {
            return `${cleaned} (${area})`;
        }

        return cleaned;
    }

    private summarizeCommits(commits: { message: string; hash: string; timestamp: number; filesChanged: string[]; insertions: number; deletions: number }[], area: string): string {
        const count = commits.length;
        // Get verbs from commit messages
        const firstCommit = commits[0];
        const cleanedFirst = firstCommit.message
            .replace(/^(feat|fix|refactor|chore|docs|style|test|perf|ci|build)(\(.+?\))?:\s*/i, '')
            .trim();
        
        if (count === 2) {
            return `${cleanedFirst} and 1 other change in ${area}`;
        }
        return `${cleanedFirst} and ${count - 1} other changes in ${area}`;
    }

    private getFileTimeSummary(data: DayData): Map<string, number> {
        const summary = new Map<string, number>();
        for (const session of data.activities) {
            const duration = session.endTime - session.startTime;
            const current = summary.get(session.filePath) || 0;
            summary.set(session.filePath, current + duration);
        }
        // Sort by duration descending
        return new Map(
            [...summary.entries()].sort((a, b) => b[1] - a[1])
        );
    }

    private getMostCommon(arr: string[]): string | undefined {
        if (arr.length === 0) { return undefined; }
        const counts = new Map<string, number>();
        for (const item of arr) {
            counts.set(item, (counts.get(item) || 0) + 1);
        }
        let maxItem: string | undefined;
        let maxCount = 0;
        for (const [item, count] of counts) {
            if (count > maxCount) {
                maxCount = count;
                maxItem = item;
            }
        }
        return maxItem;
    }
}
