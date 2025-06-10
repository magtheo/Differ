// FILE: src/extension.ts
import * as vscode from 'vscode';
import { ChangeParser, ParsedInput, ValidationResult, ParsedChange } from './parser/inputParser';
import { DifferProvider } from './ui/webViewProvider';
import { CodeAnalyzer, Position, SymbolInfo } from './analysis/codeAnalyzer';

// Store the provider instance to be accessible by command handlers
let differProviderInstance: DifferProvider | undefined;

interface DifferState { // This state is for the legacy command palette flow, less relevant for webview-centric actions
    parsedInput: ParsedInput | null;
    lastValidationResult: ValidationResult | null;
    previewContent: string | null;
}

/**
 * A change that has been resolved to a specific start and end position in a file.
 */
interface PositionalChange extends ParsedChange {
    start: Position;
    end: Position;
}


export async function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Differ extension is now active!');
    
    // Initialize the CodeAnalyzer with the TreeSitterService
    await CodeAnalyzer.initialize(context);

    // Extension state (for legacy command palette flow)
    const state: DifferState = {
        parsedInput: null,
        lastValidationResult: null,
        previewContent: null
    };

    // Create and register the webview provider
    const provider = new DifferProvider(context.extensionUri, context);
    differProviderInstance = provider; // Store the instance

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DifferProvider.viewType, provider)
    );

    // Register existing commands
    const existingCommands = [
        vscode.commands.registerCommand('differ.openPanel', () => provider.show()),
        vscode.commands.registerCommand('differ.applyChanges', (inputFromWebview?: ParsedInput) => {
            const effectiveInput = inputFromWebview || state.parsedInput;
            if (!effectiveInput) {
                console.warn('applyChanges called without effective input. Webview should provide it.');
                vscode.window.showWarningMessage('No changes to apply. Please parse input in the Differ panel.');
                return;
            }
            applyChanges(effectiveInput);
        }),
        vscode.commands.registerCommand('differ.clearChanges', () => {
            clearChanges(state);
            provider.clearChanges();
        }),
        vscode.commands.registerCommand('differ.parseInput', () => parseUserInput(state)),
        vscode.commands.registerCommand('differ.previewChanges', () => previewChanges(state))
    ];

    context.subscriptions.push(...existingCommands);

    // Register NEW commands for the view title bar
    const viewTitleCommands = [
        vscode.commands.registerCommand('differ.view.showExample', async () => {
            const example = ChangeParser.generateExample();
            const doc = await vscode.workspace.openTextDocument({ content: example, language: 'plaintext' });
            await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        }),
        vscode.commands.registerCommand('differ.view.showHelp', async () => {
            const documentation = ChangeParser.getFormatDocumentation();
            const doc = await vscode.workspace.openTextDocument({ content: documentation, language: 'markdown' });
            await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        }),
        vscode.commands.registerCommand('differ.view.toggleQuickStart', () => {
            if (differProviderInstance) {
                differProviderInstance.requestToggleQuickStart();
            } else {
                vscode.window.showErrorMessage('Differ panel is not available to toggle Quick Start.');
            }
        })
    ];
    context.subscriptions.push(...viewTitleCommands);

    // Legacy commands (Show History, Undo) - these are placeholders as per your package.json
    context.subscriptions.push(
        vscode.commands.registerCommand('differ.showHistory', () => {
            vscode.window.showInformationMessage('Differ: Show Change History - Not yet implemented.');
        }),
        vscode.commands.registerCommand('differ.undoLastChanges', () => {
            vscode.window.showInformationMessage('Differ: Undo Last Changes - Not yet implemented.');
        })
    );
}

// Legacy function, might be refactored or removed if webview handles all parsing initiation
async function parseUserInput(state: DifferState) {
    // ... implementation remains the same
}

// Legacy function
async function previewChanges(state: DifferState) {
    // ... implementation remains the same
}

async function showPreview(content: string) {
    // ... implementation remains the same
}

