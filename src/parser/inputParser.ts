import * as vscode from 'vscode';

export interface ParsedChange {
    file: string;           // Target file path (may not exist yet)
    action: ChangeAction;
    target: string;         // Function name, import name, etc.
    code: string;           // New code to apply
    description?: string;
}

export interface ParsedInput {
    description: string;
    changes: ParsedChange[];
    metadata?: {
        totalChanges: number;
        affectedFiles: string[];
        hasNewFiles: boolean;
    };
}

export type ChangeAction = 
    | 'add_import'
    | 'replace_function' 
    | 'add_function'
    | 'add_struct'
    | 'add_enum'
    | 'replace_block'
    | 'insert_after'
    | 'insert_before'
    | 'delete_function'
    | 'modify_line';

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

export class ChangeParser {
    
    /**
     * Parse JSON input WITHOUT validating file existence
     * This allows for target files that don't exist yet
     */
    public static parseInput(jsonContent: string): ParsedInput {
        try {
            const rawInput = JSON.parse(jsonContent);
            
            // Validate basic structure
            if (!rawInput.changes || !Array.isArray(rawInput.changes)) {
                throw new Error('Input must contain a "changes" array');
            }

            const changes: ParsedChange[] = [];
            const affectedFiles = new Set<string>();

            for (const change of rawInput.changes) {
                const parsedChange = this.parseChange(change);
                changes.push(parsedChange);
                affectedFiles.add(parsedChange.file);
            }

            // Calculate metadata
            const metadata = {
                totalChanges: changes.length,
                affectedFiles: Array.from(affectedFiles),
                hasNewFiles: this.detectNewFiles(Array.from(affectedFiles))
            };

            return {
                description: rawInput.description || 'Code changes',
                changes,
                metadata
            };

        } catch (error) {
            throw new Error(`Failed to parse input: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Parse individual change object
     */
    private static parseChange(change: any): ParsedChange {
        // Validate required fields
        const requiredFields = ['file', 'action', 'target', 'code'];
        for (const field of requiredFields) {
            if (!change[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }

        // Validate action type
        const validActions: ChangeAction[] = [
            'add_import', 'replace_function', 'add_function', 'add_struct', 
            'add_enum', 'replace_block', 'insert_after', 'insert_before',
            'delete_function', 'modify_line'
        ];

        if (!validActions.includes(change.action)) {
            throw new Error(`Invalid action: ${change.action}. Valid actions: ${validActions.join(', ')}`);
        }

        return {
            file: change.file.trim(),
            action: change.action as ChangeAction,
            target: change.target.trim(),
            code: change.code,
            description: change.description
        };
    }

    /**
     * Validate parsed input structure (NOT file existence)
     */
    public static validateStructure(input: ParsedInput): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Check for empty changes
        if (input.changes.length === 0) {
            errors.push('No changes specified');
        }

        // Check for duplicate changes on same target
        const changeMap = new Map<string, Set<string>>();
        for (const change of input.changes) {
            const fileTargets = changeMap.get(change.file) || new Set();
            const changeKey = `${change.action}:${change.target}`;
            
            if (fileTargets.has(changeKey)) {
                warnings.push(`Duplicate change detected: ${changeKey} in ${change.file}`);
            }
            
            fileTargets.add(changeKey);
            changeMap.set(change.file, fileTargets);
        }

        // Check for potentially conflicting actions
        for (const [file, targets] of changeMap) {
            if (targets.size > 10) {
                warnings.push(`Large number of changes (${targets.size}) in ${file}. Consider splitting into multiple operations.`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate file accessibility when actually needed
     */
    public static async validateFileAccess(filePath: string, workspace: vscode.WorkspaceFolder): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            // Construct full file path
            const fullPath = vscode.Uri.joinPath(workspace.uri, filePath);
            
            try {
                // Try to read the file
                await vscode.workspace.fs.stat(fullPath);
                
                // File exists - check if it's readable
                try {
                    await vscode.workspace.fs.readFile(fullPath);
                } catch (readError) {
                    errors.push(`File exists but cannot be read: ${filePath}`);
                }
                
            } catch (statError) {
                // File doesn't exist - this might be intentional for new files
                warnings.push(`Target file does not exist: ${filePath} (will be created if needed)`);
            }

        } catch (error) {
            errors.push(`Cannot access file path: ${filePath}`);
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Get changes grouped by file for easier processing
     */
    public static groupChangesByFile(input: ParsedInput): Map<string, ParsedChange[]> {
        const grouped = new Map<string, ParsedChange[]>();
        
        for (const change of input.changes) {
            const existing = grouped.get(change.file) || [];
            existing.push(change);
            grouped.set(change.file, existing);
        }
        
        return grouped;
    }

    /**
     * Detect if input contains new files that need to be created
     */
    private static detectNewFiles(filePaths: string[]): boolean {
        // This is a heuristic - you might want to improve this logic
        return filePaths.some(path => 
            !vscode.workspace.workspaceFolders?.some(folder => 
                vscode.Uri.joinPath(folder.uri, path)
            )
        );
    }

    /**
     * Preview changes without applying them
     */
    public static generatePreview(input: ParsedInput): string {
        let preview = `## ${input.description}\n\n`;
        
        if (input.metadata) {
            preview += `**Summary:**\n`;
            preview += `- ${input.metadata.totalChanges} total changes\n`;
            preview += `- ${input.metadata.affectedFiles.length} files affected\n`;
            if (input.metadata.hasNewFiles) {
                preview += `- Some files may be created\n`;
            }
            preview += `\n`;
        }

        const groupedChanges = this.groupChangesByFile(input);
        
        for (const [file, changes] of groupedChanges) {
            preview += `### ${file}\n`;
            
            for (const change of changes) {
                preview += `- **${change.action}**: ${change.target}\n`;
                if (change.description) {
                    preview += `  ${change.description}\n`;
                }
            }
            preview += `\n`;
        }

        return preview;
    }
}

/**
 * Helper function for backwards compatibility
 */
export function parseChangeInput(jsonContent: string): ParsedInput {
    return ChangeParser.parseInput(jsonContent);
}