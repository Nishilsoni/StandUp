import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

/**
 * Sends standup updates to Slack via Incoming Webhook.
 */
export class SlackIntegration {
    constructor(private readonly secrets: vscode.SecretStorage) {}

    /**
     * Send a standup message to the configured Slack webhook.
     */
    async send(standupText: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('standup');
        const storedWebhook = await this.secrets.get('standup.slackWebhookUrl');
        const webhookUrl = storedWebhook || config.get<string>('slackWebhookUrl', '');

        if (!webhookUrl) {
            const configure = 'Connect Slack';
            const result = await vscode.window.showWarningMessage(
                'StandUp: No Slack webhook URL configured.',
                configure
            );
            if (result === configure) {
                vscode.commands.executeCommand(
                    'standup.connectSlack'
                );
            }
            return;
        }

        try {
            await this.postToWebhook(webhookUrl, standupText);
            vscode.window.showInformationMessage('✅ StandUp: Sent to Slack!');
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`StandUp: Failed to send to Slack — ${errMsg}`);
        }
    }

    private postToWebhook(webhookUrl: string, text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({
                text: text,
                // Use mrkdwn formatting
                mrkdwn: true
            });

            const url = new URL(webhookUrl);
            const transport = url.protocol === 'https:' ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const req = transport.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.write(payload);
            req.end();
        });
    }
}
