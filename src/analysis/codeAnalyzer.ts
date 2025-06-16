import * as vscode from 'vscode';
import * as path from 'path';
import { TreeSitterService } from './treeSitterService';

// --- NEW/UPDATED INTERFACES FOR POSITIONAL DATA ---

/**
 * Represents a specific point in the source code, including line, column, and absolute character offset.
 */
export interface Position {
    line: number;    // 1-based
    column: number;  // 1-based
    offset: number;  // 0-based character index from the start of the file
}

/**
 * Contains information about a named symbol (function, class, method) found in the code,
 * including its exact start and end positions.
 */
export interface SymbolInfo {
    name: string;
    start: Position;
    end: Position;
}

/**
 * Extends SymbolInfo for classes, adding a list of methods found within the class.
 */
export interface ClassInfo extends SymbolInfo {
    methods: SymbolInfo[];
}

/**
 * The result of validating a specific target. On success, it can include the full SymbolInfo.
 */
export interface TargetValidationResult {
    exists: boolean;
    symbolInfo?: SymbolInfo | ClassInfo; // Return the full symbol on success
    suggestions?: string[];
    reason?: string;
    confidence: 'high' | 'medium' | 'low';
}

/**
 * The result of analyzing a file, now containing lists of rich SymbolInfo objects.
 */
export interface FileAnalysisResult {
    fileExists: boolean;
    isReadable: boolean;
    content?: string;
    language?: string;
    functions: SymbolInfo[];
    classes: Map<string, ClassInfo>; // className -> ClassInfo
    imports: SymbolInfo[];
    lineCount: number;
    parseErrors?: string[];
    tree?: any; // Tree from web-tree-sitter
}

export class CodeAnalyzer {
    private static _treeSitterService: TreeSitterService;

