// FILE: src/analysis/codeAnalyzer.ts
import * as vscode from 'vscode';
import * as path from 'path';
import Parser from 'tree-sitter';
import { TreeSitterService } from './treeSitterService';

// TargetValidationResult interface remains the same.
export interface TargetValidationResult {
    exists: boolean;
    location?: { line: number; column: number; };
    suggestions?: string[];
    reason?: string;
    confidence: 'high' | 'medium' | 'low';
}

export interface FileAnalysisResult {
    fileExists: boolean;
    isReadable: boolean;
    content?: string;
    language?: string;
    functions: string[];
    classes: Map<string, string[]>; // className -> methodNames[]
    imports: string[];
    lineCount: number;
    parseErrors?: string[];
    tree?: Parser.Tree; // This should work now
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
     * Analyze a file and extract its structure using Tree-sitter
     */
    public static async analyzeFile(filePath: string, workspace: vscode.WorkspaceFolder): Promise<FileAnalysisResult> {
        const fullPath = vscode.Uri.joinPath(workspace.uri, filePath);
        
        try {
            // File existence and size checks (remain the same)
            let fileStat;
            try {
                fileStat = await vscode.workspace.fs.stat(fullPath);
            } catch {
                return { fileExists: false, isReadable: false, functions: [], classes: new Map(), imports: [], lineCount: 0 };
            }

            if (fileStat.size > this.MAX_FILE_SIZE) {
                return { fileExists: true, isReadable: false, functions: [], classes: new Map(), imports: [], lineCount: 0, parseErrors: [`File too large.`] };
            }

            // Read file content (remains the same)
            const fileData = await vscode.workspace.fs.readFile(fullPath);
            const content = Buffer.from(fileData).toString('utf8');
            const language = this.getLanguageFromFile(filePath);
            const lineCount = content.split('\n').length;
            
            // --- NEW: Tree-sitter parsing ---
            if (!this._treeSitterService) {
                throw new Error("CodeAnalyzer's TreeSitterService not initialized.");
            }

            const tree = this._treeSitterService.parse(content, language);
            if (!tree) {
                return { fileExists: true, isReadable: true, content, language, functions: [], classes: new Map(), imports: [], lineCount, parseErrors: [`Failed to parse file with Tree-sitter for language '${language}'.`] };
            }

            const functions = this.extractByQuery(tree, language, 'functions');
            const classAnalysis = this.extractClassesWithMethods(tree, language);
            const imports = this.extractByQuery(tree, language, 'imports');

            return {
                fileExists: true,
                isReadable: true,
                content,
                language,
                functions,
                classes: classAnalysis,
                imports,
                lineCount,
                tree // Optionally return the tree for advanced use
            };

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { fileExists: false, isReadable: false, functions: [], classes: new Map(), imports: [], lineCount: 0, parseErrors: [`Analysis failed: ${message}`] };
        }
    }

    private static extractByQuery(tree: Parser.Tree, language: string, queryType: 'functions' | 'classes' | 'imports' | 'methods', contextNode?: Parser.SyntaxNode): string[] {
        const captures = this._treeSitterService.query(tree, language, queryType);
        const names = new Set<string>();

        for (const capture of captures) {
            // If a contextNode is provided, only include captures within that node's range.
            if (contextNode) {
                if (capture.node.startIndex >= contextNode.startIndex && capture.node.endIndex <= contextNode.endIndex) {
                    names.add(capture.node.text);
                }
            } else {
                names.add(capture.node.text);
            }
        }
        return Array.from(names).sort();
    }

    private static extractClassesWithMethods(tree: Parser.Tree, language: string): Map<string, string[]> {
        const classMap = new Map<string, string[]>();
        const classCaptures = this._treeSitterService.query(tree, language, 'classes');

        for (const capture of classCaptures) {
            const className = capture.node.text;
            const classNode = capture.node.parent; // The full class_declaration node
            if (classNode) {
                const methods = this.extractByQuery(tree, language, 'methods', classNode);
                classMap.set(className, methods);
            } else {
                classMap.set(className, []);
            }
        }
        return classMap;
    }
    
