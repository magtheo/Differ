// FILE: src/extension.ts
import * as vscode from 'vscode';
import { ChangeParser, ParsedInput, ParsedChange } from './parser/inputParser';
import { DifferProvider } from './ui/webViewProvider';
import { CodeAnalyzer, Position, SymbolInfo } from './analysis/codeAnalyzer';

// Store the provider instance to be accessible by command handlers
let differProviderInstance: DifferProvider | undefined;

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

    // Create and register the webview provider
    const provider = new DifferProvider(context.extensionUri, context);
    differProviderInstance = provider; // Store the instance

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DifferProvider.viewType, provider)
    );

    // Register commands. All interaction logic is now initiated from the webview.
    const commands = [
        vscode.commands.registerCommand('differ.openPanel', () => provider.show()),
        vscode.commands.registerCommand('differ.applyChanges', (inputFromWebview?: ParsedInput) => {
            if (!inputFromWebview) {
                console.warn('applyChanges called without effective input. The webview should always provide it.');
                vscode.window.showWarningMessage('No changes to apply. Please parse input in the Differ panel.');
                return;
            }
            applyChanges(inputFromWebview);
        }),
        vscode.commands.registerCommand('differ.clearChanges', () => {
            if (differProviderInstance) {
                differProviderInstance.clearChanges();
                vscode.window.showInformationMessage('Differ changes cleared.');
            }
        }),
    ];

    context.subscriptions.push(...commands);

    // Register commands for the view title bar
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

    // Placeholder commands for future features
    context.subscriptions.push(
        vscode.commands.registerCommand('differ.showHistory', () => {
            vscode.window.showInformationMessage('Differ: Show Change History - Not yet implemented.');
        }),
        vscode.commands.registerCommand('differ.undoLastChanges', () => {
            vscode.window.showInformationMessage('Differ: Undo Last Changes - Not yet implemented.');
        })
    );
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

    // --- Phase 1: Pre-computation Step ---
    const positionalChanges: PositionalChange[] = [];
    for (const change of changes) {
        let symbolInfo: SymbolInfo | undefined;

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
            case 'add_method': {
                 if (!change.class) throw new Error(`Action 'add_method' requires a CLASS for target '${change.target}'.`);
                 const result = await CodeAnalyzer.validateClass(filePath, change.class, workspace);
                 if (result.exists && result.symbolInfo) {
                    // We insert just before the closing brace of the class.
                    const classBodyEndOffset = result.symbolInfo.end.offset - 1;

                    // Determine indentation from the line before the class closing brace
                    const lineStartOffset = content.lastIndexOf('\n', classBodyEndOffset) + 1;
                    const previousLine = content.substring(lineStartOffset, classBodyEndOffset);
                    const indentation = (previousLine.match(/^\s*/)?.[0] || '    ');
                    const indentedCode = change.code.split('\n').map(line => indentation + line).join('\n');

                    symbolInfo = { 
                        name: change.target,
                        start: { ...result.symbolInfo.end, offset: classBodyEndOffset },
                        end: { ...result.symbolInfo.end, offset: classBodyEndOffset },
                    };
                    change.code = `\n${indentedCode}\n`; // Add newlines around the indented code
                 }
                 break;
            }
            case 'replace_block': {
                const result = await CodeAnalyzer.validateBlock(filePath, change.target, workspace);
                if (result.exists && result.symbolInfo) symbolInfo = result.symbolInfo;
                break;
            }
            case 'insert_after': {
                const result = await CodeAnalyzer.validateBlock(filePath, change.target, workspace);
                if (result.exists && result.symbolInfo) {
                    const eolIndex = content.indexOf('\n', result.symbolInfo.end.offset);
                    const insertionPoint = eolIndex !== -1 ? eolIndex + 1 : content.length;

                    const lineStartOffset = content.lastIndexOf('\n', result.symbolInfo.start.offset) + 1;
                    const lineContentBeforeTarget = content.substring(lineStartOffset, result.symbolInfo.start.offset);
                    const indentation = lineContentBeforeTarget.match(/^\s*/)?.[0] || '';
                    
                    const indentedCode = change.code.split('\n').map(line => indentation + line).join('\n');

                    symbolInfo = {
                        name: change.target,
                        start: { ...result.symbolInfo.end, offset: insertionPoint },
                        end: { ...result.symbolInfo.end, offset: insertionPoint },
                    };
                    change.code = `${indentedCode}\n`;
                }
                break;
            }
            case 'insert_before': {
                const result = await CodeAnalyzer.validateBlock(filePath, change.target, workspace);
                if (result.exists && result.symbolInfo) {
                    const insertionPoint = content.lastIndexOf('\n', result.symbolInfo.start.offset - 1) + 1;

                    const lineContentBeforeTarget = content.substring(insertionPoint, result.symbolInfo.start.offset);
                    const indentation = lineContentBeforeTarget.match(/^\s*/)?.[0] || '';
                    
                    const indentedCode = change.code.split('\n').map(line => indentation + line).join('\n');

                    symbolInfo = {
                        name: change.target,
                        start: { ...result.symbolInfo.start, offset: insertionPoint },
                        end: { ...result.symbolInfo.start, offset: insertionPoint },
                    };
                    change.code = `${indentedCode}\n`;
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
        case 'replace_block':
            // Replace the entire block from its start to its end.
            return content.slice(0, start.offset) + code + content.slice(end.offset);
        
        case 'add_method':
        case 'insert_after':
        case 'insert_before':
            // For insertion actions, start and end offsets are the same point.
            // We replace a zero-length string at the start offset with the new code.
            return content.slice(0, start.offset) + code + content.slice(start.offset);

        // Add other actions here...
        // case 'add_import':
        // case 'add_function':

        default:
            console.warn(`Unsupported positional action: ${action}`);
            return content;
    }
}

export function deactivate() {
    console.log('👋 Differ extension deactivated');
    differProviderInstance = undefined;
}