    // Call this from extension.ts `activate`
    public static async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (!this._treeSitterService) {
            this._treeSitterService = await TreeSitterService.create(context);
        }
    }

    private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit

    /**
     * Analyze a file and extract its structure using Tree-sitter.
     */
    public static async analyzeFile(filePath: string, workspace: vscode.WorkspaceFolder): Promise<FileAnalysisResult> {
        const fullPath = vscode.Uri.joinPath(workspace.uri, filePath);
        
        try {
            // File existence and size checks
            let fileStat;
            try {
                fileStat = await vscode.workspace.fs.stat(fullPath);
            } catch {
                return { fileExists: false, isReadable: false, functions: [], classes: new Map(), imports: [], lineCount: 0 };
            }

            if (fileStat.size > this.MAX_FILE_SIZE) {
                return { fileExists: true, isReadable: false, functions: [], classes: new Map(), imports: [], lineCount: 0, parseErrors: [`File too large.`] };
            }

            // Read file content
            const fileData = await vscode.workspace.fs.readFile(fullPath);
            const content = Buffer.from(fileData).toString('utf8');
            const language = this.getLanguageFromFile(filePath);
            const lineCount = content.split('\n').length;
            
            // --- Tree-sitter parsing ---
            if (!this._treeSitterService) {
                throw new Error("CodeAnalyzer's TreeSitterService not initialized.");
            }

            const tree = this._treeSitterService.parse(content, language);
            if (!tree) {
                return { fileExists: true, isReadable: true, content, language, functions: [], classes: new Map(), imports: [], lineCount, parseErrors: [`Failed to parse file with Tree-sitter for language '${language}'.`] };
            }

            const functions = await this.extractSymbols(tree, language, 'functions');
            const classAnalysis = await this.extractClassesWithMethods(tree, language);
            const imports = await this.extractSymbols(tree, language, 'imports');

            return {
                fileExists: true,
                isReadable: true,
                content,
                language,
                functions,
                classes: classAnalysis,
                imports,
                lineCount,
                tree
            };

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { fileExists: false, isReadable: false, functions: [], classes: new Map(), imports: [], lineCount: 0, parseErrors: [`Analysis failed: ${message}`] };
        }
    }

    /**
     * A generic method to extract symbols based on a query. It now returns full SymbolInfo.
     */
    private static extractSymbols(tree: any, language: string, queryType: 'functions' | 'classes' | 'imports' | 'methods', contextNode?: any): SymbolInfo[] {
        const captures = this._treeSitterService.query(tree, language, queryType);
        const symbols: SymbolInfo[] = [];

        for (const capture of captures) {
            const nameNode = capture.node;
            // The actual block we want to replace is the parent of the name identifier.
            const symbolBlockNode = nameNode.parent;

            if (symbolBlockNode) {
                // Check if we are within the specified context
                if (contextNode && (symbolBlockNode.startIndex < contextNode.startIndex || symbolBlockNode.endIndex > contextNode.endIndex)) {
                    continue;
                }
                
                symbols.push({
                    name: nameNode.text,
                    start: {
                        line: symbolBlockNode.startPosition.row + 1,
                        column: symbolBlockNode.startPosition.column + 1,
                        offset: symbolBlockNode.startIndex
                    },
                    end: {
                        line: symbolBlockNode.endPosition.row + 1,
                        column: symbolBlockNode.endPosition.column + 1,
                        offset: symbolBlockNode.endIndex
                    }
                });
            }
        }
        return symbols;
    }

    private static extractClassesWithMethods(tree: any, language: string): Map<string, ClassInfo> {
        const classMap = new Map<string, ClassInfo>();
        const classSymbols = this.extractSymbols(tree, language, 'classes');

        for (const classSymbol of classSymbols) {
            // To find the node for the class, we need to re-query and find the one that matches our symbol
            const classNode = tree.rootNode.descendantForPosition(
                { row: classSymbol.start.line - 1, column: classSymbol.start.column - 1 },
                { row: classSymbol.end.line - 1, column: classSymbol.end.column - 1 }
            );

            if (classNode) {
                const methods = this.extractSymbols(tree, language, 'methods', classNode);
                classMap.set(classSymbol.name, { ...classSymbol, methods });
            }
        }
        return classMap;
    }

    public static async validateFunction(filePath: string, functionName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { exists: false, reason: analysis.parseErrors?.[0] || 'File cannot be read or parsed', confidence: 'high' };
        }
        
        const func = analysis.functions.find(f => f.name === functionName);
        if (func) {
            return { exists: true, symbolInfo: func, confidence: 'high' };
        }
        
        const suggestions = this.findSimilarNames(functionName, analysis.functions.map(f => f.name));
        return { exists: false, reason: `Function "${functionName}" not found.`, confidence: 'high', suggestions };
    }

    public static async validateMethod(filePath: string, className: string, methodName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { exists: false, reason: analysis.parseErrors?.[0] || 'File cannot be read or parsed', confidence: 'high' };
        }

        const classInfo = analysis.classes.get(className);
        if (!classInfo) {
            const suggestions = this.findSimilarNames(className, Array.from(analysis.classes.keys()));
            return { exists: false, reason: `Class "${className}" not found.`, confidence: 'high', suggestions };
        }

        const methodInfo = classInfo.methods.find(m => m.name === methodName);
        if(methodInfo) {
            return { exists: true, symbolInfo: methodInfo, confidence: 'high' };
        }

        const suggestions = this.findSimilarNames(methodName, classInfo.methods.map(m => m.name));
        return { exists: false, reason: `Method "${methodName}" not found in class "${className}".`, confidence: 'high', suggestions };
    }

    public static async validateClass(filePath: string, className: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { exists: false, reason: analysis.parseErrors?.[0] || 'File cannot be read or parsed', confidence: 'high' };
        }
        
        const classInfo = analysis.classes.get(className);
        if (classInfo) {
            return { exists: true, symbolInfo: classInfo, confidence: 'high' };
        }
        
        const suggestions = this.findSimilarNames(className, Array.from(analysis.classes.keys()));
        return { exists: false, reason: `Class "${className}" not found.`, confidence: 'high', suggestions };
    }

    public static async validateImport(filePath: string, importName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { exists: false, reason: analysis.parseErrors?.[0] || 'File cannot be read or parsed', confidence: 'high' };
        }
        
        const imp = analysis.imports.find(i => i.name === importName);
        if (imp) {
            return { exists: true, symbolInfo: imp, confidence: 'high' };
        }
        
        const suggestions = this.findSimilarNames(importName, analysis.imports.map(i => i.name));
        return { 
            exists: false, 
            reason: `Import "${importName}" not found.`, 
            confidence: 'high', 
            suggestions
        };
    }

    /**
     * Validates if a specific block of text exists as a distinct AST node.
     */
    public static async validateBlock(filePath: string, targetText: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable || !analysis.tree) {
            return { exists: false, reason: analysis.parseErrors?.[0] || 'File cannot be read or parsed', confidence: 'high' };
        }
        
        const node = this.findNodeByText(analysis.tree, targetText);
        
        if (node) {
            // ADD THIS DEBUGGING
            console.log('🔍 Found node:', {
                type: node.type,
                text: node.text,
                startIndex: node.startIndex,
                endIndex: node.endIndex,
                startPosition: node.startPosition,
                endPosition: node.endPosition
            });
            
            const symbolInfo: SymbolInfo = {
                name: targetText.substring(0, 50) + '...',
                start: {
                    line: node.startPosition.row + 1,
                    column: node.startPosition.column + 1,
                    offset: node.startIndex
                },
                end: {
                    line: node.endPosition.row + 1,
                    column: node.endPosition.column + 1,
                    offset: node.endIndex
                }
            };
            return { exists: true, symbolInfo: symbolInfo, confidence: 'medium' };
        }
        
        
        const suggestions = this.findSimilarText(targetText, analysis.content || '');
        return { 
            exists: false, 
            reason: `Code block starting with "${targetText.substring(0, 30)}..." not found as a distinct syntax node.`, 
            confidence: 'high',
            suggestions
        };
    }

    
    /**
     * Improved method to find a syntax node that matches the given text.
     * This version better handles enum blocks and other structured code.
     */
    private static findNodeByText(tree: any, text: string): any | undefined {
        // First, try to find by exact text match
        let bestMatch = this.findExactTextMatch(tree, text);
        if (bestMatch) {
            return bestMatch;
        }

        // If no exact match, try to find by structural pattern
        bestMatch = this.findStructuralMatch(tree, text);
        if (bestMatch) {
            return bestMatch;
        }

        // Fallback to the original fuzzy matching
        return this.findFuzzyTextMatch(tree, text);
    }

    /**
     * Find node with exact text content match
    */
    private static findExactTextMatch(tree: any, targetText: string): any | undefined {
        const normalizedTarget = this.normalizeCode(targetText);
        let bestMatch: any | undefined;

        // Use arrow function to preserve 'this' context
        const walk = (node: any): void => {
            const normalizedNodeText = this.normalizeCode(node.text);
            
            if (normalizedNodeText === normalizedTarget) {
                if (!bestMatch || node.text.length < bestMatch.text.length) {
                    bestMatch = node;
                }
            }
            
            for (const child of node.children) {
                walk(child);
            }
        };
        
        walk(tree.rootNode);
        return bestMatch;
    }


    /**
     * Fallback fuzzy matching (original implementation)
     */
    private static findFuzzyTextMatch(tree: any, text: string): any | undefined {
        const targetNormalized = this.normalizeCode(text);
        let bestMatch: any | undefined;

        // Use arrow function to preserve context
        const walk = (node: any): void => {
            const nodeTextNormalized = this.normalizeCode(node.text);

            if (nodeTextNormalized.includes(targetNormalized)) {
                if (!bestMatch || node.text.length < bestMatch.text.length) {
                    bestMatch = node;
                }
            }

            for (const child of node.children) {
                walk(child);
            }
        };
        
        walk(tree.rootNode);
        
        if (bestMatch && bestMatch.text.length > text.length * 3) {
            console.warn('Found a matching node, but it was much larger than the target. Discarding it as a likely incorrect match.');
            return undefined;
        }

        return bestMatch;
    }


    /**
     * Normalize code for comparison by removing extra whitespace and formatting
     */
    private static normalizeCode(code: string): string {
        return code
            .replace(/\s+/g, ' ')           // Replace all whitespace with single spaces
            .replace(/\s*{\s*/g, '{')       // Remove spaces around opening braces
            .replace(/\s*}\s*/g, '}')       // Remove spaces around closing braces
            .replace(/\s*;\s*/g, ';')       // Remove spaces around semicolons
            .replace(/\s*,\s*/g, ',')       // Remove spaces around commas
            .replace(/\s*=\s*/g, '=')       // Remove spaces around equals
            .trim();
    }

    // Helper methods (getLanguageFromFile, findSimilarNames, levenshteinDistance) remain unchanged.
    private static getLanguageFromFile(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap: { [key:string]: string } = {
            '.js': 'javascript', '.ts': 'typescript', '.py': 'python', '.rs': 'rust'
        };
        return languageMap[ext] || 'unknown';
    }
    
    private static findSimilarNames(target: string, candidates: string[], maxSuggestions = 3): string[] {
        const similarities = candidates.map(candidate => ({
            name: candidate,
            score: this.calculateSimilarity(target.toLowerCase(), candidate.toLowerCase())
        }))
        .filter(item => item.score > 0.4)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSuggestions);
        
        return similarities.map(item => item.name);
    }

    /**
     * Find node by structural pattern (e.g., enum declarations, class definitions)
     */
    private static findStructuralMatch(tree: any, targetText: string): any | undefined {
        // Look for enum pattern specifically
        if (targetText.includes('export enum')) {
            return this.findEnumDeclaration(tree, targetText);
        }
        
        // Look for class pattern
        if (targetText.includes('export class') || targetText.includes('class ')) {
            return this.findClassDeclaration(tree, targetText);
        }
        
        // Look for function pattern
        if (targetText.includes('function ') || targetText.includes('export function')) {
            return this.findFunctionDeclaration(tree, targetText);
        }
        
        return undefined;
    }

    /**
     * Find function declaration by name
     */
    private static findFunctionDeclaration(tree: any, targetText: string): any | undefined {
        const functionNameMatch = targetText.match(/function\s+(\w+)/);
        if (!functionNameMatch) {
            return undefined;
        }
        
        const functionName = functionNameMatch[1];
        
        function walk(node: any): any | undefined {
            if (node.type === 'function_declaration') {
                for (const child of node.children) {
                    if (child.type === 'identifier' && child.text === functionName) {
                        return node;
                    }
                }
            }
            
            for (const child of node.children) {
                const result = walk(child);
                if (result) {
                    return result;
                }
            }
            
            return undefined;
        }
        
        return walk(tree.rootNode);
    }

    /**
     * Find class declaration by name
     */
    private static findClassDeclaration(tree: any, targetText: string): any | undefined {
        const classNameMatch = targetText.match(/class\s+(\w+)/);
        if (!classNameMatch) {
            return undefined;
        }
        
        const className = classNameMatch[1];
        
        function walk(node: any): any | undefined {
            if (node.type === 'class_declaration') {
                for (const child of node.children) {
                    if (child.type === 'identifier' && child.text === className) {
                        return node;
                    }
                }
            }
            
            for (const child of node.children) {
                const result = walk(child);
                if (result) {
                    return result;
                }
            }
            
            return undefined;
        }
        
        return walk(tree.rootNode);
    }


    /**
     * Find enum declaration by name and structure
     */
    private static findEnumDeclaration(tree: any, targetText: string): any | undefined {
        // Extract enum name from target text
        const enumNameMatch = targetText.match(/enum\s+(\w+)/);
        if (!enumNameMatch) {
            return undefined;
        }
        
        const enumName = enumNameMatch[1];
        
        function walk(node: any): any | undefined {
            // Look for enum_declaration nodes
            if (node.type === 'enum_declaration') {
                // Find the identifier child node
                for (const child of node.children) {
                    if (child.type === 'identifier' && child.text === enumName) {
                        return node; // Return the entire enum declaration
                    }
                }
            }
            
            // Continue walking if this isn't the right enum
            for (const child of node.children) {
                const result = walk(child);
                if (result) {
                    return result;
                }
            }
            
            return undefined;
        }
        
        return walk(tree.rootNode);
    }

        
    /**
     * Finds lines in content that are similar to the target text snippet.
     */
    private static findSimilarText(target: string, content: string, maxSuggestions = 3): string[] {
        if (!content) return [];
        const targetFirstLine = target.split('\n')[0].trim();
        if (!targetFirstLine) return [];

        const lines = content.split('\n');
        const suggestions: string[] = [];

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.length > 5 && trimmedLine.includes(targetFirstLine)) {
                suggestions.push(trimmedLine.substring(0, 100)); // Push a snippet
                if (suggestions.length >= maxSuggestions) {
                    break;
                }
            }
        }
        return suggestions;
    }

    private static calculateSimilarity(a: string, b: string): number {
        const longer = a.length > b.length ? a : b;
        const shorter = a.length > b.length ? b : a;
        
        if (longer.length === 0) {
            return 1.0;
        }
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    private static levenshteinDistance(a: string, b: string): number {
        const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

        for (let i = 0; i <= a.length; i++) {
            matrix[0][i] = i;
        }
        for (let j = 0; j <= b.length; j++) {
            matrix[j][0] = j;
        }

        for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
                const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i] + 1,
                    matrix[j - 1][i - 1] + indicator
                );
            }
        }

        return matrix[b.length][a.length];
    }
}