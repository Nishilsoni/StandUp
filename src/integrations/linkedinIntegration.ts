import * as vscode from 'vscode';
import * as https from 'https';

/**
 * Sends standup updates to LinkedIn via LinkedIn UGC API.
 */
export class LinkedInIntegration {
    constructor(private readonly secrets: vscode.SecretStorage) {}

    /**
     * Send a standup message to LinkedIn.
     */
    async send(standupText: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('standup');
        const storedAccessToken = await this.secrets.get('standup.linkedinAccessToken');
        const storedAuthorUrn = await this.secrets.get('standup.linkedinAuthorUrn');
        const accessToken = storedAccessToken || config.get<string>('linkedinAccessToken', '');
        const authorUrn = storedAuthorUrn || config.get<string>('linkedinAuthorUrn', '');

        if (!accessToken || !authorUrn) {
            const configure = 'Connect LinkedIn';
            const result = await vscode.window.showWarningMessage(
                'StandUp: LinkedIn is not fully configured. Please set access token and author URN.',
                configure
            );
            if (result === configure) {
                vscode.commands.executeCommand(
                    'standup.connectLinkedIn'
                );
            }
            return;
        }

        try {
            await this.postUpdate(accessToken, authorUrn, standupText);
            vscode.window.showInformationMessage('✅ StandUp: Posted to LinkedIn!');
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`StandUp: Failed to post to LinkedIn — ${errMsg}`);
        }
    }

    private postUpdate(accessToken: string, authorUrn: string, text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({
                author: authorUrn,
                lifecycleState: 'PUBLISHED',
                specificContent: {
                    'com.linkedin.ugc.ShareContent': {
                        shareCommentary: {
                            text
                        },
                        shareMediaCategory: 'NONE'
                    }
                },
                visibility: {
                    'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
                }
            });

            const req = https.request({
                hostname: 'api.linkedin.com',
                path: '/v2/ugcPosts',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'X-Restli-Protocol-Version': '2.0.0',
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            }, (res) => {
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
