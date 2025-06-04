import * as vscode from 'vscode';
import { DifferProvider } from './ui/webViewProvider';
import { Logger } from './utils/logger';

let logger: Logger;
let webViewProvider: DifferProvider;

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger first
    logger = new Logger('Differ');
    logger.info('Extension activation started');

    try {
        // Initialize modules
        initializeModules(context);
        
        // Register commands
        registerCommands(context);
        
        // Register web view provider
        registerWebViewProvider(context);
        
        logger.info('Extension activated successfully');
        
        // Show welcome message on first activation
        const hasShownWelcome = context.globalState.get('hasShownWelcome', false);
        if (!hasShownWelcome) {
            vscode.window.showInformationMessage(
                'Differ is ready! Open the panel from the Activity Bar to get started.',
                'Open Panel'
            ).then(selection => {
                if (selection === 'Open Panel') {
                    vscode.commands.executeCommand('differ.openPanel');
                }
            });
            context.globalState.update('hasShownWelcome', true);
        }
        
    } catch (error) {
        logger.error('Failed to activate extension', error);
        vscode.window.showErrorMessage(`Failed to activate Differ: ${error}`);
    }
}

export function deactivate() {
    logger?.info('Extension deactivating');
    
    // Clean up resources
    webViewProvider?.dispose();
    
    logger?.info('Extension deactivated');
}

function initializeModules(context: vscode.ExtensionContext) {
    logger.info('Initializing modules');
    
    // Initialize web view provider
    webViewProvider = new DifferProvider(context.extensionUri, context);
    
    // TODO: Initialize other modules as we build them
    // - inputProcessor = new InputProcessor();
    // - codeAnalysisEngine = new CodeAnalysisEngine();
    // - changeEngine = new ChangeEngine();
    // - storageSystem = new StorageSystem(context);
    
    logger.info('Modules initialized');
}

function registerCommands(context: vscode.ExtensionContext) {
    logger.info('Registering commands');
    
    // Main panel command
    const openPanelCommand = vscode.commands.registerCommand('differ.openPanel', () => {
        webViewProvider.show();
    });
    
    // Apply changes command (will be called from webview)
    const applyChangesCommand = vscode.commands.registerCommand('differ.applyChanges', async (changes) => {
        try {
            logger.info('Apply changes command triggered', { changeCount: changes?.length });
            // TODO: Implement change application logic
            vscode.window.showInformationMessage(`Ready to apply ${changes?.length || 0} changes (not yet implemented)`);
        } catch (error) {
            logger.error('Failed to apply changes', error);
            vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
        }
    });
    
    // Clear changes command
    const clearChangesCommand = vscode.commands.registerCommand('differ.clearChanges', () => {
        webViewProvider.clearChanges();
        vscode.window.showInformationMessage('Pending changes cleared');
    });
    
    // Show change history command
    const showHistoryCommand = vscode.commands.registerCommand('differ.showHistory', () => {
        // TODO: Implement history display
        vscode.window.showInformationMessage('Change history (not yet implemented)');
    });
    
    // Undo last changes command
    const undoChangesCommand = vscode.commands.registerCommand('differ.undoLastChanges', () => {
        // TODO: Implement undo functionality
        vscode.window.showInformationMessage('Undo changes (not yet implemented)');
    });
    
    // Add commands to disposal
    context.subscriptions.push(
        openPanelCommand,
        applyChangesCommand,
        clearChangesCommand,
        showHistoryCommand,
        undoChangesCommand
    );
    
    logger.info('Commands registered');
}

function registerWebViewProvider(context: vscode.ExtensionContext) {
    logger.info('Registering web view provider');
    
    // Register the web view provider in the activity bar
    const provider = vscode.window.registerWebviewViewProvider(
        'differ-panel',
        webViewProvider,
        {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }
    );
    
    context.subscriptions.push(provider);
    
    logger.info('Web view provider registered');
}

// Export for use in other modules
export function getLogger(): Logger {
    return logger;
}

export function getWebViewProvider(): DifferProvider {
    return webViewProvider;
}