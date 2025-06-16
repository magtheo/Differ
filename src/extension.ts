// FILE: src/extension.ts
import * as vscode from 'vscode';
import { ChangeParser, ParsedInput, ParsedChange } from './parser/inputParser';
import { DifferProvider } from './ui/webViewProvider';
import { CodeAnalyzer, Position, SymbolInfo } from './analysis/codeAnalyzer';
import { getPreviewFileSystemProvider } from './utils/previewFileSystemProvider';

// Store the provider instance to be accessible by command handlers
let differProviderInstance: DifferProvider | undefined;

/**
 * A change that has been resolved to a specific start and end position in a file.
 */
interface PositionalChange extends ParsedChange {
    start: Position;
    end: Position;
}

// Helper function to convert a 0-based offset to a 1-based line and column Position object
function offsetToPosition(content: string, offset: number): Position {
    if (offset < 0) offset = 0;
    if (offset > content.length) offset = content.length;

    let line = 1;
    let lastNewlineIndex = -1;
    for (let i = 0; i < offset; i++) {
        if (content[i] === '\n') {
            line++;
            lastNewlineIndex = i;
        }
    }
    // column is 1-based. It's the offset relative to the start of the current line.
    const column = offset - lastNewlineIndex;
    return { line, column, offset };
}


export async function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Differ extension is now active!');
    
    // Initialize the CodeAnalyzer with the TreeSitterService
    try {
        console.log('🔄 Initializing CodeAnalyzer...');
        await CodeAnalyzer.initialize(context);
        console.log('✅ CodeAnalyzer initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize CodeAnalyzer:', error);
        vscode.window.showWarningMessage('Differ: Code analysis features may not work properly. Check the output panel for details.');
        // Continue with extension activation even if TreeSitter fails
    }

    // Create and register the webview provider
    const provider = new DifferProvider(context.extensionUri, context);
    differProviderInstance = provider; // Store the instance

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DifferProvider.viewType, provider)
    );

    // Register the preview file system provider
    const previewProvider = getPreviewFileSystemProvider();
    const previewProviderDisposable = vscode.workspace.registerFileSystemProvider('differ-preview', previewProvider, { 
        isCaseSensitive: true,
        isReadonly: false // Allow writes for creating preview files
    });
    
    console.log('📁 Registered differ-preview file system provider');
    context.subscriptions.push(previewProviderDisposable);


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
        throw error; // Re-throw to allow DifferProvider to catch and display it
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
        if (changes.length > 1) {
            throw new Error(`Cannot perform other actions on a file being created in the same batch: ${filePath}`);
        }
        const writeData = Buffer.from(createFileChange.code, 'utf8');
        await vscode.workspace.fs.writeFile(fullPath, writeData);
        console.log(`Created new file: ${filePath}`);
        return;
    }

    let content: string;
    try {
        const fileData = await vscode.workspace.fs.readFile(fullPath);
        content = Buffer.from(fileData).toString('utf8');
    } catch (e) {
        throw new Error(`File ${filePath} does not exist. Use "create_file" action to create it.`);
    }

    const positionalChanges: PositionalChange[] = [];
    for (const change of changes) {
        let symbolInfo: SymbolInfo | undefined;
        let fileAnalysisForAdditions: Awaited<ReturnType<typeof CodeAnalyzer.analyzeFile>> | undefined;

        // Common logic for add actions needing file analysis
        async function ensureFileAnalysis() {
            if (!fileAnalysisForAdditions) {
                fileAnalysisForAdditions = await CodeAnalyzer.analyzeFile(filePath, workspace);
                if (!fileAnalysisForAdditions.isReadable || !fileAnalysisForAdditions.tree) {
                    throw new Error(`Cannot analyze file ${filePath} to add new content.`);
                }
            }
            return fileAnalysisForAdditions;
        }

        switch(change.action) {
            case 'replace_function':
            case 'delete_function': // delete_function implies change.code will be ""
            {
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
                 if (result.exists && result.symbolInfo && result.symbolInfo.end) { // Ensure end is defined
                    // We insert just before the closing brace of the class.
                    // The offset from tree-sitter is exclusive, so end.offset is *after* the last char.
                    const classBodyEndOffset = result.symbolInfo.end.offset - 1; // Point to the '}'
                    if (classBodyEndOffset < 0) throw new Error('Class end offset is invalid.');


                    const lineStartOffset = content.lastIndexOf('\n', classBodyEndOffset -1) + 1; // Line before the closing brace line
                    const previousLine = content.substring(lineStartOffset, content.indexOf('\n', lineStartOffset));
                    const indentation = (previousLine.match(/^\s*/)?.[0] || '    '); // Indent like previous line or default
                    const indentedCode = change.code.split('\n').map(line => indentation + line).join('\n');

                    symbolInfo = { 
                        name: change.target, // Name of the method being added
                        // Insert at the character position of the closing brace of the class
                        start: offsetToPosition(content, classBodyEndOffset),
                        end: offsetToPosition(content, classBodyEndOffset),
                    };
                    change.code = `\n${indentedCode}\n`; // Add newlines around the indented code
                 }
                 break;
            }
            case 'add_function':
            case 'add_struct':
            case 'add_enum':
            {
                const analysis = await ensureFileAnalysis();
                let insertionOffset = analysis.content?.length || 0; // Default to end of file
                const rootNode = analysis.tree?.rootNode;

                if (rootNode && rootNode.namedChildren.length > 0) {
                    const lastChild = rootNode.namedChildren[rootNode.namedChildren.length - 1];
                    insertionOffset = lastChild.endIndex;
                } else if (rootNode && rootNode.children.length > 0) {
                     const lastChild = rootNode.children[rootNode.children.length -1];
                     insertionOffset = lastChild.endIndex;
                }

                const insertionPointPosition = offsetToPosition(analysis.content || "", insertionOffset);
                symbolInfo = {
                    name: change.target,
                    start: insertionPointPosition,
                    end: insertionPointPosition,
                };

                let newCode = change.code;
                if (analysis.content && analysis.content.length > 0) {
                    if (insertionOffset > 0 && !analysis.content.substring(0, insertionOffset).endsWith('\n\n') && !analysis.content.substring(0, insertionOffset).endsWith('\n')) {
                        newCode = '\n\n' + newCode; // Add two newlines if not already well-separated
                    } else if (insertionOffset > 0 && !analysis.content.substring(0, insertionOffset).endsWith('\n')) {
                         newCode = '\n' + newCode; // Add one newline
                    }
                }
                change.code = newCode + '\n'; // Ensure a trailing newline
                break;
            }
            case 'add_import': {
                const analysis = await ensureFileAnalysis();
                let insertionOffset = 0; // Default to start of file

                if (analysis.imports.length > 0) {
                    // analysis.imports contains SymbolInfo for imports.
                    // Their .end.offset should point to the end of the full import statement.
                    const lastImportSymbol = analysis.imports[analysis.imports.length - 1];
                    insertionOffset = lastImportSymbol.end.offset;
                }
                // If no imports, insertionOffset remains 0 (top of the file).

                const insertionPointPosition = offsetToPosition(analysis.content || "", insertionOffset);
                symbolInfo = {
                    name: change.target,
                    start: insertionPointPosition,
                    end: insertionPointPosition,
                };

                let newCode = change.code;
                if (insertionOffset === 0) { // Inserting at the very top
                    newCode = newCode + '\n';
                    // If file has content and doesn't start with newline, add another for separation
                    if (analysis.content && analysis.content.length > 0 && !analysis.content.startsWith('\n')) {
                        newCode = newCode + '\n';
                    }
                } else { // Inserting after existing imports
                    newCode = '\n' + newCode; // Start on a new line
                }
                change.code = newCode;
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
                    // Insert at the end of the target block's actual content.
                    const insertionPointOffset = result.symbolInfo.end.offset;

                    // Determine indentation from the line where the target block starts or exists.
                    const targetStartLineOffset = content.lastIndexOf('\n', result.symbolInfo.start.offset -1) + 1;
                    const targetStartLineContent = content.substring(targetStartLineOffset, result.symbolInfo.start.offset);
                    const indentation = targetStartLineContent.match(/^\s*/)?.[0] || '';
                    
                    const indentedCode = change.code.split('\n').map(line => indentation + line).join('\n');

                    symbolInfo = {
                        name: change.target,
                        start: offsetToPosition(content, insertionPointOffset),
                        end: offsetToPosition(content, insertionPointOffset),
                    };
                    // Ensure the new code starts on a new line relative to the target block.
                    change.code = `\n${indentedCode}`;
                }
                break;
            }
            case 'insert_before': {
                const result = await CodeAnalyzer.validateBlock(filePath, change.target, workspace);
                if (result.exists && result.symbolInfo) {
                    // Insert at the beginning of the target block's actual content.
                    const insertionPointOffset = result.symbolInfo.start.offset;

                    // Determine indentation from the line where the target block starts.
                    const targetStartLineOffset = content.lastIndexOf('\n', result.symbolInfo.start.offset-1) + 1;
                    const targetStartLineContent = content.substring(targetStartLineOffset, result.symbolInfo.start.offset);
                    const indentation = targetStartLineContent.match(/^\s*/)?.[0] || '';
                    
                    const indentedCode = change.code.split('\n').map(line => indentation + line).join('\n');

                    symbolInfo = {
                        name: change.target,
                        start: offsetToPosition(content, insertionPointOffset),
                        end: offsetToPosition(content, insertionPointOffset),
                    };
                    // Ensure the new code ends with a newline to separate from the target block.
                    change.code = `${indentedCode}\n`;
                }
                break;
            }
        }
        
        if (symbolInfo) {
            positionalChanges.push({ ...change, start: symbolInfo.start, end: symbolInfo.end });
        } else {
            throw new Error(`Could not find target or determine insertion point for action '${change.action}' on '${change.target || change.description || 'unknown target'}' in file ${filePath}.`);
        }
    }

    positionalChanges.sort((a, b) => b.start.offset - a.start.offset);

    let modifiedContent = content;
    for (const change of positionalChanges) {
        modifiedContent = applySingleChangeToContent(modifiedContent, change);
    }

    const writeData = Buffer.from(modifiedContent, 'utf8');
    await vscode.workspace.fs.writeFile(fullPath, writeData);
    console.log(`Applied ${changes.length} modifications to ${filePath}`);
}