async function applyChanges(input: ParsedInput) {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    // Confirmation dialog logic remains the same...
    const confirmResult = await vscode.window.showWarningMessage(
        `Apply ${input.changes.length} changes to ${[...new Set(input.changes.map(c => c.file))].length} files?`,
        { modal: true },
        'Apply Changes', 'Cancel'
    );
    if (confirmResult !== 'Apply Changes') {
        return;
    }

    try {
        vscode.window.showInformationMessage('Applying changes...');
        await applyParsedChanges(input, workspace);
        
        vscode.window.showInformationMessage('Changes applied successfully!');
        
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to apply changes: ${message}`);
        throw error;
    }
}

async function applyParsedChanges(input: ParsedInput, workspace: vscode.WorkspaceFolder) {
    const groupedChanges = ChangeParser.groupChangesByFile(input);
    for (const [filePath, changes] of groupedChanges) {
        await applyChangesToFile(filePath, changes, workspace);
    }
}

/**
 * Applies a set of changes to a single file using positional, AST-based logic.
 */
async function applyChangesToFile(filePath: string, changes: ParsedChange[], workspace: vscode.WorkspaceFolder) {
    const fullPath = vscode.Uri.joinPath(workspace.uri, filePath);

    const createFileChange = changes.find(c => c.action === 'create_file');
    if (createFileChange) {
        // If creating a file, no other actions should be present for this file.
        if (changes.length > 1) {
            throw new Error(`Cannot perform other actions on a file being created in the same batch: ${filePath}`);
        }
        const writeData = Buffer.from(createFileChange.code, 'utf8');
        await vscode.workspace.fs.writeFile(fullPath, writeData);
        console.log(`Created new file: ${filePath}`);
        return;
    }

    // Read the original file content.
    let content: string;
    try {
        const fileData = await vscode.workspace.fs.readFile(fullPath);
        content = Buffer.from(fileData).toString('utf8');
    } catch (e) {
        throw new Error(`File ${filePath} does not exist. Use "create_file" action to create it.`);
    }

    // --- Phase 2: Pre-computation Step ---
    const positionalChanges: PositionalChange[] = [];
    for (const change of changes) {
        const validationResult = await CodeAnalyzer.validateFunction(filePath, change.target, workspace); // Example, needs to be generic
        
        let symbolInfo: SymbolInfo | undefined;

        // This switch should be more robust, delegating to the right CodeAnalyzer method.
        switch(change.action) {
            case 'replace_function': {
                const result = await CodeAnalyzer.validateFunction(filePath, change.target, workspace);
                if (result.exists && result.symbolInfo) symbolInfo = result.symbolInfo;
                break;
            }
            case 'replace_method': {
                if (!change.class) throw new Error(`Action 'replace_method' requires a CLASS for target '${change.target}'.`);
                const result = await CodeAnalyzer.validateMethod(filePath, change.class, change.target, workspace);
                if (result.exists && result.symbolInfo) symbolInfo = result.symbolInfo;
                break;
            }
            // Add other cases for add_function, add_method, etc.
            // For add_method, the target is the class, so we need its end position.
            case 'add_method': {
                 if (!change.class) throw new Error(`Action 'add_method' requires a CLASS for target '${change.target}'.`);
                 const result = await CodeAnalyzer.validateClass(filePath, change.class, workspace);
                 if (result.exists && result.symbolInfo) {
                    // We insert just before the closing brace of the class.
                    const classBodyEndOffset = result.symbolInfo.end.offset - 1;
                    symbolInfo = { 
                        name: change.target,
                        start: { ...result.symbolInfo.end, offset: classBodyEndOffset },
                        end: { ...result.symbolInfo.end, offset: classBodyEndOffset },
                    };
                    change.code = `\n    ${change.code}\n`; // Add some formatting
                 }
                 break;
            }
        }
        
        if (symbolInfo) {
            positionalChanges.push({ ...change, start: symbolInfo.start, end: symbolInfo.end });
        } else {
            throw new Error(`Could not find target for action '${change.action}' on '${change.target}' in file ${filePath}.`);
        }
    }

    // --- Phase 2: Sort and Apply ---
    // Sort changes in REVERSE order by start offset. This is critical.
    positionalChanges.sort((a, b) => b.start.offset - a.start.offset);

    let modifiedContent = content;
    for (const change of positionalChanges) {
        modifiedContent = applySingleChangeToContent(modifiedContent, change);
    }

    // Write the fully modified content back to the file once.
    const writeData = Buffer.from(modifiedContent, 'utf8');
    await vscode.workspace.fs.writeFile(fullPath, writeData);
    console.log(`Applied ${changes.length} modifications to ${filePath}`);
}

/**
 * Applies a single, positionally-aware change to the file content.
 * This function no longer performs any searches.
 */
function applySingleChangeToContent(content: string, change: PositionalChange): string {
    const { start, end, code, action } = change;

    switch (action) {
        case 'replace_function':
        case 'replace_method':
            // Replace the entire block from its start to its end.
            return content.slice(0, start.offset) + code + content.slice(end.offset);
        
        case 'add_method':
            // Insert the new method at the calculated position (just before class closing brace).
            return content.slice(0, start.offset) + code + content.slice(end.offset);

        // Add other actions here...
        // case 'add_import':
        // case 'add_function':

        default:
            console.warn(`Unsupported positional action: ${action}`);
            return content;
    }
}

function clearChanges(state: DifferState) {
    state.parsedInput = null;
    state.lastValidationResult = null;
    state.previewContent = null;
    vscode.window.showInformationMessage('Legacy state cleared.');
}

export function deactivate() {
    console.log('👋 Differ extension deactivated');
    differProviderInstance = undefined;
}