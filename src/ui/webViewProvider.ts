import * as vscode from 'vscode';
import * as path from 'path';
import { UIStateManager } from './stateManager';
import { Logger } from '../utils/logger';

export class DifferProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'llm-code-patcher-panel';
    
    private _view?: vscode.WebviewView;
    private _stateManager: UIStateManager;
    private _logger: Logger;
    
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        this._logger = new Logger('WebViewProvider');
        this._stateManager = new UIStateManager();
        
        // Listen to state changes and update webview
        this._stateManager.onStateChange(() => {
            this._updateWebview();
        });
    }
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };
        
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            undefined,
            this._context.subscriptions
        );
        
        // Initialize with current state
        this._updateWebview();
        
        this._logger.info('WebView resolved and initialized');
    }
    
    public show() {
        if (this._view) {
            this._view.show(true);
        }
    }
    
    public dispose() {
        this._stateManager.dispose();
    }
    
    public clearChanges() {
        this._stateManager.clearPendingChanges();
    }
    
    private async _handleMessage(message: any) {
        this._logger.info('Received message from webview', { type: message.type });
        
        switch (message.type) {
            case 'parseInput':
                await this._handleParseInput(message.data);
                break;
                
            case 'applyChanges':
                await this._handleApplyChanges(message.data);
                break;
                
            case 'previewChange':
                await this._handlePreviewChange(message.data);
                break;
                
            case 'toggleChangeSelection':
                this._handleToggleChangeSelection(message.data);
                break;
                
            case 'clearInput':
                this._stateManager.clearInput();
                break;
                
            case 'clearChanges':
                this._stateManager.clearPendingChanges();
                break;
                
            default:
                this._logger.warn('Unknown message type received', { type: message.type });
        }
    }
    
    private async _handleParseInput(inputData: { jsonInput: string }) {
        try {
            this._stateManager.setLoading(true);
            
            // TODO: Replace with actual JSON parser when built
            const parsedData = JSON.parse(inputData.jsonInput);
            
            // Basic validation
            if (!parsedData.changes || !Array.isArray(parsedData.changes)) {
                throw new Error('Invalid format: "changes" array is required');
            }
            
            // Set parsed changes
            this._stateManager.setParsedInput(parsedData);
            this._stateManager.setPendingChanges(parsedData.changes.map((change: any, index: number) => ({
                ...change,
                id: `change-${index}`,
                selected: true,
                status: 'pending'
            })));
            
            this._stateManager.setError(null);
            
        } catch (error) {
            this._logger.error('Failed to parse input', error);
            this._stateManager.setError(`Parse error: ${error}`);
        } finally {
            this._stateManager.setLoading(false);
        }
    }
    
    private async _handleApplyChanges(data: { selectedChanges: string[] }) {
        try {
            this._stateManager.setLoading(true);
            
            // TODO: Replace with actual change application when built
            await vscode.commands.executeCommand('llm-code-patcher.applyChanges', data.selectedChanges);
            
            // Mark changes as applied (for now just show success)
            this._stateManager.setError(null);
            
        } catch (error) {
            this._logger.error('Failed to apply changes', error);
            this._stateManager.setError(`Apply error: ${error}`);
        } finally {
            this._stateManager.setLoading(false);
        }
    }
    
    private async _handlePreviewChange(data: { changeId: string }) {
        try {
            // TODO: Implement actual preview generation when diff engine is built
            this._logger.info('Preview requested for change', { changeId: data.changeId });
            
            // For now, just show a placeholder
            vscode.window.showInformationMessage(`Preview for change ${data.changeId} (not yet implemented)`);
            
        } catch (error) {
            this._logger.error('Failed to generate preview', error);
            this._stateManager.setError(`Preview error: ${error}`);
        }
    }
    
    private _handleToggleChangeSelection(data: { changeId: string, selected: boolean }) {
        this._stateManager.toggleChangeSelection(data.changeId, data.selected);
    }
    
    private _updateWebview() {
        if (this._view) {
            const state = this._stateManager.getState();
            this._view.webview.postMessage({
                type: 'stateUpdate',
                state: state
            });
        }
    }
    
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get URIs for local resources
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.css')
        );
        
        // Generate nonce for security
        const nonce = this._getNonce();
        
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <link href="${styleUri}" rel="stylesheet">
            <title>LLM Code Patcher</title>
        </head>
        <body>
            <div id="app">
                <!-- Input Section -->
                <div class="section">
                    <h3>Input JSON Changes</h3>
                    <div class="input-container">
                        <textarea 
                            id="jsonInput" 
                            placeholder="Paste LLM-generated JSON changes here..."
                            rows="8"
                        ></textarea>
                        <div class="input-buttons">
                            <button id="parseBtn" class="primary">Parse Changes</button>
                            <button id="clearInputBtn" class="secondary">Clear</button>
                        </div>
                    </div>
                </div>
                
                <!-- Status Section -->
                <div id="statusSection" class="section hidden">
                    <div id="loadingIndicator" class="hidden">
                        <div class="spinner"></div>
                        <span>Processing...</span>
                    </div>
                    <div id="errorMessage" class="error hidden"></div>
                    <div id="successMessage" class="success hidden"></div>
                </div>
                
                <!-- Pending Changes Section -->
                <div id="changesSection" class="section hidden">
                    <h3>Pending Changes</h3>
                    <div class="changes-header">
                        <div class="changes-info">
                            <span id="changesCount">0 changes</span>
                            <span id="selectedCount">0 selected</span>
                        </div>
                        <div class="changes-buttons">
                            <button id="applySelectedBtn" class="primary" disabled>Apply Selected</button>
                            <button id="clearChangesBtn" class="secondary">Clear All</button>
                        </div>
                    </div>
                    <div id="changesList" class="changes-list"></div>
                </div>
                
                <!-- History Section -->
                <div class="section">
                    <h3>Change History</h3>
                    <div class="history-buttons">
                        <button id="showHistoryBtn" class="secondary">Show History</button>
                        <button id="undoLastBtn" class="secondary">Undo Last</button>
                    </div>
                    <div id="historyList" class="history-list">
                        <p class="placeholder">No changes applied yet</p>
                    </div>
                </div>
            </div>
            
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }
    
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}