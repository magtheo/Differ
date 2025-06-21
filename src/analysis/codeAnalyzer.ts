import * as vscode from 'vscode';
import * as path from 'path';
import { TreeSitterService } from './treeSitterService';
import { DetailedError, ErrorCategories } from '../parser/inputParser';

// --- INTERFACES FOR POSITIONAL DATA ---

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
 * The result of validating a specific target. Uses DetailedError for enhanced error reporting.
 */
export interface TargetValidationResult {
    exists: boolean;
    symbolInfo?: SymbolInfo | ClassInfo;
    error?: DetailedError; // Replaces reason and suggestions with rich error object
    confidence: 'high' | 'medium' | 'low';
}

/**
 * The result of analyzing a file, containing lists of rich SymbolInfo objects.
 */
export interface FileAnalysisResult {
    fileExists: boolean;
    isReadable: boolean;
    content?: string;
    language?: string;
    functions: SymbolInfo[];
    classes: Map<string, ClassInfo>;
    imports: SymbolInfo[];
    lineCount: number;
    parseErrors?: DetailedError[]; // Enhanced to use DetailedError
    tree?: any;
}

export class CodeAnalyzer {
    private static _treeSitterService: TreeSitterService;
    private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit

    // Call this from extension.ts `activate`
    public static async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (!this._treeSitterService) {
            this._treeSitterService = await TreeSitterService.create(context);
        }
    }

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
                return { 
                    fileExists: false, 
                    isReadable: false, 
                    functions: [], 
                    classes: new Map(), 
                    imports: [], 
                    lineCount: 0 
                };
            }

            if (fileStat.size > this.MAX_FILE_SIZE) {
                const error = this.createDetailedError(
                    ErrorCategories.FILE_ERROR_READ_FAILED,
                    `File too large to analyze: ${filePath}`,
                    `File size: ${fileStat.size} bytes, limit: ${this.MAX_FILE_SIZE} bytes`,
                    ['Consider breaking the file into smaller modules.'],
                    { filePath, fileSize: fileStat.size, limit: this.MAX_FILE_SIZE }
                );
                return { 
                    fileExists: true, 
                    isReadable: false, 
                    functions: [], 
                    classes: new Map(), 
                    imports: [], 
                    lineCount: 0, 
                    parseErrors: [error] 
                };
            }

            // Read file content
            const fileData = await vscode.workspace.fs.readFile(fullPath);
            const content = Buffer.from(fileData).toString('utf8');
            const language = this.getLanguageFromFile(filePath);
            const lineCount = content.split('\n').length;
            
            // Tree-sitter parsing
            if (!this._treeSitterService) {
                const error = this.createDetailedError(
                    ErrorCategories.ANALYSIS_ERROR_TS_PARSE_FAILED,
                    "CodeAnalyzer's TreeSitterService not initialized.",
                    "Tree-sitter service must be initialized before analyzing files.",
                    ['Ensure CodeAnalyzer.initialize() is called during extension activation.'],
                    { filePath, language }
                );
                return { 
                    fileExists: true, 
                    isReadable: true, 
                    content, 
                    language, 
                    functions: [], 
                    classes: new Map(), 
                    imports: [], 
                    lineCount, 
                    parseErrors: [error] 
                };
            }

            const tree = this._treeSitterService.parse(content, language);
            if (!tree) {
                const error = this.createDetailedError(
                    ErrorCategories.ANALYSIS_ERROR_TS_PARSE_FAILED,
                    `Failed to parse file with Tree-sitter for language '${language}'.`,
                    `Tree-sitter could not generate an AST for the file content.`,
                    [
                        'Check if the file has syntax errors.',
                        'Verify the file extension matches the content.',
                        `Ensure ${language} grammar is supported.`
                    ],
                    { filePath, language, contentLength: content.length }
                );
                return { 
                    fileExists: true, 
                    isReadable: true, 
                    content, 
                    language, 
                    functions: [], 
                    classes: new Map(), 
                    imports: [], 
                    lineCount, 
                    parseErrors: [error] 
                };
            }

            const functions = this.extractSymbols(tree, language, 'functions');
            const classAnalysis = this.extractClassesWithMethods(tree, language);
            const imports = this.extractSymbols(tree, language, 'imports');

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
            const detailedError = this.createDetailedError(
                ErrorCategories.ANALYSIS_ERROR_TS_PARSE_FAILED,
                `File analysis failed: ${filePath}`,
                error instanceof Error ? error.message : String(error),
                ['Check file permissions and syntax.'],
                { filePath, error: error instanceof Error ? error.stack : error }
            );
            return { 
                fileExists: false, 
                isReadable: false, 
                functions: [], 
                classes: new Map(), 
                imports: [], 
                lineCount: 0, 
                parseErrors: [detailedError] 
            };
        }
    }

    /**
     * Validate function existence with enhanced error reporting
     */
    public static async validateFunction(filePath: string, functionName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { 
                exists: false, 
                error: analysis.parseErrors?.[0] || this.createFileReadError(filePath), 
                confidence: 'high' 
            };
        }
        
        const func = analysis.functions.find(f => f.name === functionName);
        if (func) {
            return { exists: true, symbolInfo: func, confidence: 'high' };
        }
        
        const suggestions = this.findSimilarNames(functionName, analysis.functions.map(f => f.name));
        const error = this.createDetailedError(
            ErrorCategories.TARGET_ERROR_FUNCTION_NOT_FOUND,
            `Function "${functionName}" not found in ${filePath}`,
            `Searched ${analysis.functions.length} functions in the file.`,
            suggestions.length > 0 ? 
                [`Did you mean: ${suggestions.join(', ')}?`, 'Check function name spelling and case.'] :
                ['Check function name spelling and case.', 'Ensure the function is declared in this file.'],
            { 
                filePath, 
                targetFunction: functionName, 
                availableFunctions: analysis.functions.map(f => f.name), 
                suggestions 
            }
        );
        
        return { exists: false, error, confidence: 'high' };
    }

    /**
     * Validate method existence with enhanced error reporting
     */
    public static async validateMethod(filePath: string, className: string, methodName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { 
                exists: false, 
                error: analysis.parseErrors?.[0] || this.createFileReadError(filePath), 
                confidence: 'high' 
            };
        }

        const classInfo = analysis.classes.get(className);
        if (!classInfo) {
            const suggestions = this.findSimilarNames(className, Array.from(analysis.classes.keys()));
            const error = this.createDetailedError(
                ErrorCategories.TARGET_ERROR_CLASS_NOT_FOUND,
                `Class "${className}" not found in ${filePath}`,
                `Searched ${analysis.classes.size} classes in the file.`,
                suggestions.length > 0 ? 
                    [`Did you mean: ${suggestions.join(', ')}?`, 'Check class name spelling and case.'] :
                    ['Check class name spelling and case.', 'Ensure the class is declared in this file.'],
                { 
                    filePath, 
                    targetClass: className, 
                    availableClasses: Array.from(analysis.classes.keys()), 
                    suggestions 
                }
            );
            return { exists: false, error, confidence: 'high' };
        }

        const methodInfo = classInfo.methods.find(m => m.name === methodName);
        if (methodInfo) {
            return { exists: true, symbolInfo: methodInfo, confidence: 'high' };
        }

        const suggestions = this.findSimilarNames(methodName, classInfo.methods.map(m => m.name));
        const error = this.createDetailedError(
            ErrorCategories.TARGET_ERROR_METHOD_NOT_FOUND,
            `Method "${methodName}" not found in class "${className}"`,
            `Class "${className}" has ${classInfo.methods.length} methods.`,
            suggestions.length > 0 ? 
                [`Did you mean: ${suggestions.join(', ')}?`, 'Check method name spelling and case.'] :
                ['Check method name spelling and case.', 'Ensure the method is declared in this class.'],
            { 
                filePath, 
                targetClass: className, 
                targetMethod: methodName, 
                availableMethods: classInfo.methods.map(m => m.name), 
                suggestions 
            }
        );

        return { exists: false, error, confidence: 'high' };
    }

    /**
     * Validate class existence with enhanced error reporting
     */
    public static async validateClass(filePath: string, className: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { 
                exists: false, 
                error: analysis.parseErrors?.[0] || this.createFileReadError(filePath), 
                confidence: 'high' 
            };
        }
        
        const classInfo = analysis.classes.get(className);
        if (classInfo) {
            return { exists: true, symbolInfo: classInfo, confidence: 'high' };
        }
        
        const suggestions = this.findSimilarNames(className, Array.from(analysis.classes.keys()));
        const error = this.createDetailedError(
            ErrorCategories.TARGET_ERROR_CLASS_NOT_FOUND,
            `Class "${className}" not found in ${filePath}`,
            `Searched ${analysis.classes.size} classes in the file.`,
            suggestions.length > 0 ? 
                [`Did you mean: ${suggestions.join(', ')}?`, 'Check class name spelling and case.'] :
                ['Check class name spelling and case.', 'Ensure the class is declared in this file.'],
            { 
                filePath, 
                targetClass: className, 
                availableClasses: Array.from(analysis.classes.keys()), 
                suggestions 
            }
        );
        
        return { exists: false, error, confidence: 'high' };
    }

    /**
     * Validate import existence with enhanced error reporting
     */
    public static async validateImport(filePath: string, importName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable) {
            return { 
                exists: false, 
                error: analysis.parseErrors?.[0] || this.createFileReadError(filePath), 
                confidence: 'high' 
            };
        }
        
        const imp = analysis.imports.find(i => i.name === importName);
        if (imp) {
            return { exists: true, symbolInfo: imp, confidence: 'high' };
        }
        
        const suggestions = this.findSimilarNames(importName, analysis.imports.map(i => i.name));
        const error = this.createDetailedError(
            ErrorCategories.TARGET_ERROR_NOT_FOUND,
            `Import "${importName}" not found in ${filePath}`,
            `Searched ${analysis.imports.length} imports in the file.`,
            suggestions.length > 0 ? 
                [`Did you mean: ${suggestions.join(', ')}?`, 'Check import name spelling.'] :
                ['Check import name spelling.', 'Ensure the import statement exists.'],
            { 
                filePath, 
                targetImport: importName, 
                availableImports: analysis.imports.map(i => i.name), 
                suggestions 
            }
        );
        
        return { exists: false, error, confidence: 'high' };
    }

    /**
     * Validates if a specific block of text exists as a distinct AST node.
     */
    public static async validateBlock(filePath: string, targetText: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        console.log('🔍 VALIDATE BLOCK START:', filePath);
        console.log('🔍 Target text length:', targetText.length);
        console.log('🔍 Target text:', targetText.substring(0, 100));
        
        const analysis = await this.analyzeFile(filePath, workspace);
        if (!analysis.isReadable || !analysis.tree) {
            console.log('❌ File not readable or no tree');
            return { 
                exists: false, 
                error: analysis.parseErrors?.[0] || this.createFileReadError(filePath), 
                confidence: 'high' 
            };
        }
        
        console.log('✅ File analysis complete, looking for node...');
        
        const fileContent = analysis.content || '';
        const manualIndex = fileContent.indexOf(targetText.trim());
        if (manualIndex >= 0) {
            console.log('✅ Target found manually at index:', manualIndex);
            console.log('📍 Manual context:', fileContent.substring(Math.max(0, manualIndex - 20), manualIndex + targetText.length + 20));
        } else {
            console.log('❌ Target NOT found manually');
            
            if (targetText.includes('enum ')) {
                const enumNameMatch = targetText.match(/enum\s+(\w+)/);
                if (enumNameMatch) {
                    const enumName = enumNameMatch[1];
                    const enumOnlyPattern = `enum ${enumName}`;
                    const enumIndex = fileContent.indexOf(enumOnlyPattern);
                    console.log(`🔍 Looking for just "${enumOnlyPattern}":`, enumIndex >= 0 ? `Found at ${enumIndex}` : 'Not found');
                }
            }
        }
        
        const node = this.findNodeByText(analysis.tree, targetText);
        
        if (node) {
            console.log('✅ NODE FOUND!');
            console.log('   Type:', node.type);
            console.log('   Start:', node.startIndex);
            console.log('   End:', node.endIndex);
            console.log('   Text length:', node.text.length);
            
            const actualContent = fileContent.substring(node.startIndex, node.endIndex);
            console.log('📄 ACTUAL CONTENT FROM NODE:');
            console.log('---START---');
            console.log(actualContent);
            console.log('---END---');
            
            const normalizedActual = actualContent.trim();
            const normalizedTarget = targetText.trim();
            
            if (normalizedActual === normalizedTarget) {
                console.log('✅ PERFECT MATCH - Content matches exactly');
            } else if (normalizedActual.includes(normalizedTarget.replace('export ', ''))) {
                console.log('⚠️ PARTIAL MATCH - Found enum but missing export keyword');
            } else {
                console.log('❌ CONTENT MISMATCH - Node content does not match target');
                console.log('   Actual length:', normalizedActual.length);
                console.log('   Target length:', normalizedTarget.length);
            }
            
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
        
        console.log('❌ No node found');
        const suggestions = this.findSimilarText(targetText, fileContent);
        const error = this.createDetailedError(
            ErrorCategories.TARGET_ERROR_BLOCK_NOT_FOUND,
            `Code block not found as a distinct syntax node`,
            `Could not locate a syntax tree node matching the target text: "${targetText.substring(0, 50)}${targetText.length > 50 ? '...' : ''}"`,
            suggestions.length > 0 ? 
                [`Similar text found: ${suggestions.join(', ')}`, 'Ensure the target is an exact copy from the file.'] :
                ['Ensure the target is an exact copy from the file.', 'Check for extra whitespace or formatting differences.'],
            { 
                filePath, 
                targetText: targetText.substring(0, 200), 
                suggestions,
                searchMethod: 'tree-sitter AST traversal'
            }
        );
        
        return { exists: false, error, confidence: 'high' };
    }

    // --- PRIVATE HELPER METHODS ---

    /**
     * Extract symbols using Tree-sitter queries
     */
    private static extractSymbols(tree: any, language: string, queryType: 'functions' | 'classes' | 'imports' | 'methods', contextNode?: any): SymbolInfo[] {
        const captures = this._treeSitterService.query(tree, language, queryType);
        const symbols: SymbolInfo[] = [];

        for (const capture of captures) {
            const nameNode = capture.node;
            let symbolBlockNode = nameNode.parent;
            
            if (symbolBlockNode?.parent?.type === 'export_statement') {
                symbolBlockNode = symbolBlockNode.parent;
            }

            if (symbolBlockNode) {
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

    /**
     * Extract classes with their methods
     */
    private static extractClassesWithMethods(tree: any, language: string): Map<string, ClassInfo> {
        const classMap = new Map<string, ClassInfo>();
        const classSymbols = this.extractSymbols(tree, language, 'classes');

        for (const classSymbol of classSymbols) {
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

    /**
     * Find AST node by text content with enhanced matching strategies
     */
    private static findNodeByText(tree: any, text: string): any | undefined {
        console.log('🔍 FIND NODE BY TEXT CALLED');
        console.log('   Text length:', text.length);
        console.log('   Text preview:', text.substring(0, 100));
        
        // Try structural pattern match first
        console.log('🏗️ Trying structural pattern match...');
        let bestMatch = this.findStructuralMatch(tree, text);
        if (bestMatch) {
            console.log('✅ STRUCTURAL MATCH FOUND:', bestMatch.type, bestMatch.startIndex, bestMatch.endIndex);
            return bestMatch;
        }
        console.log('❌ No structural match found');

        // Try exact text match
        console.log('🎯 Trying exact text match...');
        bestMatch = this.findExactTextMatch(tree, text);
        if (bestMatch) {
            console.log('✅ EXACT TEXT MATCH FOUND:', bestMatch.type, bestMatch.startIndex, bestMatch.endIndex);
            return bestMatch;
        }
        console.log('❌ No exact text match found');

        // Fallback to fuzzy matching
        console.log('🔍 Trying fuzzy text match...');
        bestMatch = this.findFuzzyTextMatch(tree, text);
        if (bestMatch) {
            console.log('⚠️ FUZZY MATCH FOUND:', bestMatch.type, bestMatch.startIndex, bestMatch.endIndex);
            
            const nodeText = bestMatch.text;
            const normalizedTarget = this.normalizeCode(text);
            const normalizedNode = this.normalizeCode(nodeText);
            
            if (normalizedNode.includes(normalizedTarget) && nodeText.length < text.length * 3) {
                console.log('✅ Fuzzy match accepted');
                return bestMatch;
            } else {
                console.log('🚫 Fuzzy match rejected as too different from target');
                return undefined;
            }
        }
        
        console.log('❌ NO MATCH FOUND AT ALL');
        return undefined;
    }

    /**
     * Find node with exact text content match
     */
    private static findExactTextMatch(tree: any, targetText: string): any | undefined {
        const normalizedTarget = this.normalizeCode(targetText);
        let bestMatch: any | undefined;

        const walk = (node: any): void => {
            const normalizedNodeText = this.normalizeCode(node.text);
            
            if (normalizedNodeText === normalizedTarget) {
                if (!bestMatch || node.text.length < bestMatch.text.length) {
                    console.log('✅ EXACT TEXT MATCH FOUND:', node.type, node.startIndex, node.endIndex);
                    bestMatch = node;
                }
            }
            
            if (node.type === 'rule_set' && targetText.trim().endsWith('{')) {
                const selectorPart = targetText.replace(/\s*\{.*$/, '').trim();
                
                for (const child of node.children) {
                    if (child.type === 'selectors') {
                        for (const selector of child.children) {
                            if (selector.text === selectorPart) {
                                console.log('✅ EXACT CSS SELECTOR MATCH FOUND:', node.type, node.startIndex, node.endIndex);
                                bestMatch = node;
                                return;
                            }
                        }
                    }
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
     * Fallback fuzzy matching
     */
    private static findFuzzyTextMatch(tree: any, text: string): any | undefined {
        const targetNormalized = this.normalizeCode(text);
        let bestMatch: any | undefined;

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
     * Find node by structural pattern (e.g., enum declarations, function definitions, CSS rules)
     */
    private static findStructuralMatch(tree: any, targetText: string): any | undefined {
        console.log('🔍 Looking for structural match for:', targetText.substring(0, 50));
        
        if (targetText.includes('enum ')) {
            console.log('🎯 Target appears to be an enum, using enum-specific search');
            return this.findEnumDeclaration(tree, targetText);
        }
        
        if (targetText.includes('function ') || targetText.match(/^\s*(async\s+)?function\s+\w+/)) {
            console.log('🎯 Target appears to be a function, using function-specific search');
            return this.findFunctionDeclaration(tree, targetText);
        }
        
        if (targetText.trim().match(/^[a-zA-Z#.][a-zA-Z0-9-_#.:,\s]*\s*\{[\s\S]*\}$/)) {
            console.log('🎯 Target appears to be a complete CSS rule, using CSS rule search');
            return this.findCSSRule(tree, targetText);
        }
        
        if (targetText.trim().match(/^[a-zA-Z#.][a-zA-Z0-9-_#.:,\s]*\s*\{?\s*$/)) {
            console.log('🎯 Target appears to be a CSS selector, using CSS selector search');
            return this.findCSSRuleBySelector(tree, targetText);
        }
        
        console.log('❌ No specific structural pattern detected');
        return undefined;
    }

    // CSS-specific search methods
    private static findCSSRule(tree: any, targetText: string): any | undefined {
        console.log('🎯 FIND CSS RULE - Looking for complete rule');
        
        function walk(node: any): any | undefined {
            if (node.type === 'rule_set') {
                const normalizedTarget = targetText.replace(/\s+/g, ' ').trim();
                const normalizedNode = node.text.replace(/\s+/g, ' ').trim();
                
                if (normalizedNode.includes(normalizedTarget.substring(0, 50))) {
                    console.log('✅ Found potential CSS rule match');
                    return node;
                }
            }
            
            for (const child of node.children) {
                const result = walk(child);
                if (result) return result;
            }
            
            return undefined;
        }
        
        return walk(tree.rootNode);
    }

    private static findCSSRuleBySelector(tree: any, targetText: string): any | undefined {
        const selectorMatch = targetText.trim().replace(/\s*\{.*$/, '').trim();
        console.log('🎯 FIND CSS RULE BY SELECTOR - Looking for selector:', selectorMatch);
        
        function walk(node: any): any | undefined {
            if (node.type === 'rule_set') {
                for (const child of node.children) {
                    if (child.type === 'selectors') {
                        for (const selector of child.children) {
                            if ((selector.type === 'tag_name' || selector.type === 'type_selector' || 
                                 selector.type === 'class_selector' || selector.type === 'id_selector') && 
                                selector.text === selectorMatch) {
                                console.log('✅ Found CSS rule for selector:', selectorMatch);
                                return node;
                            }
                        }
                    }
                }
            }
            
            for (const child of node.children) {
                const result = walk(child);
                if (result) return result;
            }
            
            return undefined;
        }
        
        return walk(tree.rootNode);
    }

    // Function and enum specific search methods
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
                if (result) return result;
            }
            
            return undefined;
        }
        
        return walk(tree.rootNode);
    }

    private static findEnumDeclaration(tree: any, targetText: string): any | undefined {
        console.log('🏗️ FIND ENUM DECLARATION CALLED');
        
        const enumNameMatch = targetText.match(/enum\s+(\w+)/);
        if (!enumNameMatch) {
            console.log('❌ No enum name found in target text');
            return undefined;
        }
        
        const enumName = enumNameMatch[1];
        console.log('🎯 Looking for enum:', enumName);
        console.log('🎯 Target text starts with export?', targetText.trim().startsWith('export'));
        
        function walk(node: any, depth: number = 0): any | undefined {
            const indent = '  '.repeat(depth);
            
            if (node.type === 'export_statement') {
                console.log(`${indent}📤 Found export_statement at depth ${depth}`);
                
                for (const child of node.children) {
                    if (child.type === 'enum_declaration') {
                        console.log(`${indent}   📋 Found enum_declaration inside export_statement`);
                        
                        for (const enumChild of child.children) {
                            if (enumChild.type === 'identifier' && enumChild.text === enumName) {
                                console.log(`${indent}   ✅ EXPORTED ENUM NAME MATCH FOUND!`);
                                return node;
                            }
                        }
                    }
                }
            }
            
            if (node.type === 'enum_declaration') {
                console.log(`${indent}📋 Found standalone enum_declaration at depth ${depth}`);
                
                for (const child of node.children) {
                    if (child.type === 'identifier' && child.text === enumName) {
                        console.log(`${indent}   ✅ STANDALONE ENUM NAME MATCH FOUND!`);
                        if (!targetText.trim().startsWith('export')) {
                            console.log(`${indent}   Returning standalone enum node`);
                            return node;
                        } else {
                            console.log(`${indent}   ❌ Target expects export but this is standalone, skipping`);
                        }
                    }
                }
            }
            
            for (const child of node.children) {
                const result = walk(child, depth + 1);
                if (result) return result;
            }
            
            return undefined;
        }
        
        const result = walk(tree.rootNode);
        if (result) {
            console.log('✅ ENUM DECLARATION FOUND AND RETURNED');
            console.log('   Node type:', result.type);
            console.log('   Includes export?', result.type === 'export_statement');
        } else {
            console.log('❌ ENUM DECLARATION NOT FOUND');
        }
        
        return result;
    }

    /**
     * Normalize code for comparison by removing extra whitespace and formatting
     */
    private static normalizeCode(code: string): string {
        return code
            .replace(/\/\*[\s\S]*?\*\//g, '')  // Remove CSS comments
            .replace(/\s+/g, ' ')              // Replace all whitespace with single spaces
            .replace(/\s*{\s*/g, '{')          // Remove spaces around opening braces
            .replace(/\s*}\s*/g, '}')          // Remove spaces around closing braces
            .replace(/\s*;\s*/g, ';')          // Remove spaces around semicolons
            .replace(/\s*,\s*/g, ',')          // Remove spaces around commas
            .replace(/\s*=\s*/g, '=')          // Remove spaces around equals
            .replace(/\s*:\s*/g, ':')          // Remove spaces around colons (CSS properties)
            .trim();
    }

    /**
     * Get language from file extension
     */
    private static getLanguageFromFile(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap: { [key: string]: string } = {
            '.js': 'javascript', 
            '.ts': 'typescript', 
            '.py': 'python', 
            '.rs': 'rust',
            '.css': 'css',
            '.scss': 'css',  
            '.less': 'css'
        };
        return languageMap[ext] || 'unknown';
    }

    /**
     * Find similar names using string similarity
     */
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
     * Find similar text lines in content
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
                suggestions.push(trimmedLine.substring(0, 100));
                if (suggestions.length >= maxSuggestions) {
                    break;
                }
            }
        }
        return suggestions;
    }

    /**
     * Calculate string similarity using Levenshtein distance
     */
    private static calculateSimilarity(a: string, b: string): number {
        const longer = a.length > b.length ? a : b;
        const shorter = a.length > b.length ? b : a;
        
        if (longer.length === 0) {
            return 1.0;
        }
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
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

    /**
     * Create a standardized DetailedError object
     */
    private static createDetailedError(
        code: string,
        message: string,
        details: string,
        suggestions: string[] = [],
        context?: any
    ): DetailedError {
        return {
            code,
            message,
            details,
            suggestions,
            context
        };
    }

    /**
     * Create a standard file read error
     */
    private static createFileReadError(filePath: string): DetailedError {
        return this.createDetailedError(
            ErrorCategories.FILE_ERROR_READ_FAILED,
            `Cannot read file: ${filePath}`,
            'File may not exist, be inaccessible, or have permission restrictions.',
            [
                'Check if the file exists in the workspace.',
                'Verify file permissions.',
                'Ensure the file path is correct.'
            ],
            { filePath }
        );
    }
}

/**
 * Helper function to convert a 0-based offset to a 1-based line and column Position object
 */
export function offsetToPosition(content: string, offset: number): Position {
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