function applySingleChangeToContent(content: string, change: PositionalChange): string {
    console.log('🔧 ===========================');
    console.log('🔧 APPLYING CHANGE TO CONTENT');
    console.log('🔧 Action:', change.action);
    console.log('🔧 Target:', change.target.substring(0, 50));
    console.log('🔧 Start offset:', change.start.offset);
    console.log('🔧 End offset:', change.end.offset);
    console.log('🔧 Content length:', content.length);
    console.log('🔧 Replacement length:', change.code.length);
    console.log('🔧 ===========================');
    
    // Validate offsets
    if (change.start.offset < 0 || change.end.offset > content.length || change.start.offset > change.end.offset) {
        console.error('❌ INVALID OFFSETS!');
        console.error('   Start:', change.start.offset);
        console.error('   End:', change.end.offset);
        console.error('   Content length:', content.length);
        throw new Error(`Invalid offsets: start=${change.start.offset}, end=${change.end.offset}, contentLength=${content.length}`);
    }
    
    // Extract the content that will be replaced for debugging
    const contentToReplace = content.slice(change.start.offset, change.end.offset);
    console.log('📝 CONTENT BEING REPLACED:');
    console.log('---START ORIGINAL---');
    console.log(contentToReplace);
    console.log('---END ORIGINAL---');
    
    console.log('📝 REPLACEMENT CONTENT:');
    console.log('---START REPLACEMENT---');
    console.log(change.code);
    console.log('---END REPLACEMENT---');
    
    switch (change.action) {
        case 'replace_function':
        case 'replace_method':
        case 'replace_block':
        case 'delete_function':
            const before = content.slice(0, change.start.offset);
            const after = content.slice(change.end.offset);
            const result = before + change.code + after;
            
            console.log('✅ REPLACEMENT OPERATION COMPLETE');
            console.log('   Before length:', before.length);
            console.log('   Replacement length:', change.code.length);
            console.log('   After length:', after.length);
            console.log('   Result length:', result.length);
            
            // Show some context around the change
            const contextStart = Math.max(0, change.start.offset - 50);
            const contextEnd = Math.min(result.length, change.start.offset + change.code.length + 50);
            console.log('📋 RESULT CONTEXT:');
            console.log('---START CONTEXT---');
            console.log(result.substring(contextStart, contextEnd));
            console.log('---END CONTEXT---');
            
            return result;
        
        default:
            // Handle other actions...
            return content.slice(0, change.start.offset) + change.code + content.slice(change.start.offset);
    }
}

export function deactivate() {
    console.log('👋 Differ extension deactivated');
    differProviderInstance = undefined;
}