    private static async findSymbolLocation(filePath: string, workspace: vscode.WorkspaceFolder, queryType: 'functions' | 'classes' | 'methods' | 'imports', symbolName: string, className?: string): Promise<{ line: number, column: number } | undefined> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.tree || !analysis.language) {
            return undefined;
        }
        
        const captures = this._treeSitterService.query(analysis.tree, analysis.language, queryType);

        for (const capture of captures) {
            if (capture.node.text === symbolName) {
                if (className) {
                    // For methods, verify it's in the right class
                    let parent = capture.node.parent;
                    while (parent) {
                        if (parent.type.includes('class_definition') || parent.type.includes('class_declaration')) {
                            const classIdentifierNode = parent.childForFieldName('name');
                            if (classIdentifierNode && classIdentifierNode.text === className) {
                                const { row, column } = capture.node.startPosition;
                                return { line: row + 1, column: column + 1 };
                            }
                        }
                        parent = parent.parent;
                    }
                } else {
                    // For functions and classes
                    const { row, column } = capture.node.startPosition;
                    return { line: row + 1, column: column + 1 };
                }
            }
        }
        return undefined;
    }
    
    public static async validateFunction(filePath: string, functionName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { exists: false, reason: analysis.parseErrors?.[0] || 'File cannot be read or parsed', confidence: 'high' };
        }
        
        const functionExists = analysis.functions.includes(functionName);
        if (functionExists) {
            const location = await this.findSymbolLocation(filePath, workspace, 'functions', functionName);
            return { exists: true, location, confidence: 'high' };
        }
        
        return { exists: false, reason: `Function "${functionName}" not found.`, confidence: 'high', suggestions: this.findSimilarNames(functionName, analysis.functions) };
    }

    public static async validateMethod(filePath: string, className: string, methodName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { exists: false, reason: analysis.parseErrors?.[0] || 'File cannot be read or parsed', confidence: 'high' };
        }

        const classMethods = analysis.classes.get(className);
        if (!classMethods) {
            return { exists: false, reason: `Class "${className}" not found.`, confidence: 'high', suggestions: this.findSimilarNames(className, Array.from(analysis.classes.keys())) };
        }

        const methodExists = classMethods.includes(methodName);
        if(methodExists) {
            const location = await this.findSymbolLocation(filePath, workspace, 'methods', methodName, className);
            return { exists: true, location, confidence: 'high' };
        }

        return { exists: false, reason: `Method "${methodName}" not found in class "${className}".`, confidence: 'high', suggestions: this.findSimilarNames(methodName, classMethods) };
    }

    public static async validateClass(filePath: string, className: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { exists: false, reason: analysis.parseErrors?.[0] || 'File cannot be read or parsed', confidence: 'high' };
        }
        
        const classExists = analysis.classes.has(className);
        if (classExists) {
            const location = await this.findSymbolLocation(filePath, workspace, 'classes', className);
            return { exists: true, location, confidence: 'high' };
        }
        
        return { exists: false, reason: `Class "${className}" not found.`, confidence: 'high', suggestions: this.findSimilarNames(className, Array.from(analysis.classes.keys())) };
    }

    public static async validateImport(filePath: string, importName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { exists: false, reason: analysis.parseErrors?.[0] || 'File cannot be read or parsed', confidence: 'high' };
        }
        
        const importExists = analysis.imports.includes(importName);
        if (importExists) {
            const location = await this.findSymbolLocation(filePath, workspace, 'imports', importName);
            return { exists: true, location, confidence: 'high' };
        }
        
        return { 
            exists: false, 
            reason: `Import "${importName}" not found.`, 
            confidence: 'high', 
            suggestions: this.findSimilarNames(importName, analysis.imports) 
        };
    }
    
    // Helper methods like getLanguageFromFile, findSimilarNames, levenshteinDistance, etc.
    private static getLanguageFromFile(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap: { [key:string]: string } = {
            '.js': 'javascript', '.ts': 'typescript', '.py': 'python', '.rs': 'rust'
            // Add other supported languages
        };
        return languageMap[ext] || 'unknown';
    }
    
    private static findSimilarNames(target: string, candidates: string[], maxSuggestions = 3): string[] {
        const similarities = candidates.map(candidate => ({
            name: candidate,
            score: this.calculateSimilarity(target.toLowerCase(), candidate.toLowerCase())
        }))
        .filter(item => item.score > 0.4) // At least 40% similarity
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSuggestions);
        
        return similarities.map(item => item.name);
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