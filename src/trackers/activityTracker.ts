import * as vscode from 'vscode';
import { DataStore, ActivitySession } from '../storage/dataStore';

/**
 * Tracks file edits, time-on-file, and saves.
 * Silently records activity sessions as you work.
 */
export class ActivityTracker implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private currentFile: string | undefined;
    private currentSessionStart: number = 0;
    private editCount: number = 0;
    private linesChanged: number = 0;
    private debounceTimer: NodeJS.Timeout | undefined;
    private idleTimer: NodeJS.Timeout | undefined;
    private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 min idle = end session

    constructor(private dataStore: DataStore) {
        // Track text edits
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChange(e))
        );

        // Track active editor changes (file switches)
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(e => this.onEditorChange(e))
        );

        // Track saves
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(doc => this.onDocumentSave(doc))
        );

        // Initialize with current editor
        if (vscode.window.activeTextEditor) {
            this.startSession(vscode.window.activeTextEditor.document.uri.fsPath);
        }
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        // Ignore output/debug panels and git-related changes
        if (event.document.uri.scheme !== 'file') { return; }

        const filePath = event.document.uri.fsPath;

        // If this is a different file than we're tracking, switch sessions
        if (filePath !== this.currentFile) {
            this.endCurrentSession();
            this.startSession(filePath);
        }

        // Accumulate edits (debounced)
        for (const change of event.contentChanges) {
            const newLines = change.text.split('\n').length - 1;
            const removedLines = change.range.end.line - change.range.start.line;
            this.linesChanged += Math.max(newLines, removedLines, 1);
        }
        this.editCount++;

        // Reset idle timer
        this.resetIdleTimer();
    }

    private onEditorChange(editor: vscode.TextEditor | undefined): void {
        if (!editor || editor.document.uri.scheme !== 'file') {
            this.endCurrentSession();
            return;
        }

        const filePath = editor.document.uri.fsPath;
        if (filePath !== this.currentFile) {
            this.endCurrentSession();
            this.startSession(filePath);
        }
    }

    private onDocumentSave(_doc: vscode.TextDocument): void {
        // Saves are implicitly captured as part of the session
        // This is a good time to flush pending data
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.flushPendingEdits();
    }

    private startSession(filePath: string): void {
        this.currentFile = filePath;
        this.currentSessionStart = Date.now();
        this.editCount = 0;
        this.linesChanged = 0;
        this.resetIdleTimer();
    }

    private endCurrentSession(): void {
        if (this.currentFile && this.currentSessionStart > 0) {
            const now = Date.now();
            const duration = now - this.currentSessionStart;

            // Only record sessions longer than 2 seconds
            if (duration > 2000) {
                const session: ActivitySession = {
                    filePath: this.currentFile,
                    startTime: this.currentSessionStart,
                    endTime: now,
                    editCount: this.editCount,
                    linesChanged: this.linesChanged
                };
                this.dataStore.addActivity(session);
            }
        }

        this.currentFile = undefined;
        this.currentSessionStart = 0;
        this.editCount = 0;
        this.linesChanged = 0;

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
    }

    private resetIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        this.idleTimer = setTimeout(() => {
            // End session after idle timeout, start a new one if still on same file
            this.endCurrentSession();
            if (vscode.window.activeTextEditor?.document.uri.scheme === 'file') {
                this.startSession(vscode.window.activeTextEditor.document.uri.fsPath);
            }
        }, this.IDLE_TIMEOUT);
    }

    private flushPendingEdits(): void {
        // Update the current session in the store
        if (this.currentFile && this.editCount > 0) {
            this.dataStore.updateLastActivity({
                endTime: Date.now(),
                editCount: this.editCount,
                linesChanged: this.linesChanged
            });
        }
    }

    /**
     * Force-end the current session (call on deactivate).
     */
    public flush(): void {
        this.endCurrentSession();
    }

    dispose(): void {
        this.flush();
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        if (this.idleTimer) { clearTimeout(this.idleTimer); }
        for (const d of this.disposables) { d.dispose(); }
    }
}
