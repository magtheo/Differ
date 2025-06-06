import * as vscode from 'vscode';
import * as path from 'path';
import { UIStateManager, PendingChange, ParsedInput } from './stateManager';
import { Logger } from '../utils/logger';

export class DifferProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'differ-panel';
    
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
        this._stateManager.onStateChange((newState) => { // Capture new state for logging
            this._logger.info('State changed, preparing to update webview.', { stateIsLoading: newState.isLoading, error: newState.error, pendingChangesCount: newState.pendingChanges.length });
            this._updateWebview();
        });
        this._logger.info('DifferProvider constructed. Initial state manager isLoading:', this._stateManager.getState().isLoading);
    }
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._logger.info('Resolving webview view.');
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri, // For content under extension's root
                vscode.Uri.joinPath(this._extensionUri, 'out') // Specifically for 'out' directory if needed
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
        // This is crucial: send the state AFTER the webview HTML is set and ready to receive messages.
        this._logger.info('Webview HTML set. Sending initial state to webview.', { initialStateIsLoading: this._stateManager.getState().isLoading });
        this._updateWebview(); 
        
        this._logger.info('WebView resolved and initialized');
    }
    
    public show() {
        if (this._view) {
            this._logger.info('Showing webview panel.');
            this._view.show(true);
        } else {
            this._logger.warn('Attempted to show webview, but it is not available.');
        }
    }
    
    public dispose() {
        this._logger.info('Disposing DifferProvider.');
        this._stateManager.dispose();
    }
    
    public clearChanges() {
        this._logger.info('Clearing pending changes via public method.');
        this._stateManager.clearPendingChanges();
    }
    
    private async _handleMessage(message: any) {
        this._logger.info('Received message from webview', { type: message.type, data: message.data });
        
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
                this._logger.info('Handling clearInput message.');
                this._stateManager.clearInput();
                break;
                
            case 'clearChanges':
                this._logger.info('Handling clearChanges message.');
                this._stateManager.clearPendingChanges();
                break;
                
            default:
                this._logger.warn('Unknown message type received from webview', { type: message.type });
        }
    }
    
    private async _handleParseInput(inputData: { jsonInput: string }) {
        this._logger.info('Starting to parse input', { inputLength: inputData.jsonInput?.length });
        
        this._stateManager.setLoading(true); // Set loading true at the beginning
        this._stateManager.setError(null);   // Clear previous errors
            
        try {
            // Validate input is not empty
            if (!inputData.jsonInput || inputData.jsonInput.trim() === '') {
                throw new Error('Input cannot be empty.');
            }
            
            // Parse JSON with better error handling
            let parsedData: ParsedInput;
            try {
                const rawParsedData = JSON.parse(inputData.jsonInput.trim());
                // Basic validation of ParsedInput structure
                if (!rawParsedData || typeof rawParsedData !== 'object') {
                    throw new Error('Input must be a valid JSON object.');
                }
                parsedData = rawParsedData as ParsedInput; // Cast after basic check
            } catch (parseError) {
                const message = parseError instanceof Error ? parseError.message : String(parseError);
                throw new Error(`Invalid JSON format: ${message}`);
            }
            
            if (!parsedData.changes) {
                throw new Error('Missing required "changes" property in JSON.');
            }
            
            if (!Array.isArray(parsedData.changes)) {
                throw new Error('"changes" property must be an array.');
            }
            
            if (parsedData.changes.length === 0) {
                // Allow empty changes array as a valid parse, but maybe show a message
                this._logger.info('Parsed input contains an empty "changes" array.');
                // vscode.window.showInformationMessage("Parsed input, but no changes were found.");
            }
            
            // Validate each change object (more thoroughly)
            const pendingChanges: PendingChange[] = parsedData.changes.map((change: any, index: number): PendingChange => {
                if (!change.file || typeof change.file !== 'string') {
                    throw new Error(`Change ${index + 1}: Missing or invalid "file" property (must be a string).`);
                }
                if (!change.action || typeof change.action !== 'string') {
                    throw new Error(`Change ${index + 1}: Missing or invalid "action" property (must be a string).`);
                }
                if (change.target === undefined || change.target === null || typeof change.target !== 'string') { // Allow empty string for target
                    throw new Error(`Change ${index + 1}: Missing or invalid "target" property (must be a string).`);
                }
                if (change.code === undefined || change.code === null || typeof change.code !== 'string') { // Allow empty string for code
                    throw new Error(`Change ${index + 1}: Missing or invalid "code" property (must be a string).`);
                }
                if (change.class !== undefined && typeof change.class !== 'string') {
                    throw new Error(`Change ${index + 1}: Invalid "class" property (must be a string if present).`);
                }

                return {
                    id: `change-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`, // Even more unique IDs
                    file: change.file,
                    action: change.action,
                    target: change.target,
                    code: change.code,
                    class: change.class,
                    selected: true, // Default to selected
                    status: 'pending' as const,
                };
            });
            
            // Set parsed input and pending changes
            this._stateManager.setParsedInput(parsedData); // Store the original parsed structure
            this._stateManager.setPendingChanges(pendingChanges);
            
            this._logger.info('Successfully parsed input.', { 
                changeCount: pendingChanges.length,
                description: parsedData.description 
            });
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
            this._logger.error('Failed to parse input', { error: errorMessage, originalError: error });
            this._stateManager.setError(errorMessage);
            // Clear any potentially partially processed data if parsing fails
            this._stateManager.setParsedInput(null);
            this._stateManager.setPendingChanges([]);
        } finally {
            this._stateManager.setLoading(false); // Set loading false at the end
        }
    }
    
    private async _handleApplyChanges(data: { selectedChanges: string[] }) {
        this._logger.info('Handling applyChanges message', { selectedChangeIds: data.selectedChanges });
        this._stateManager.setLoading(true);
        this._stateManager.setError(null);

        const changesToApply = this._stateManager.getSelectedChanges().filter(c => data.selectedChanges.includes(c.id));
        
        try {
            if (changesToApply.length === 0) {
                vscode.window.showWarningMessage("No changes selected to apply.");
                this._logger.warn("Apply changes requested, but no changes were actually selected or found in state.");
                return; // Exit early
            }

            // TODO: Replace with actual change application when built
            this._logger.info(`Executing 'differ.applyChanges' command with ${changesToApply.length} changes.`);
            await vscode.commands.executeCommand('differ.applyChanges', changesToApply); // Pass the actual change objects
            
            // Assuming command handles individual statuses or throws an error for batch failure
            // For now, if command doesn't throw, assume all selected were "applied"
            // A more robust system would get feedback per change.
            changesToApply.forEach(change => {
                this._stateManager.updatePendingChangeStatus(change.id, 'applied');
            });
            vscode.window.showInformationMessage(`Successfully applied ${changesToApply.length} changes (simulated).`);
            this._logger.info(`Simulated application of ${changesToApply.length} changes.`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._logger.error('Failed to apply changes via command', { error: errorMessage, originalError: error });
            this._stateManager.setError(`Apply error: ${errorMessage}`);
            // Optionally mark selected changes as 'failed'
            changesToApply.forEach(change => {
                this._stateManager.updatePendingChangeStatus(change.id, 'failed', errorMessage);
            });
        } finally {
            this._stateManager.setLoading(false);
        }
    }
    
    private async _handlePreviewChange(data: { changeId: string }) {
        this._logger.info('Handling previewChange message (Entered _handlePreviewChange)', { changeId: data.changeId });
        const change = this._stateManager.getState().pendingChanges.find(c => c.id === data.changeId);

        if (!change) {
            this._logger.warn('Preview requested for non-existent change ID', { changeId: data.changeId });
            vscode.window.showErrorMessage(`Cannot preview change: ID ${data.changeId} not found.`);
            return;
        }

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage("No workspace folder open to preview changes.");
                this._logger.warn("Preview failed: No workspace folder open.");
                return;
            }
            // Use the first workspace folder as the root for relative file paths
            const workspaceRoot = workspaceFolders[0].uri;
            const originalFileUri = vscode.Uri.joinPath(workspaceRoot, change.file);

            this._logger.info(`Constructed originalFileUri for preview: ${originalFileUri.fsPath}`, {
                workspaceRoot: workspaceRoot.fsPath,
                changeFile: change.file
            });

            let originalDocument: vscode.TextDocument;
            try {
                originalDocument = await vscode.workspace.openTextDocument(originalFileUri);
            } catch (e: any) {
                this._logger.error(`Failed to open original file for preview: ${originalFileUri.fsPath}`, e);
                vscode.window.showErrorMessage(`File not found or could not be opened: ${change.file}. Cannot generate preview. Error: ${e.message}`);
                return;
            }
            const originalContent = originalDocument.getText();
            let modifiedContent = originalContent; // Start with original content

            let unableToPreviewReason: string | null = null;
            const EOL = originalDocument.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

            // Apply transformations to generate modifiedContent based on change.action
            if (change.action.toLowerCase().includes('replace')) {
                if (change.target && change.target.length > 0) {
                    const targetIndex = originalContent.indexOf(change.target);
                    if (targetIndex !== -1) {
                        // Simple string replacement. This assumes change.target is the exact string of the old code.
                        modifiedContent = originalContent.substring(0, targetIndex) +
                                          change.code +
                                          originalContent.substring(targetIndex + change.target.length);
                    } else {
                        unableToPreviewReason = `Target text to replace was not found in ${change.file}.\nTarget (first 100 chars): "${change.target.substring(0, 100)}..."`;
                        modifiedContent = `// PREVIEW NOTE: ${unableToPreviewReason}${EOL}// Proposed code change below:${EOL}${change.code}${EOL}// --- Original File Content ---${EOL}${originalContent}`;
                    }
                } else {
                    unableToPreviewReason = `'target' for replacement is empty or missing. Cannot determine what to replace.`;
                    modifiedContent = `// PREVIEW NOTE: ${unableToPreviewReason}${EOL}// Proposed code change below:${EOL}${change.code}${EOL}// --- Original File Content ---${EOL}${originalContent}`;
                }
            } else if (change.action.toLowerCase().includes('add') || change.action.toLowerCase().includes('insert')) {
                if (change.target && change.target.toLowerCase().startsWith('line:')) {
                    const lineNumberStr = change.target.substring('line:'.length);
                    const lineNumber = parseInt(lineNumberStr, 10); // 1-indexed

                    if (!isNaN(lineNumber) && lineNumber >= 1) {
                        const lines = originalContent.split(EOL);
                        // Convert 1-indexed lineNumber to 0-indexed spliceIndex
                        // Allow inserting at lines.length (which means after the last line)
                        const spliceIndex = Math.max(0, Math.min(lineNumber - 1, lines.length));

                        lines.splice(spliceIndex, 0, change.code);
                        modifiedContent = lines.join(EOL);
                    } else {
                        unableToPreviewReason = `Invalid line number in target: '${change.target}'. Appending proposed code instead.`;
                        modifiedContent = originalContent + (originalContent.length > 0 ? EOL : '') + `// --- Proposed Code (appended due to invalid line target for '${change.action}') ---${EOL}${change.code}`;
                    }
                } else { // Default 'add' behavior: append to end of file
                    modifiedContent = originalContent + (originalContent.length > 0 ? EOL : '') + change.code;
                }
            } else {
                // Fallback for actions not explicitly handled for precise modification
                unableToPreviewReason = `Action '${change.action}' is not fully supported for precise diff preview. Showing proposed code appended.`;
                modifiedContent = originalContent + (originalContent.length > 0 ? EOL : '') +
                                  `// --- Proposed Code for action '${change.action}' (appended due to limited preview support) ---${EOL}` +
                                  `// Target: ${change.target}${EOL}` +
                                  `${change.code}`;
            }

            if (unableToPreviewReason) {
                this._logger.warn(`Preview limitation for change ${change.id}: ${unableToPreviewReason}`, { change });
                vscode.window.showWarningMessage(`Preview for ${change.file}: ${unableToPreviewReason} The diff view may show explanatory comments.`);
            }

            const diffTitle = `Preview: ${path.basename(change.file)} (${change.action})`;

            // Create an in-memory document for the modified content.
            // VS Code will handle its lifecycle for the diff view.
            const modifiedDoc = await vscode.workspace.openTextDocument({
                content: modifiedContent,
                language: originalDocument.languageId // Use language of original file for syntax highlighting
            });

            // Show the diff
            await vscode.commands.executeCommand('vscode.diff', originalDocument.uri, modifiedDoc.uri, diffTitle);
            this._logger.info(`Showing diff for ${change.id}: ${originalDocument.uri.fsPath} vs. untitled (preview)`);

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._logger.error('Failed to generate preview (outer catch)', { error: errorMessage, originalError: error, changeId: data.changeId });
            // You might want to update the state manager's error here if you have a way to display it for this specific change
            // this._stateManager.updatePendingChangeStatus(data.changeId, 'error', `Preview failed: ${errorMessage}`);
            vscode.window.showErrorMessage(`Failed to generate preview for change ${data.changeId}: ${errorMessage}`);
        }
    }
    
    private _handleToggleChangeSelection(data: { changeId: string, selected: boolean }) {
        this._logger.info('Handling toggleChangeSelection message', data);
        this._stateManager.toggleChangeSelection(data.changeId, data.selected);
    }
    
    private _updateWebview() {
        if (this._view && this._view.visible) { // Only post if view exists and is visible
            const state = this._stateManager.getState();
            this._logger.info('Posting stateUpdate to webview.', { stateIsLoading: state.isLoading, error: state.error, pendingChangesCount: state.pendingChanges.length });
            this._view.webview.postMessage({
                type: 'stateUpdate',
                state: state
            });
        } else {
            this._logger.info('Webview not visible or available, skipping state update.', { viewExists: !!this._view, viewVisible: this._view?.visible });
        }
    }
    
    private _getHtmlForWebview(webview: vscode.Webview): string {
        this._logger.debug('Generating HTML for webview.');
        // Get URIs for local resources
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.css')
        );
        
        // Generate nonce for security
        const nonce = this._getNonce();
        
        this._logger.debug('Webview URIs', { scriptUri: scriptUri.toString(), styleUri: styleUri.toString() });

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta http-equiv="Content-Security-Policy" content="
                default-src 'none';
                style-src ${webview.cspSource} 'unsafe-inline'; 
                script-src 'nonce-${nonce}' 'unsafe-eval';
                font-src ${webview.cspSource};
                img-src ${webview.cspSource} data: https:; 
            ">
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
                            aria-label="JSON input for code changes"
                        ></textarea>
                        <div class="input-buttons">
                            <button id="parseBtn" class="primary" disabled>Parse Changes</button>
                            <button id="clearInputBtn" class="secondary">Clear Input</button>
                        </div>
                    </div>
                </div>
                
                <!-- Status Section -->
                <div id="statusSection" class="section hidden">
                    <div id="loadingIndicator" class="hidden">
                        <div class="spinner" role="status" aria-label="Loading"></div>
                        <span>Processing...</span>
                    </div>
                    <div id="errorMessage" class="error hidden" role="alert"></div>
                    <div id="successMessage" class="success hidden" role="status"></div>
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
                            <button id="clearChangesBtn" class="secondary">Clear All Changes</button>
                        </div>
                    </div>
                    <div id="changesList" class="changes-list" aria-live="polite"></div>
                </div>
                
                <!-- History Section (Placeholder) -->
                <div class="section">
                    <h3>Change History</h3>
                    <div class="history-buttons">
                        <button id="showHistoryBtn" class="secondary" disabled>Show History (WIP)</button>
                        <button id="undoLastBtn" class="secondary" disabled>Undo Last (WIP)</button>
                    </div>
                    <div id="historyList" class="history-list">
                        <p class="placeholder">Change history is not yet available.</p>
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