import * as vscode from 'vscode';
import { FormatDocumentation } from './formatDocumentation';

export interface ParsedChange {
    file: string;           // Target file path (may not exist yet)
    action: ChangeAction;
    target: string;         // Function name, import name, etc.
    code: string;           // New code to apply
    class?: string;         // For method operations
    description?: string;   // Description of this specific change
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
    | 'replace_method'
    | 'add_method'
    | 'add_struct'
    | 'add_enum'
    | 'replace_block'
    | 'insert_after'
    | 'insert_before'
    | 'delete_function'
    | 'modify_line'
    | 'create_file';

export interface ValidationError {
    type: 'parse_error' | 'missing_field' | 'invalid_action' | 'invalid_format' | 'duplicate_change';
    changeIndex?: number;  // Which change has the error (0-based)
    field?: string;        // Which field is problematic
    message: string;       // Human-readable error
    details?: any;         // Additional context
    suggestion?: string;   // Suggested fix
}

export interface ValidationWarning {
    type: 'missing_description' | 'large_change_count' | 'duplicate_target' | 'long_code_block' | 'missing_target';
    changeIndex?: number;
    field?: string;
    message: string;
    suggestion?: string;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface FileValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export class ChangeParser {
    
    private static readonly VALID_ACTIONS: ChangeAction[] = [
        'add_import', 'replace_function', 'add_function', 'replace_method', 'add_method',
        'add_struct', 'add_enum', 'replace_block', 'insert_after', 'insert_before',
        'delete_function', 'modify_line', 'create_file'
    ];

    private static readonly MAX_REASONABLE_CHANGES = 50;
    private static readonly MAX_CODE_LENGTH = 10000;

    // Regular expressions for parsing the comment-based format
    private static readonly CHANGE_PATTERN = /^CHANGE:\s*(.+)$/m;
    private static readonly FILE_PATTERN = /^FILE:\s*(.+)$/m;
    private static readonly ACTION_PATTERN = /^ACTION:\s*(.+)$/m;
    private static readonly TARGET_PATTERN = /^TARGET:\s*(.+)$/m;
    private static readonly CLASS_PATTERN = /^CLASS:\s*(.+)$/m;
    private static readonly LINE_PATTERN = /^LINE:\s*(\d+)$/m;
    private static readonly CODE_DELIMITER = /^---\s*$/m;

    /**
     * Parse comment-based input format
     */
    public static parseInput(inputContent: string): ParsedInput {
        // First, validate structure
        const structureValidation = this.validateStructure(inputContent);
        
        if (!structureValidation.isValid) {
            const errorMessages = structureValidation.errors.map(e => e.message).join('; ');
            throw new Error(`Input validation failed: ${errorMessages}`);
        }

        // Extract global description
        const description = this.extractGlobalDescription(inputContent);

        // Split into change blocks
        const blocks = this.splitIntoChangeBlocks(inputContent);
        
        // Parse each block
        const changes: ParsedChange[] = [];
        const affectedFiles = new Set<string>();

        for (let i = 0; i < blocks.length; i++) {
            const change = this.parseChangeBlock(blocks[i], i);
            changes.push(change);
            affectedFiles.add(change.file);
        }

        // Calculate metadata
        const metadata = {
            totalChanges: changes.length,
            affectedFiles: Array.from(affectedFiles),
            hasNewFiles: changes.some(c => c.action === 'create_file')
        };

        return {
            description: description || 'Code changes',
            changes,
            metadata
        };
    }

    /**
     * Validate the overall structure of the input
     */
    public static validateStructure(inputContent: string): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        // Check if input is empty
        if (!inputContent || inputContent.trim() === '') {
            errors.push({
                type: 'invalid_format',
                message: 'Input cannot be empty',
                suggestion: 'Please provide changes in the format: CHANGE: description\\nFILE: path\\nACTION: action_type\\n---\\ncode\\n---'
            });
            return { isValid: false, errors, warnings };
        }

        // Check for at least one CHANGE block
        const changeMatches = inputContent.match(/^CHANGE:/gm);
        if (!changeMatches || changeMatches.length === 0) {
            errors.push({
                type: 'invalid_format',
                message: 'No CHANGE blocks found',
                suggestion: 'Each change must start with "CHANGE: description of the change"'
            });
            return { isValid: false, errors, warnings };
        }

        // Warn about large number of changes
        if (changeMatches.length > this.MAX_REASONABLE_CHANGES) {
            warnings.push({
                type: 'large_change_count',
                message: `Large number of changes (${changeMatches.length}). Consider splitting into smaller batches`,
                suggestion: 'Break large change sets into multiple smaller operations for easier review'
            });
        }

        // Try to parse each block for basic structure validation
        const blocks = this.splitIntoChangeBlocks(inputContent);
        blocks.forEach((block, index) => {
            const blockErrors = this.validateChangeBlockStructure(block, index);
            errors.push(...blockErrors.errors);
            warnings.push(...blockErrors.warnings);
        });

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate a single change block structure
     */
    private static validateChangeBlockStructure(block: string, blockIndex: number): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        // Check for required CHANGE line
        if (!this.CHANGE_PATTERN.test(block)) {
            errors.push({
                type: 'missing_field',
                changeIndex: blockIndex,
                field: 'CHANGE',
                message: `Block ${blockIndex + 1}: Missing CHANGE line`,
                suggestion: 'Start each change block with "CHANGE: description"'
            });
        }

        // Check for required FILE line
        if (!this.FILE_PATTERN.test(block)) {
            errors.push({
                type: 'missing_field',
                changeIndex: blockIndex,
                field: 'FILE',
                message: `Block ${blockIndex + 1}: Missing FILE line`,
                suggestion: 'Add "FILE: path/to/file.ext" line'
            });
        }

        // Check for required ACTION line
        if (!this.ACTION_PATTERN.test(block)) {
            errors.push({
                type: 'missing_field',
                changeIndex: blockIndex,
                field: 'ACTION',
                message: `Block ${blockIndex + 1}: Missing ACTION line`,
                suggestion: 'Add "ACTION: action_type" line'
            });
        }

        // Check for code delimiters
        const codeDelimiters = block.match(/^---\s*$/gm);
        if (!codeDelimiters || codeDelimiters.length < 2) {
            // Not all actions require code (e.g., delete_function)
            const actionMatch = block.match(this.ACTION_PATTERN);
            const action = actionMatch ? actionMatch[1].trim() : '';
            
            if (action !== 'delete_function') {
                errors.push({
                    type: 'missing_field',
                    changeIndex: blockIndex,
                    field: 'code',
                    message: `Block ${blockIndex + 1}: Missing code block or incorrect --- delimiters`,
                    suggestion: 'Wrap code in --- markers: ---\\ncode here\\n---'
                });
            }
        }

        // Validate action if present
        const actionMatch = block.match(this.ACTION_PATTERN);
        if (actionMatch) {
            const action = actionMatch[1].trim();
            if (!this.VALID_ACTIONS.includes(action as ChangeAction)) {
                const suggestion = this.suggestSimilarAction(action);
                errors.push({
                    type: 'invalid_action',
                    changeIndex: blockIndex,
                    field: 'ACTION',
                    message: `Block ${blockIndex + 1}: Invalid action "${action}"`,
                    suggestion: suggestion ? `Did you mean "${suggestion}"?` : `Valid actions: ${this.VALID_ACTIONS.join(', ')}`
                });
            }
        }

        return { isValid: errors.length === 0, errors, warnings };
    }

