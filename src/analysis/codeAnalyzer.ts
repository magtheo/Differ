import * as vscode from 'vscode';
import * as path from 'path';
import { ValidationError, ValidationWarning } from '../parser/inputParser';

export interface TargetValidationResult {
    exists: boolean;
    location?: { line: number; column: number; };
    suggestions?: string[];  // Similar function names if not found
    reason?: string;  // Why validation failed
    confidence: 'high' | 'medium' | 'low';  // How confident we are in the result
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
}

export class CodeAnalyzer {
    private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit
    private static readonly FUNCTION_PATTERNS = {
        javascript: [
            /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
            /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*)?=>/g,
            /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s+)?(?:function\s*)?\(/g,
        ],
        typescript: [
            /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
            /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*)?=>/g,
            /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s+)?(?:function\s*)?\(/g,
            /(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
        ],
        python: [
            /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
            /async\s+def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
        ],
        java: [
            /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?[a-zA-Z<>\[\]]+\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
        ],
        cpp: [
            /(?:inline\s+)?(?:virtual\s+)?(?:static\s+)?[a-zA-Z_][a-zA-Z0-9_<>:]*\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
        ],
        rust: [
            /fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
            /pub\s+fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
        ],
        go: [
            /func\s+(?:\([^)]*\)\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
        ],
    };

    private static readonly CLASS_PATTERNS = {
        javascript: [
            /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
        ],
        typescript: [
            /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
            /interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
        ],
        python: [
            /class\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
        ],
        java: [
            /(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
            /(?:public\s+)?interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
        ],
        cpp: [
            /class\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
            /struct\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
        ],
        rust: [
            /struct\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
            /enum\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
            /trait\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
        ],
    };

    private static readonly IMPORT_PATTERNS = {
        javascript: [
            /import\s+(?:\*\s+as\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
            /import\s+\{([^}]+)\}/g,
            /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*require\(/g,
        ],
        typescript: [
            /import\s+(?:\*\s+as\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
            /import\s+\{([^}]+)\}/g,
        ],
        python: [
            /import\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
            /from\s+[a-zA-Z_][a-zA-Z0-9_.]*\s+import\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
        ],
        java: [
            /import\s+(?:static\s+)?[a-zA-Z_][a-zA-Z0-9_.]*\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
        ],
    };

    /**
     * Analyze a file and extract its structure
     */
    public static async analyzeFile(filePath: string, workspace: vscode.WorkspaceFolder): Promise<FileAnalysisResult> {
        const fullPath = vscode.Uri.joinPath(workspace.uri, filePath);
        
        try {
            // Check if file exists
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

            // Check file size
            if (fileStat.size > this.MAX_FILE_SIZE) {
                return {
                    fileExists: true,
                    isReadable: false,
                    functions: [],
                    classes: new Map(),
                    imports: [],
                    lineCount: 0,
                    parseErrors: [`File too large (${fileStat.size} bytes). Maximum size is ${this.MAX_FILE_SIZE} bytes.`]
                };
            }

            // Read file content
            let content: string;
            try {
                const fileData = await vscode.workspace.fs.readFile(fullPath);
                content = Buffer.from(fileData).toString('utf8');
            } catch (error) {
                return {
                    fileExists: true,
                    isReadable: false,
                    functions: [],
                    classes: new Map(),
                    imports: [],
                    lineCount: 0,
                    parseErrors: [`Cannot read file: ${error}`]
                };
            }

            // Determine language
            const language = this.getLanguageFromFile(filePath);
            const lineCount = content.split('\n').length;

            // Parse content
            const functions = this.extractFunctions(content, language);
            const classes = this.extractClasses(content, language);
            const imports = this.extractImports(content, language);

            return {
                fileExists: true,
                isReadable: true,
                content,
                language,
                functions,
                classes,
                imports,
                lineCount
            };

        } catch (error) {
            return {
                fileExists: false,
                isReadable: false,
                functions: [],
                classes: new Map(),
                imports: [],
                lineCount: 0,
                parseErrors: [`Analysis failed: ${error}`]
            };
        }
    }

    /**
     * Validate if a function exists in the file
     */
    public static async validateFunction(filePath: string, functionName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        
        if (!analysis.fileExists) {
            return {
                exists: false,
                reason: `File "${filePath}" does not exist`,
                confidence: 'high',
                suggestions: []
            };
        }

        if (!analysis.isReadable) {
            return {
                exists: false,
                reason: analysis.parseErrors?.[0] || 'File cannot be read',
                confidence: 'high',
                suggestions: []
            };
        }

        // Check if function exists
        const functionExists = analysis.functions.includes(functionName);
        
        if (functionExists) {
            // Try to find the exact location
            const location = this.findFunctionLocation(analysis.content!, functionName, analysis.language!);
            return {
                exists: true,
                location,
                confidence: 'high'
            };
        }

        // Function not found - provide suggestions
        const suggestions = this.findSimilarNames(functionName, analysis.functions);
        
        return {
            exists: false,
            reason: `Function "${functionName}" not found in ${filePath}`,
            confidence: 'high',
            suggestions
        };
    }

    /**
     * Validate if a method exists in a class
     */
    public static async validateMethod(filePath: string, className: string, methodName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        
        if (!analysis.fileExists) {
            return {
                exists: false,
                reason: `File "${filePath}" does not exist`,
                confidence: 'high',
                suggestions: []
            };
        }

        if (!analysis.isReadable) {
            return {
                exists: false,
                reason: analysis.parseErrors?.[0] || 'File cannot be read',
                confidence: 'high',
                suggestions: []
            };
        }

        // Check if class exists
        const classMethods = analysis.classes.get(className);
        if (!classMethods) {
            const suggestions = this.findSimilarNames(className, Array.from(analysis.classes.keys()));
            return {
                exists: false,
                reason: `Class "${className}" not found in ${filePath}`,
                confidence: 'high',
                suggestions: suggestions.map(s => `Class suggestion: ${s}`)
            };
        }

        // Check if method exists in class
        const methodExists = classMethods.includes(methodName);
        
        if (methodExists) {
            // Try to find the exact location
            const location = this.findMethodLocation(analysis.content!, className, methodName, analysis.language!);
            return {
                exists: true,
                location,
                confidence: 'medium' // Medium confidence since class parsing is more complex
            };
        }

        // Method not found - provide suggestions
        const suggestions = this.findSimilarNames(methodName, classMethods);
        
        return {
            exists: false,
            reason: `Method "${methodName}" not found in class "${className}"`,
            confidence: 'high',
            suggestions: suggestions.map(s => `Method suggestion: ${s}`)
        };
    }

    /**
     * Validate if a class exists in the file
     */
    public static async validateClass(filePath: string, className: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        
        if (!analysis.fileExists) {
            return {
                exists: false,
                reason: `File "${filePath}" does not exist`,
                confidence: 'high',
                suggestions: []
            };
        }

        if (!analysis.isReadable) {
            return {
                exists: false,
                reason: analysis.parseErrors?.[0] || 'File cannot be read',
                confidence: 'high',
                suggestions: []
            };
        }

        // Check if class exists
        const classExists = analysis.classes.has(className);
        
        if (classExists) {
            // Try to find the exact location
            const location = this.findClassLocation(analysis.content!, className, analysis.language!);
            return {
                exists: true,
                location,
                confidence: 'high'
            };
        }

        // Class not found - provide suggestions
        const suggestions = this.findSimilarNames(className, Array.from(analysis.classes.keys()));
        
        return {
            exists: false,
            reason: `Class "${className}" not found in ${filePath}`,
            confidence: 'high',
            suggestions
        };
    }

    /**
     * Validate if an import exists in the file
     */
    public static async validateImport(filePath: string, importName: string, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        const analysis = await this.analyzeFile(filePath, workspace);
        
        if (!analysis.fileExists) {
            return {
                exists: false,
                reason: `File "${filePath}" does not exist`,
                confidence: 'high',
                suggestions: []
            };
        }

        if (!analysis.isReadable) {
            return {
                exists: false,
                reason: analysis.parseErrors?.[0] || 'File cannot be read',
                confidence: 'high',
                suggestions: []
            };
        }

        // Check if import exists
        const importExists = analysis.imports.some(imp => 
            imp.includes(importName) || importName.includes(imp)
        );
        
        if (importExists) {
            return {
                exists: true,
                confidence: 'medium' // Medium confidence since import parsing can be complex
            };
        }

        // Import not found - provide suggestions
        const suggestions = this.findSimilarNames(importName, analysis.imports);
        
        return {
            exists: false,
            reason: `Import "${importName}" not found in ${filePath}`,
            confidence: 'high',
            suggestions
        };
    }

    /**
     * Get programming language from file extension
     */
    private static getLanguageFromFile(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap: { [key: string]: string } = {
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp',
            '.cc': 'cpp',
            '.cxx': 'cpp',
            '.c': 'cpp',
            '.h': 'cpp',
            '.hpp': 'cpp',
            '.rs': 'rust',
            '.go': 'go',
            '.php': 'php',
            '.rb': 'ruby',
            '.cs': 'csharp',
            '.kt': 'kotlin'
        };
        
        return languageMap[ext] || 'unknown';
    }

    /**
     * Extract function names from content
     */
    private static extractFunctions(content: string, language: string): string[] {
        const patterns = this.FUNCTION_PATTERNS[language as keyof typeof this.FUNCTION_PATTERNS] || [];
        const functions = new Set<string>();
        
        for (const pattern of patterns) {
            pattern.lastIndex = 0; // Reset regex state
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1] && match[1].trim()) {
                    functions.add(match[1].trim());
                }
            }
        }
        
        return Array.from(functions).sort();
    }

    /**
     * Extract class names and their methods from content
     */
    private static extractClasses(content: string, language: string): Map<string, string[]> {
        const patterns = this.CLASS_PATTERNS[language as keyof typeof this.CLASS_PATTERNS] || [];
        const classes = new Map<string, string[]>();
        
        // First, find all classes
        const classNames = new Set<string>();
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1] && match[1].trim()) {
                    classNames.add(match[1].trim());
                }
            }
        }
        
        // For each class, try to find its methods
        for (const className of classNames) {
            const methods = this.extractMethodsFromClass(content, className, language);
            classes.set(className, methods);
        }
        
        return classes;
    }

    /**
     * Extract method names from a specific class
     */
    private static extractMethodsFromClass(content: string, className: string, language: string): string[] {
        const methods = new Set<string>();
        
        // Find the class definition
        const classRegex = new RegExp(`class\\s+${className}\\s*(?:extends\\s+[^{]*)?\\s*{`, 'g');
        const classMatch = classRegex.exec(content);
        
        if (!classMatch) {
            return [];
        }
        
        // Find the class body (simplified - doesn't handle nested classes perfectly)
        let braceCount = 0;
        let classStart = classMatch.index + classMatch[0].length;
        let classEnd = classStart;
        
        for (let i = classStart; i < content.length; i++) {
            if (content[i] === '{') {
                braceCount++;
            } else if (content[i] === '}') {
                braceCount--;
                if (braceCount === -1) {
                    classEnd = i;
                    break;
                }
            }
        }
        
        const classBody = content.substring(classStart, classEnd);
        
        // Extract methods from class body
        const methodPatterns = this.FUNCTION_PATTERNS[language as keyof typeof this.FUNCTION_PATTERNS] || [];
        
        for (const pattern of methodPatterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(classBody)) !== null) {
                if (match[1] && match[1].trim() && match[1] !== className) {
                    methods.add(match[1].trim());
                }
            }
        }
        
        return Array.from(methods).sort();
    }

    /**
     * Extract import names from content
     */
    private static extractImports(content: string, language: string): string[] {
        const patterns = this.IMPORT_PATTERNS[language as keyof typeof this.IMPORT_PATTERNS] || [];
        const imports = new Set<string>();
        
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1] && match[1].trim()) {
                    // Handle destructured imports
                    if (match[1].includes(',')) {
                        const destructured = match[1].split(',').map(s => s.trim());
                        destructured.forEach(imp => imports.add(imp));
                    } else {
                        imports.add(match[1].trim());
                    }
                }
            }
        }
        
        return Array.from(imports).sort();
    }

    /**
     * Find similar names using simple string similarity
     */
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
     * Find the location of a function in the file
     */
    private static findFunctionLocation(content: string, functionName: string, language: string): { line: number; column: number; } | undefined {
        const lines = content.split('\n');
        const patterns = this.FUNCTION_PATTERNS[language as keyof typeof this.FUNCTION_PATTERNS] || [];
        
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            
            for (const pattern of patterns) {
                pattern.lastIndex = 0;
                const match = pattern.exec(line);
                if (match && match[1] === functionName) {
                    return {
                        line: lineIndex + 1, // 1-based line numbers
                        column: match.index + 1 // 1-based column numbers
                    };
                }
            }
        }
        
        return undefined;
    }

    /**
     * Find the location of a method in a class
     */
    private static findMethodLocation(content: string, className: string, methodName: string, language: string): { line: number; column: number; } | undefined {
        // This is a simplified implementation
        // A more robust version would parse the class structure properly
        const lines = content.split('\n');
        let inClass = false;
        let braceCount = 0;
        
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            
            // Check if we're entering the target class
            if (!inClass && line.includes(`class ${className}`)) {
                inClass = true;
                continue;
            }
            
            if (inClass) {
                // Track braces to know when we exit the class
                braceCount += (line.match(/\{/g) || []).length;
                braceCount -= (line.match(/\}/g) || []).length;
                
                if (braceCount < 0) {
                    // Exited the class
                    break;
                }
                
                // Look for the method in this line
                const methodPatterns = this.FUNCTION_PATTERNS[language as keyof typeof this.FUNCTION_PATTERNS] || [];
                for (const pattern of methodPatterns) {
                    pattern.lastIndex = 0;
                    const match = pattern.exec(line);
                    if (match && match[1] === methodName) {
                        return {
                            line: lineIndex + 1,
                            column: match.index + 1
                        };
                    }
                }
            }
        }
        
        return undefined;
    }

    /**
     * Find the location of a class in the file
     */
    private static findClassLocation(content: string, className: string, language: string): { line: number; column: number; } | undefined {
        const lines = content.split('\n');
        const patterns = this.CLASS_PATTERNS[language as keyof typeof this.CLASS_PATTERNS] || [];
        
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            
            for (const pattern of patterns) {
                pattern.lastIndex = 0;
                const match = pattern.exec(line);
                if (match && match[1] === className) {
                    return {
                        line: lineIndex + 1,
                        column: match.index + 1
                    };
                }
            }
        }
        
        return undefined;
    }
}