import * as vscode from 'vscode';
import { DataStore } from './storage/dataStore';
import { ActivityTracker } from './trackers/activityTracker';
import { GitTracker } from './trackers/gitTracker';
import { TerminalTracker } from './trackers/terminalTracker';
import { StandupGenerator } from './generator/standupGenerator';
import { SlackIntegration } from './integrations/slackIntegration';
import { LinkedInIntegration } from './integrations/linkedinIntegration';
import { Scheduler } from './scheduler';
import { ReplayPanel } from './webview/replayPanel';
import { getYesterday } from './utils/timeUtils';

let dataStore: DataStore;
let activityTracker: ActivityTracker;
let gitTracker: GitTracker;
let terminalTracker: TerminalTracker;
let scheduler: Scheduler;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('[StandUp] Extension activated — tracking your workday silently 📊');

    // ─── Initialize Core ─────────────────────────────────
    dataStore = new DataStore(context);
    activityTracker = new ActivityTracker(dataStore);
    gitTracker = new GitTracker(dataStore);
    terminalTracker = new TerminalTracker(dataStore);

    const generator = new StandupGenerator();
    const slack = new SlackIntegration(context.secrets);
    const linkedIn = new LinkedInIntegration(context.secrets);

    // ─── Status Bar ──────────────────────────────────────
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = '$(graph) StandUp';
    statusBarItem.tooltip = 'Click to generate your standup update';
    statusBarItem.command = 'standup.generateStandup';
    statusBarItem.show();

    // ─── Commands ────────────────────────────────────────

    // Generate Standup
    const generateCmd = vscode.commands.registerCommand(
        'standup.generateStandup',
        async () => {
            // Refresh git data first
            await gitTracker.forceRefresh();
            activityTracker.flush();

            const todayData = dataStore.getTodayData();
            const yesterdayData = dataStore.getDayData(getYesterday());

            const standupText = generator.generate(todayData, yesterdayData);

            // Open a new untitled document with the standup
            const doc = await vscode.workspace.openTextDocument({
                content: standupText,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.One
            });

            vscode.window.showInformationMessage(
                '✅ StandUp generated! Copy & paste into Slack/Teams.',
                'Send to Slack',
                'Post to LinkedIn'
            ).then(selection => {
                if (selection === 'Send to Slack') {
                    const plainText = generator.generatePlainText(todayData, yesterdayData);
                    slack.send(plainText);
                } else if (selection === 'Post to LinkedIn') {
                    const plainText = generator.generatePlainText(todayData, yesterdayData);
                    linkedIn.send(plainText);
                }
            });
        }
    );

    // Show Productivity Replay
    const replayCmd = vscode.commands.registerCommand(
        'standup.showReplay',
        async () => {
            await gitTracker.forceRefresh();
            activityTracker.flush();
            const todayData = dataStore.getTodayData();
            ReplayPanel.show(context.extensionUri, todayData);
        }
    );

    // Send to Slack
    const slackCmd = vscode.commands.registerCommand(
        'standup.sendToSlack',
        async () => {
            await gitTracker.forceRefresh();
            activityTracker.flush();

            const todayData = dataStore.getTodayData();
            const yesterdayData = dataStore.getDayData(getYesterday());
            const plainText = generator.generatePlainText(todayData, yesterdayData);
            await slack.send(plainText);
        }
    );

    // Configure Slack
    const configureCmd = vscode.commands.registerCommand(
        'standup.configureSlack',
        () => {
            vscode.commands.executeCommand('standup.connectSlack');
        }
    );

    // Connect Slack (secure setup)
    const connectSlackCmd = vscode.commands.registerCommand(
        'standup.connectSlack',
        async () => {
            const docsChoice = 'Open Slack Webhook Guide';
            const continueChoice = 'I Have Webhook URL';
            const firstStep = await vscode.window.showInformationMessage(
                'To connect Slack, create an Incoming Webhook URL in your Slack app.',
                docsChoice,
                continueChoice
            );

            if (firstStep === docsChoice) {
                await vscode.env.openExternal(vscode.Uri.parse('https://api.slack.com/messaging/webhooks'));
            }

            const webhookUrl = await vscode.window.showInputBox({
                prompt: 'Paste your Slack Incoming Webhook URL',
                placeHolder: 'https://hooks.slack.com/services/XXX/YYY/ZZZ',
                ignoreFocusOut: true,
                password: true,
                validateInput: (value) => {
                    if (!value.trim()) {
                        return 'Webhook URL is required.';
                    }
                    if (!/^https:\/\/hooks\.slack\.com\//.test(value.trim())) {
                        return 'Enter a valid Slack webhook URL.';
                    }
                    return null;
                }
            });

            if (!webhookUrl) {
                return;
            }

            await context.secrets.store('standup.slackWebhookUrl', webhookUrl.trim());
            vscode.window.showInformationMessage('✅ StandUp: Slack connected securely.');
        }
    );

    // Send to LinkedIn
    const linkedInCmd = vscode.commands.registerCommand(
        'standup.sendToLinkedIn',
        async () => {
            await gitTracker.forceRefresh();
            activityTracker.flush();

            const todayData = dataStore.getTodayData();
            const yesterdayData = dataStore.getDayData(getYesterday());
            const plainText = generator.generatePlainText(todayData, yesterdayData);
            await linkedIn.send(plainText);
        }
    );

    // Configure LinkedIn
    const configureLinkedInCmd = vscode.commands.registerCommand(
        'standup.configureLinkedIn',
        () => {
            vscode.commands.executeCommand('standup.connectLinkedIn');
        }
    );

    // Connect LinkedIn (secure setup)
    const connectLinkedInCmd = vscode.commands.registerCommand(
        'standup.connectLinkedIn',
        async () => {
            const openDocs = 'Open LinkedIn App Guide';
            const continueChoice = 'I Have Token';
            const step = await vscode.window.showInformationMessage(
                'To connect LinkedIn, create a LinkedIn app and generate a user access token with posting scope.',
                openDocs,
                continueChoice
            );

            if (step === openDocs) {
                await vscode.env.openExternal(vscode.Uri.parse('https://www.linkedin.com/developers/apps'));
            }

            const accessToken = await vscode.window.showInputBox({
                prompt: 'Paste your LinkedIn Access Token',
                ignoreFocusOut: true,
                password: true,
                validateInput: (value) => value.trim() ? null : 'Access token is required.'
            });
            if (!accessToken) {
                return;
            }

            const authorUrn = await vscode.window.showInputBox({
                prompt: 'Paste your LinkedIn Author URN (example: urn:li:person:xxxx)',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value.trim()) {
                        return 'Author URN is required.';
                    }
                    if (!/^urn:li:person:[A-Za-z0-9_-]+$/.test(value.trim())) {
                        return 'Enter a valid person URN like urn:li:person:xxxx';
                    }
                    return null;
                }
            });
            if (!authorUrn) {
                return;
            }

            await context.secrets.store('standup.linkedinAccessToken', accessToken.trim());
            await context.secrets.store('standup.linkedinAuthorUrn', authorUrn.trim());
            vscode.window.showInformationMessage('✅ StandUp: LinkedIn connected securely.');
        }
    );

    // Clear Today's Data
    const clearCmd = vscode.commands.registerCommand(
        'standup.clearTodayData',
        async () => {
            const confirm = await vscode.window.showWarningMessage(
                'StandUp: Clear all tracked data for today?',
                { modal: true },
                'Clear'
            );
            if (confirm === 'Clear') {
                dataStore.clearToday();
                vscode.window.showInformationMessage('StandUp: Today\'s data cleared.');
            }
        }
    );

    // ─── Scheduler ───────────────────────────────────────
    scheduler = new Scheduler(async () => {
        await gitTracker.forceRefresh();
        activityTracker.flush();

        const todayData = dataStore.getTodayData();
        const yesterdayData = dataStore.getDayData(getYesterday());
        const standupText = generator.generate(todayData, yesterdayData);

        const action = await vscode.window.showInformationMessage(
            '📋 StandUp: Your standup is ready!',
            'View',
            'Send to Slack',
            'Post to LinkedIn',
            'Dismiss'
        );

        if (action === 'View') {
            const doc = await vscode.workspace.openTextDocument({
                content: standupText,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc);
        } else if (action === 'Send to Slack') {
            const plainText = generator.generatePlainText(todayData, yesterdayData);
            await slack.send(plainText);
        } else if (action === 'Post to LinkedIn') {
            const plainText = generator.generatePlainText(todayData, yesterdayData);
            await linkedIn.send(plainText);
        }
    });

    // ─── Register Disposables ────────────────────────────
    context.subscriptions.push(
        generateCmd,
        replayCmd,
        slackCmd,
        configureCmd,
        connectSlackCmd,
        linkedInCmd,
        configureLinkedInCmd,
        connectLinkedInCmd,
        clearCmd,
        activityTracker,
        gitTracker,
        terminalTracker,
        scheduler,
        statusBarItem
    );
}

export function deactivate() {
    console.log('[StandUp] Extension deactivating — saving data...');
    if (activityTracker) { activityTracker.flush(); }
    if (dataStore) { dataStore.flush(); }
}