    /**
     * Extract global description from the top of the input
     */
    private static extractGlobalDescription(inputContent: string): string | undefined {
        const lines = inputContent.split('\n');
        const descriptionLines: string[] = [];
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Stop at first CHANGE block
            if (this.CHANGE_PATTERN.test(line)) {
                break;
            }
            
            // Skip empty lines and comments
            if (trimmedLine && !trimmedLine.startsWith('//') && !trimmedLine.startsWith('#')) {
                descriptionLines.push(trimmedLine);
            }
        }
        
        const description = descriptionLines.join(' ').trim();
        return description || undefined;
    }

    /**
     * Split input into individual change blocks
     */
    private static splitIntoChangeBlocks(inputContent: string): string[] {
        const blocks: string[] = [];
        const lines = inputContent.split('\n');
        let currentBlock: string[] = [];
        let inBlock = false;

        for (const line of lines) {
            if (this.CHANGE_PATTERN.test(line)) {
                // Save previous block if it exists
                if (inBlock && currentBlock.length > 0) {
                    blocks.push(currentBlock.join('\n').trim());
                }
                // Start new block
                currentBlock = [line];
                inBlock = true;
            } else if (inBlock) {
                currentBlock.push(line);
            }
        }

        // Add final block
        if (inBlock && currentBlock.length > 0) {
            blocks.push(currentBlock.join('\n').trim());
        }

        return blocks;
    }

