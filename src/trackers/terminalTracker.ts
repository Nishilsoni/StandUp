import * as vscode from 'vscode';
import { DataStore, TerminalCommand } from '../storage/dataStore';

/**
 * Error patterns that indicate blockers.
 */
const ERROR_PATTERNS = [
    /error/i,
    /failed/i,
    /ENOENT/,
    /cannot find module/i,
    /command not found/i,
    /permission denied/i,
    /segmentation fault/i,
    /FATAL/i,
    /panic/i,
    /exception/i,
    /BUILD FAILED/i,
    /npm ERR!/,
    /exit code [1-9]/i,
    /compilation failed/i,
    /syntax error/i,
];

/**
 * Tracks terminal commands and detects errors/blockers.
 * Uses Shell Integration API (VS Code 1.93+) for rich data,
 * with fallback to basic terminal events.
 */
export class TerminalTracker implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    constructor(private dataStore: DataStore) {
        // Shell Integration API — captures actual commands with exit codes
        this.disposables.push(
            vscode.window.onDidEndTerminalShellExecution(event => {
                this.onShellExecutionEnd(event);
            })
        );

        // Fallback: track terminal open/close for basic awareness
        this.disposables.push(
            vscode.window.onDidOpenTerminal(terminal => {
                this.onTerminalOpen(terminal);
            })
        );
    }

    private async onShellExecutionEnd(
        event: vscode.TerminalShellExecutionEndEvent
    ): Promise<void> {
        const execution = event.execution;
        const exitCode = event.exitCode;

        // Get the command line
        const commandLine = execution.commandLine;
        let cmdText = '';

        if (commandLine) {
            cmdText = typeof commandLine === 'object' && 'value' in commandLine
                ? commandLine.value
                : String(commandLine);
        }

        // Skip empty or very short commands
        if (!cmdText || cmdText.trim().length < 2) { return; }

        // Skip common noise: cd, ls, clear, pwd, etc.
        const noiseCommands = new Set(['cd', 'ls', 'clear', 'pwd', 'cls', 'echo', 'cat', 'which', 'whoami']);
        const baseCmd = cmdText.trim().split(/\s+/)[0].toLowerCase();
        if (noiseCommands.has(baseCmd)) { return; }

        // Try to read some output
        let outputText = '';
        try {
            const stream = execution.read();
            let charCount = 0;
            const MAX_CHARS = 500;
            for await (const data of stream) {
                outputText += data;
                charCount += data.length;
                if (charCount > MAX_CHARS) {
                    outputText = outputText.substring(0, MAX_CHARS) + '... (truncated)';
                    break;
                }
            }
        } catch {
            // Output reading may not be available
        }

        const isError = (exitCode !== undefined && exitCode !== 0) ||
            this.containsErrorPattern(cmdText + ' ' + outputText);

        const cmd: TerminalCommand = {
            command: cmdText.trim(),
            timestamp: Date.now(),
            exitCode: exitCode,
            isError,
            output: outputText.substring(0, 500)
        };

        this.dataStore.addTerminalCommand(cmd);
    }

    private onTerminalOpen(_terminal: vscode.Terminal): void {
        // Basic tracking — we know a terminal was opened
        // Detailed tracking happens via shell integration events
    }

    private containsErrorPattern(text: string): boolean {
        return ERROR_PATTERNS.some(pattern => pattern.test(text));
    }

    dispose(): void {
        for (const d of this.disposables) { d.dispose(); }
    }
}
