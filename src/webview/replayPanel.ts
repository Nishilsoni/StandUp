import * as vscode from 'vscode';
import { DayData } from '../storage/dataStore';
import { formatDuration } from '../utils/timeUtils';
import { shortenPath, getComponentName } from '../utils/pathUtils';

/**
 * Manages the Productivity Replay webview panel.
 * Shows a gorgeous timeline visualization of the workday.
 */
export class ReplayPanel {
    public static currentPanel: ReplayPanel | undefined;
    private panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public static show(
        extensionUri: vscode.Uri,
        data: DayData
    ): void {
        const column = vscode.ViewColumn.One;

        if (ReplayPanel.currentPanel) {
            ReplayPanel.currentPanel.panel.reveal(column);
            ReplayPanel.currentPanel.update(data);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'standupReplay',
            '📊 Productivity Replay',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        ReplayPanel.currentPanel = new ReplayPanel(panel, data);
    }

    private constructor(panel: vscode.WebviewPanel, data: DayData) {
        this.panel = panel;
        this.update(data);

        this.panel.onDidDispose(() => {
            ReplayPanel.currentPanel = undefined;
            for (const d of this.disposables) { d.dispose(); }
        }, null, this.disposables);
    }

    private update(data: DayData): void {
        this.panel.webview.html = this.getHtml(data);
    }

    private getHtml(data: DayData): string {
        const activitiesJson = JSON.stringify(this.prepareActivities(data));
        const commitsJson = JSON.stringify(this.prepareCommits(data));
        const errorsJson = JSON.stringify(this.prepareErrors(data));
        const statsJson = JSON.stringify(this.prepareStats(data));

        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Productivity Replay</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

        :root {
            --bg-primary: #0a0a0f;
            --bg-secondary: #12121a;
            --bg-card: #1a1a28;
            --bg-card-hover: #222236;
            --border: #2a2a40;
            --text-primary: #e8e8f0;
            --text-secondary: #8888a8;
            --text-muted: #555570;
            --accent-blue: #4d7cff;
            --accent-purple: #8b5cf6;
            --accent-cyan: #06d6a0;
            --accent-orange: #ff8a3d;
            --accent-pink: #ff6b9d;
            --accent-red: #ff4757;
            --accent-yellow: #ffd93d;
            --glow-blue: rgba(77, 124, 255, 0.3);
            --glow-purple: rgba(139, 92, 246, 0.3);
            --glow-cyan: rgba(6, 214, 160, 0.2);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            overflow-x: hidden;
        }

        /* ─── Header ─── */
        .header {
            padding: 32px 40px 24px;
            background: linear-gradient(180deg, rgba(77,124,255,0.08) 0%, transparent 100%);
            border-bottom: 1px solid var(--border);
        }
        .header-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
        }
        .header h1 {
            font-size: 28px;
            font-weight: 800;
            background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }
        .header .date {
            font-size: 14px;
            color: var(--text-secondary);
            font-weight: 500;
        }

        /* ─── Stats Row ─── */
        .stats-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 12px;
            padding: 0 40px 24px;
            margin-top: -8px;
        }
        .stat-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px 20px;
            transition: all 0.3s ease;
        }
        .stat-card:hover {
            background: var(--bg-card-hover);
            border-color: var(--accent-blue);
            box-shadow: 0 0 20px var(--glow-blue);
            transform: translateY(-2px);
        }
        .stat-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            font-weight: 600;
            margin-bottom: 4px;
        }
        .stat-value {
            font-size: 24px;
            font-weight: 700;
            color: var(--text-primary);
        }
        .stat-value.blue { color: var(--accent-blue); }
        .stat-value.purple { color: var(--accent-purple); }
        .stat-value.cyan { color: var(--accent-cyan); }
        .stat-value.orange { color: var(--accent-orange); }

        /* ─── Timeline ─── */
        .timeline-section {
            padding: 24px 40px;
        }
        .section-title {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .section-title .icon {
            font-size: 18px;
        }

        .timeline-container {
            position: relative;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 24px;
            overflow: hidden;
        }

        /* Time axis */
        .time-axis {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            padding: 0 4px;
        }
        .time-label {
            font-size: 10px;
            color: var(--text-muted);
            font-weight: 600;
            letter-spacing: 0.5px;
        }

        /* Timeline track */
        .timeline-track {
            position: relative;
            height: 60px;
            background: rgba(255,255,255,0.03);
            border-radius: 8px;
            margin-bottom: 8px;
            overflow: hidden;
        }

        .timeline-block {
            position: absolute;
            top: 4px;
            height: 52px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            font-size: 10px;
            font-weight: 600;
            color: rgba(255,255,255,0.9);
            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        .timeline-block:hover {
            transform: scaleY(1.1);
            z-index: 10;
            box-shadow: 0 0 20px rgba(255,255,255,0.1);
        }
        .timeline-block .block-label {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding: 0 6px;
        }

        /* Markers */
        .marker-track {
            position: relative;
            height: 32px;
            margin-top: 4px;
        }
        .commit-marker {
            position: absolute;
            top: 0;
            width: 20px;
            height: 20px;
            background: var(--accent-cyan);
            border-radius: 50%;
            transform: translateX(-10px);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            box-shadow: 0 0 12px var(--glow-cyan);
            transition: all 0.2s ease;
            z-index: 5;
        }
        .commit-marker:hover {
            transform: translateX(-10px) scale(1.3);
            box-shadow: 0 0 24px var(--glow-cyan);
        }
        .error-marker {
            position: absolute;
            top: 0;
            width: 20px;
            height: 20px;
            background: var(--accent-red);
            border-radius: 4px;
            transform: translateX(-10px) rotate(45deg);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            box-shadow: 0 0 12px rgba(255, 71, 87, 0.4);
            transition: all 0.2s ease;
            z-index: 5;
        }
        .error-marker:hover {
            transform: translateX(-10px) rotate(45deg) scale(1.3);
        }

        /* Legend */
        .legend {
            display: flex;
            gap: 16px;
            margin-top: 16px;
            flex-wrap: wrap;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: var(--text-secondary);
            font-weight: 500;
        }
        .legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 3px;
        }

        /* ─── Tooltip ─── */
        .tooltip {
            display: none;
            position: fixed;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 12px 16px;
            font-size: 12px;
            max-width: 280px;
            z-index: 100;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            backdrop-filter: blur(10px);
        }
        .tooltip.visible { display: block; }
        .tooltip-title {
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 4px;
        }
        .tooltip-detail {
            color: var(--text-secondary);
            line-height: 1.5;
        }

        /* ─── File List ─── */
        .file-list-section {
            padding: 24px 40px 40px;
        }
        .file-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 10px;
        }
        .file-item {
            display: flex;
            align-items: center;
            gap: 12px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 12px 16px;
            transition: all 0.3s ease;
        }
        .file-item:hover {
            border-color: var(--accent-purple);
            background: var(--bg-card-hover);
            box-shadow: 0 0 16px var(--glow-purple);
        }
        .file-bar {
            width: 4px;
            height: 32px;
            border-radius: 2px;
            flex-shrink: 0;
        }
        .file-info {
            flex: 1;
            min-width: 0;
        }
        .file-name {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .file-meta {
            font-size: 11px;
            color: var(--text-secondary);
            margin-top: 2px;
        }
        .file-duration {
            font-size: 14px;
            font-weight: 700;
            color: var(--accent-blue);
            flex-shrink: 0;
        }

        /* ─── Deep Work ─── */
        .deep-work-section {
            padding: 0 40px 24px;
        }
        .deep-work-blocks {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        .deep-block {
            background: linear-gradient(135deg, rgba(139,92,246,0.15), rgba(77,124,255,0.1));
            border: 1px solid rgba(139,92,246,0.3);
            border-radius: 12px;
            padding: 14px 20px;
            transition: all 0.3s ease;
        }
        .deep-block:hover {
            border-color: var(--accent-purple);
            box-shadow: 0 0 24px var(--glow-purple);
            transform: translateY(-2px);
        }
        .deep-block-title {
            font-size: 13px;
            font-weight: 700;
            color: var(--accent-purple);
        }
        .deep-block-time {
            font-size: 11px;
            color: var(--text-secondary);
            margin-top: 2px;
        }

        /* ─── Empty State ─── */
        .empty-state {
            text-align: center;
            padding: 80px 40px;
        }
        .empty-state .emoji {
            font-size: 48px;
            margin-bottom: 16px;
        }
        .empty-state h2 {
            font-size: 20px;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 8px;
        }
        .empty-state p {
            font-size: 14px;
            color: var(--text-secondary);
        }

        /* Animations */
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .animate-in {
            animation: fadeIn 0.4s ease forwards;
        }
        .delay-1 { animation-delay: 0.1s; opacity: 0; }
        .delay-2 { animation-delay: 0.2s; opacity: 0; }
        .delay-3 { animation-delay: 0.3s; opacity: 0; }
        .delay-4 { animation-delay: 0.4s; opacity: 0; }
    </style>
</head>
<body>
    <div id="app"></div>
    <div class="tooltip" id="tooltip">
        <div class="tooltip-title" id="tooltip-title"></div>
        <div class="tooltip-detail" id="tooltip-detail"></div>
    </div>

    <script>
        const activities = ${activitiesJson};
        const commits = ${commitsJson};
        const errors = ${errorsJson};
        const stats = ${statsJson};

        const COLORS = [
            '#4d7cff', '#8b5cf6', '#06d6a0', '#ff8a3d', '#ff6b9d',
            '#ffd93d', '#3dc9b0', '#c084fc', '#60a5fa', '#f97316',
            '#a78bfa', '#34d399', '#fb7185', '#38bdf8', '#facc15'
        ];

        const DAY_START_HOUR = 6;   // 6 AM
        const DAY_END_HOUR = 23;    // 11 PM
        const DAY_MS = (DAY_END_HOUR - DAY_START_HOUR) * 60 * 60 * 1000;

        function getTimePercent(timestamp) {
            const d = new Date(timestamp);
            const dayStart = new Date(d);
            dayStart.setHours(DAY_START_HOUR, 0, 0, 0);
            const offset = timestamp - dayStart.getTime();
            return Math.max(0, Math.min(100, (offset / DAY_MS) * 100));
        }

        function formatTime(timestamp) {
            return new Date(timestamp).toLocaleTimeString('en-US', {
                hour: 'numeric', minute: '2-digit', hour12: true
            });
        }

        function render() {
            const app = document.getElementById('app');

            if (activities.length === 0 && commits.length === 0) {
                app.innerHTML = \`
                    <div class="header">
                        <div class="header-top">
                            <h1>📊 Productivity Replay</h1>
                            <span class="date">\${stats.date}</span>
                        </div>
                    </div>
                    <div class="empty-state">
                        <div class="emoji">🌅</div>
                        <h2>No activity recorded yet</h2>
                        <p>Start coding and your workday timeline will appear here automatically.</p>
                    </div>
                \`;
                return;
            }

            // Generate color map for components
            const componentSet = new Set(activities.map(a => a.component));
            const colorMap = {};
            let colorIdx = 0;
            for (const comp of componentSet) {
                colorMap[comp] = COLORS[colorIdx % COLORS.length];
                colorIdx++;
            }

            // Build time axis labels
            const timeLabels = [];
            for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h += 2) {
                const label = h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h-12) + 'p';
                timeLabels.push(label);
            }

            // Build timeline blocks HTML
            let blocksHtml = '';
            activities.forEach((a, i) => {
                const left = getTimePercent(a.startTime);
                const right = getTimePercent(a.endTime);
                const width = Math.max(right - left, 0.3);
                const color = colorMap[a.component] || COLORS[0];
                blocksHtml += \`<div class="timeline-block" 
                    style="left:\${left}%; width:\${width}%; background: \${color}; opacity:0.85;"
                    data-tooltip-title="\${a.shortPath}"
                    data-tooltip-detail="\${a.duration} · \${a.editCount} edits · \${a.linesChanged} lines"
                    onmouseenter="showTooltip(event, this)"
                    onmouseleave="hideTooltip()">
                    <span class="block-label">\${width > 3 ? a.component : ''}</span>
                </div>\`;
            });

            // Build commit markers
            let commitMarkersHtml = '';
            commits.forEach(c => {
                const left = getTimePercent(c.timestamp);
                commitMarkersHtml += \`<div class="commit-marker" 
                    style="left:\${left}%"
                    data-tooltip-title="Commit: \${c.message}"
                    data-tooltip-detail="\${formatTime(c.timestamp)} · \${c.filesCount} files"
                    onmouseenter="showTooltip(event, this)"
                    onmouseleave="hideTooltip()">⬆</div>\`;
            });

            // Build error markers
            let errorMarkersHtml = '';
            errors.forEach(e => {
                const left = getTimePercent(e.timestamp);
                errorMarkersHtml += \`<div class="error-marker" 
                    style="left:\${left}%"
                    data-tooltip-title="Error: \${e.command}"
                    data-tooltip-detail="\${formatTime(e.timestamp)} · Exit code: \${e.exitCode}"
                    onmouseenter="showTooltip(event, this)"
                    onmouseleave="hideTooltip()">
                </div>\`;
            });

            // Build legend
            let legendHtml = '';
            for (const [comp, color] of Object.entries(colorMap)) {
                legendHtml += \`<div class="legend-item">
                    <div class="legend-dot" style="background:\${color}"></div>
                    \${comp}
                </div>\`;
            }
            if (commits.length > 0) {
                legendHtml += \`<div class="legend-item">
                    <div class="legend-dot" style="background: var(--accent-cyan); border-radius:50%"></div>
                    Commits
                </div>\`;
            }
            if (errors.length > 0) {
                legendHtml += \`<div class="legend-item">
                    <div class="legend-dot" style="background: var(--accent-red); border-radius:2px; transform:rotate(45deg);"></div>
                    Errors
                </div>\`;
            }

            // Deep work blocks (30+ min on same file)
            const deepWork = activities.filter(a => {
                const durationMs = a.endTime - a.startTime;
                return durationMs >= 30 * 60 * 1000;
            });
            let deepWorkHtml = '';
            if (deepWork.length > 0) {
                deepWorkHtml = \`
                <div class="deep-work-section animate-in delay-3">
                    <div class="section-title"><span class="icon">🧘</span> Deep Work Blocks</div>
                    <div class="deep-work-blocks">
                        \${deepWork.map(d => \`
                            <div class="deep-block">
                                <div class="deep-block-title">\${d.component}</div>
                                <div class="deep-block-time">\${d.duration} · \${formatTime(d.startTime)} – \${formatTime(d.endTime)}</div>
                            </div>
                        \`).join('')}
                    </div>
                </div>\`;
            }

            // File list sorted by time
            const fileSummary = {};
            activities.forEach(a => {
                if (!fileSummary[a.shortPath]) {
                    fileSummary[a.shortPath] = {
                        shortPath: a.shortPath,
                        component: a.component,
                        totalMs: 0,
                        editCount: 0,
                        linesChanged: 0,
                        color: colorMap[a.component] || COLORS[0]
                    };
                }
                fileSummary[a.shortPath].totalMs += (a.endTime - a.startTime);
                fileSummary[a.shortPath].editCount += a.editCount;
                fileSummary[a.shortPath].linesChanged += a.linesChanged;
            });
            const sortedFiles = Object.values(fileSummary).sort((a, b) => b.totalMs - a.totalMs);

            let fileListHtml = sortedFiles.map(f => {
                const durMin = Math.round(f.totalMs / 60000);
                const durStr = durMin >= 60 ? Math.floor(durMin/60) + 'h ' + (durMin%60) + 'm' : durMin + 'm';
                return \`<div class="file-item">
                    <div class="file-bar" style="background:\${f.color}"></div>
                    <div class="file-info">
                        <div class="file-name">\${f.shortPath}</div>
                        <div class="file-meta">\${f.editCount} edits · \${f.linesChanged} lines</div>
                    </div>
                    <div class="file-duration">\${durStr}</div>
                </div>\`;
            }).join('');

            app.innerHTML = \`
                <div class="header animate-in">
                    <div class="header-top">
                        <h1>📊 Productivity Replay</h1>
                        <span class="date">\${stats.date}</span>
                    </div>
                </div>

                <div class="stats-row animate-in delay-1">
                    <div class="stat-card">
                        <div class="stat-label">Total Active Time</div>
                        <div class="stat-value blue">\${stats.totalTime}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Files Touched</div>
                        <div class="stat-value purple">\${stats.filesCount}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Commits</div>
                        <div class="stat-value cyan">\${stats.commitsCount}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Context Switches</div>
                        <div class="stat-value orange">\${stats.contextSwitches}</div>
                    </div>
                </div>

                <div class="timeline-section animate-in delay-2">
                    <div class="section-title"><span class="icon">⏱️</span> Timeline</div>
                    <div class="timeline-container">
                        <div class="time-axis">
                            \${timeLabels.map(l => '<span class="time-label">' + l + '</span>').join('')}
                        </div>
                        <div class="timeline-track">
                            \${blocksHtml}
                        </div>
                        <div class="marker-track">
                            \${commitMarkersHtml}
                            \${errorMarkersHtml}
                        </div>
                        <div class="legend">\${legendHtml}</div>
                    </div>
                </div>

                \${deepWorkHtml}

                <div class="file-list-section animate-in delay-4">
                    <div class="section-title"><span class="icon">📁</span> Files Worked On</div>
                    <div class="file-list">
                        \${fileListHtml}
                    </div>
                </div>
            \`;
        }

        function showTooltip(event, el) {
            const tooltip = document.getElementById('tooltip');
            const title = document.getElementById('tooltip-title');
            const detail = document.getElementById('tooltip-detail');
            title.textContent = el.dataset.tooltipTitle || '';
            detail.textContent = el.dataset.tooltipDetail || '';
            tooltip.style.left = event.clientX + 12 + 'px';
            tooltip.style.top = event.clientY - 60 + 'px';
            tooltip.classList.add('visible');
        }

        function hideTooltip() {
            document.getElementById('tooltip').classList.remove('visible');
        }

        render();
    </script>
</body>
</html>`;
    }

    // ─── Data Preparation ────────────────────────────────

    private prepareActivities(data: DayData): object[] {
        return data.activities.map(a => ({
            shortPath: shortenPath(a.filePath),
            component: getComponentName(a.filePath),
            startTime: a.startTime,
            endTime: a.endTime,
            editCount: a.editCount,
            linesChanged: a.linesChanged,
            duration: formatDuration(a.endTime - a.startTime)
        }));
    }

    private prepareCommits(data: DayData): object[] {
        return data.commits.map(c => ({
            message: c.message.substring(0, 60),
            timestamp: c.timestamp,
            filesCount: c.filesChanged.length
        }));
    }

    private prepareErrors(data: DayData): object[] {
        return data.terminalCommands
            .filter(c => c.isError)
            .map(c => ({
                command: c.command.substring(0, 40),
                timestamp: c.timestamp,
                exitCode: c.exitCode
            }));
    }

    private prepareStats(data: DayData): object {
        const totalMs = data.activities.reduce(
            (sum, a) => sum + (a.endTime - a.startTime), 0
        );
        const filesSet = new Set(data.activities.map(a => a.filePath));

        // Count context switches (file changes)
        let switches = 0;
        for (let i = 1; i < data.activities.length; i++) {
            if (data.activities[i].filePath !== data.activities[i - 1].filePath) {
                switches++;
            }
        }

        return {
            date: data.date,
            totalTime: formatDuration(totalMs),
            filesCount: filesSet.size,
            commitsCount: data.commits.length,
            contextSwitches: switches
        };
    }
}