    /**
     * Parse a single change block
     */
    private static parseChangeBlock(block: string, blockIndex: number): ParsedChange {
        // Extract required fields
        const descriptionMatch = block.match(this.CHANGE_PATTERN);
        const fileMatch = block.match(this.FILE_PATTERN);
        const actionMatch = block.match(this.ACTION_PATTERN);

        if (!descriptionMatch || !fileMatch || !actionMatch) {
            throw new Error(`Block ${blockIndex + 1}: Missing required fields`);
        }

        const description = descriptionMatch[1].trim();
        const file = fileMatch[1].trim();
        const action = actionMatch[1].trim() as ChangeAction;

        // Extract optional fields
        const targetMatch = block.match(this.TARGET_PATTERN);
        const classMatch = block.match(this.CLASS_PATTERN);
        
        let target = targetMatch ? targetMatch[1].trim() : '';
        const classValue = classMatch ? classMatch[1].trim() : undefined;

        // For actions that don't typically need a target, use description as target
        if (!target && !this.actionNeedsTarget(action)) {
            target = description;
        }

        // Extract code block
        const code = this.extractCodeBlock(block);

        // Validate action-specific requirements
        this.validateActionRequirements(action, target, classValue, code, blockIndex);

        return {
            file,
            action,
            target,
            code,
            class: classValue,
            description
        };
    }

    /**
     * Extract code between --- markers
     */
    private static extractCodeBlock(block: string): string {
        const lines = block.split('\n');
        const delimiterIndices: number[] = [];
        
        // Find all --- markers
        lines.forEach((line, index) => {
            if (this.CODE_DELIMITER.test(line)) {
                delimiterIndices.push(index);
            }
        });

        if (delimiterIndices.length < 2) {
            return ''; // No code block found
        }

        // Extract code between first two --- markers
        const startIndex = delimiterIndices[0] + 1;
        const endIndex = delimiterIndices[1];
        
        return lines.slice(startIndex, endIndex).join('\n').trim();
    }

    /**
     * Check if action typically needs a target
     */
    private static actionNeedsTarget(action: ChangeAction): boolean {
        const needsTarget = [
            'replace_function', 'replace_method', 'delete_function',
            'insert_after', 'insert_before', 'replace_block'
        ];
        return needsTarget.includes(action);
    }

    /**
     * Validate action-specific requirements
     */
    private static validateActionRequirements(
        action: ChangeAction, 
        target: string, 
        classValue: string | undefined, 
        code: string, 
        blockIndex: number
    ): void {
        // Method operations require class
        if ((action === 'replace_method' || action === 'add_method') && !classValue) {
            throw new Error(`Block ${blockIndex + 1}: Action "${action}" requires a CLASS field`);
        }

        // Most actions require code (except delete operations)
        if (!code && action !== 'delete_function') {
            throw new Error(`Block ${blockIndex + 1}: Action "${action}" requires a code block`);
        }

        // Actions that need targets
        if (this.actionNeedsTarget(action) && !target) {
            throw new Error(`Block ${blockIndex + 1}: Action "${action}" requires a TARGET field`);
        }

        // Validate code length
        if (code && code.length > this.MAX_CODE_LENGTH) {
            throw new Error(`Block ${blockIndex + 1}: Code block is too large (${code.length} characters). Maximum: ${this.MAX_CODE_LENGTH}`);
        }
    }

    /**
     * Suggest similar action if user made a typo
     */
    private static suggestSimilarAction(invalidAction: string): string | null {
        const similarities: { [key: string]: string } = {
            'replace_func': 'replace_function',
            'add_func': 'add_function',
            'replace_fn': 'replace_function',
            'add_fn': 'add_function',
            'add_import_statement': 'add_import',
            'import': 'add_import',
            'delete_func': 'delete_function',
            'remove_function': 'delete_function',
            'modify': 'modify_line',
            'change_line': 'modify_line',
            'insert': 'insert_after',
            'new_file': 'create_file',
            'make_file': 'create_file'
        };

        const lowerInvalid = invalidAction.toLowerCase();
        
        // Direct match
        if (similarities[lowerInvalid]) {
            return similarities[lowerInvalid];
        }

        // Fuzzy match - find closest valid action
        let bestMatch: string | null = null;
        let bestScore = 0;

        for (const validAction of this.VALID_ACTIONS) {
            const score = this.calculateSimilarity(lowerInvalid, validAction);
            if (score > bestScore && score > 0.6) { // At least 60% similarity
                bestScore = score;
                bestMatch = validAction;
            }
        }

        return bestMatch;
    }

    /**
     * Calculate string similarity using Levenshtein distance
     */
    private static calculateSimilarity(a: string, b: string): number {
        const longer = a.length > b.length ? a : b;
        const shorter = a.length > b.length ? b : a;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    private static levenshteinDistance(a: string, b: string): number {
        const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

        for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

        for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
                const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,     // deletion
                    matrix[j - 1][i] + 1,     // insertion
                    matrix[j - 1][i - 1] + indicator // substitution
                );
            }
        }

        return matrix[b.length][a.length];
    }

    /**
     * Validate semantic relationships between changes
     */
    public static validateSemanticConsistency(input: ParsedInput): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        // Check for duplicate changes on same target
        const changeMap = new Map<string, Set<string>>();
        for (let i = 0; i < input.changes.length; i++) {
            const change = input.changes[i];
            const fileTargets = changeMap.get(change.file) || new Set();
            const changeKey = `${change.action}:${change.target}`;
            
            if (fileTargets.has(changeKey)) {
                errors.push({
                    type: 'duplicate_change',
                    changeIndex: i,
                    message: `Duplicate change detected: ${changeKey} in ${change.file}`,
                    suggestion: 'Remove duplicate changes or combine them into a single operation'
                });
            }
            
            fileTargets.add(changeKey);
            changeMap.set(change.file, fileTargets);
        }

        // Check for potentially conflicting actions
        for (const [file, targets] of changeMap) {
            if (targets.size > 20) {
                warnings.push({
                    type: 'large_change_count',
                    message: `Large number of changes (${targets.size}) in ${file}`,
                    suggestion: 'Consider splitting into multiple operations for easier review'
                });
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate file accessibility
     */
    public static async validateFileAccess(filePath: string, workspace: vscode.WorkspaceFolder, action: ChangeAction): Promise<FileValidationResult> {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        try {
            const fullPath = vscode.Uri.joinPath(workspace.uri, filePath);
            
            try {
                await vscode.workspace.fs.stat(fullPath);
                
                // File exists - check if we can read it (unless it's create_file which would overwrite)
                if (action !== 'create_file') {
                    try {
                        await vscode.workspace.fs.readFile(fullPath);
                    } catch (readError) {
                        errors.push({
                            type: 'parse_error',
                            message: `File exists but cannot be read: ${filePath}`,
                            suggestion: 'Check file permissions'
                        });
                    }
                } else {
                    // create_file action on existing file - warn about overwrite
                    warnings.push({
                        type: 'missing_description',
                        message: `File already exists and will be overwritten: ${filePath}`,
                        suggestion: 'Use a different action if you want to modify rather than replace the file'
                    });
                }
                
            } catch (statError) {
                // File doesn't exist
                if (action === 'create_file') {
                    // This is expected and OK for create_file
                    warnings.push({
                        type: 'missing_description',
                        message: `New file will be created: ${filePath}`,
                        suggestion: 'Verify the file path and content are correct'
                    });
                } else {
                    // For all other actions, missing file is an error
                    errors.push({
                        type: 'parse_error',
                        message: `Target file does not exist: ${filePath}`,
                        suggestion: `Use "create_file" action if you want to create a new file, or verify the file path is correct`
                    });
                }
            }

        } catch (error) {
            errors.push({
                type: 'parse_error',
                message: `Cannot access file path: ${filePath}`,
                suggestion: 'Check that the file path is valid for this workspace'
            });
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Group changes by file for easier processing
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
     * Generate preview without applying changes
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

    /**
     * Generate example format for user guidance
     * Delegates to the documentation module
     */
    public static generateExample(): string {
        return FormatDocumentation.generateExample();
    }

    /**
     * Get format documentation for help
     * Delegates to the documentation module
     */
    public static getFormatDocumentation(): string {
        return FormatDocumentation.getFormatDocumentation();
    }

    /**
     * Get quick reference
     * Delegates to the documentation module
     */
    public static getQuickReference(): string {
        return FormatDocumentation.getQuickReference();
    }

    /**
     * Get validation tips
     * Delegates to the documentation module
     */
    public static getValidationTips(): string[] {
        return FormatDocumentation.getValidationTips();
    }

    /**
     * Get troubleshooting guide
     * Delegates to the documentation module
     */
    public static getTroubleshootingGuide(): string {
        return FormatDocumentation.getTroubleshootingGuide();
    }

    // Legacy compatibility method name
    public static validateJsonStructure = this.validateStructure;
}

/**
 * Helper function for backwards compatibility
 */
export function parseChangeInput(inputContent: string): ParsedInput {
    return ChangeParser.parseInput(inputContent);
}