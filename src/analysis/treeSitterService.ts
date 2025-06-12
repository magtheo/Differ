import * as vscode from 'vscode';

interface TreeSitterQueries {
    functions: string;
    classes: string;
    imports: string;
    methods?: string; // Query to find methods within a class context
}

export class TreeSitterService {
    private _parser: any; // Will be Parser instance
    private _languageMap: Map<string, any> = new Map();
    private _queryMap: Map<string, TreeSitterQueries> = new Map();
    private _isInitialized = false;
    private _Parser: any; // Store the Parser class

    private constructor(private _extensionUri: vscode.Uri) {
        // The constructor is private to enforce initialization via the static `create` method.
    }

    /**
     * Creates and initializes the TreeSitterService.
     */
    public static async create(context: vscode.ExtensionContext): Promise<TreeSitterService> {
        const service = new TreeSitterService(context.extensionUri);
        await service.initialize();
        return service;
    }

    private async initialize(): Promise<void> {
        if (this._isInitialized) {
            return;
        }
        
        try {
            // Import web-tree-sitter dynamically
            console.log('🔄 Loading web-tree-sitter...');
            const treeSitterModule = await import('web-tree-sitter');
            
            // Handle different export patterns
            this._Parser = treeSitterModule.default || treeSitterModule;
            
            if (!this._Parser) {
                throw new Error('Failed to load Parser from web-tree-sitter');
            }

            // Initialize web-tree-sitter
            console.log('🔄 Initializing web-tree-sitter...');
            if (typeof this._Parser.init === 'function') {
                await this._Parser.init();
            } else {
                console.warn('⚠️ Parser.init is not available, skipping initialization');
            }
            
            // Create parser instance
            this._parser = new this._Parser();
            console.log('✅ Parser instance created');
            
            await this.loadLanguages();  // Load languages
            this.defineQueries();
            this._isInitialized = true;
            
            console.log('🎉 TreeSitterService initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize TreeSitterService:', error);
            this._isInitialized = false;
            throw error;
        }
    }

    private async loadLanguages(): Promise<void> {
        if (!this._Parser) {
            console.warn('⚠️ Parser not available, skipping language loading');
            return;
        }

        try {
            // For web-tree-sitter, you typically need to load .wasm files
            // These should be in your grammars folder
            const grammarPath = vscode.Uri.joinPath(this._extensionUri, 'grammars');
            
            // Try to load JavaScript grammar
            try {
                const jsWasmPath = vscode.Uri.joinPath(grammarPath, 'tree-sitter-javascript.wasm');
                const jsWasmData = await vscode.workspace.fs.readFile(jsWasmPath);
                const JavaScript = await this._Parser.Language.load(jsWasmData);
                this._languageMap.set('javascript', JavaScript);
                console.log('✅ Loaded JavaScript grammar');
            } catch (error) {
                console.warn('⚠️ Failed to load JavaScript grammar:', error);
            }

            // Try to load TypeScript grammar
            try {
                const tsWasmPath = vscode.Uri.joinPath(grammarPath, 'tree-sitter-typescript.wasm');
                const tsWasmData = await vscode.workspace.fs.readFile(tsWasmPath);
                const TypeScript = await this._Parser.Language.load(tsWasmData);
                this._languageMap.set('typescript', TypeScript);
                console.log('✅ Loaded TypeScript grammar');
            } catch (error) {
                console.warn('⚠️ Failed to load TypeScript grammar:', error);
            }

            // Try to load Python grammar
            try {
                const pyWasmPath = vscode.Uri.joinPath(grammarPath, 'tree-sitter-python.wasm');
                const pyWasmData = await vscode.workspace.fs.readFile(pyWasmPath);
                const Python = await this._Parser.Language.load(pyWasmData);
                this._languageMap.set('python', Python);
                console.log('✅ Loaded Python grammar');
            } catch (error) {
                console.warn('⚠️ Failed to load Python grammar:', error);
            }

            // Try to load Rust grammar
            try {
                const rustWasmPath = vscode.Uri.joinPath(grammarPath, 'tree-sitter-rust.wasm');
                const rustWasmData = await vscode.workspace.fs.readFile(rustWasmPath);
                const Rust = await this._Parser.Language.load(rustWasmData);
                this._languageMap.set('rust', Rust);
                console.log('✅ Loaded Rust grammar');
            } catch (error) {
                console.warn('⚠️ Failed to load Rust grammar:', error);
            }

            const loadedLanguages = Array.from(this._languageMap.keys());
            console.log(`🎯 TreeSitter initialized with languages: ${loadedLanguages.join(', ')}`);
            
        } catch (error) {
            console.error('❌ Failed to load any grammars:', error);
        }
    }

    private defineQueries(): void {
        // JavaScript and TypeScript share similar queries but might differ in specifics (e.g., interfaces)
        const tsQueries: TreeSitterQueries = {
            functions: `
                [
                    (function_declaration name: (identifier) @name)
                    (lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function)]))
                ]`,
            classes: `
                [
                    (class_declaration name: (type_identifier) @name)
                    (interface_declaration name: (type_identifier) @name)
                ]`,
            imports: `
                [
                    (import_statement (import_clause (identifier) @name))
                    (import_statement (import_clause (named_imports (import_specifier name: (identifier) @name))))
                ]`,
            methods: `(method_definition name: (property_identifier) @name)`
        };
        this._queryMap.set('typescript', tsQueries);
        this._queryMap.set('javascript', tsQueries);

        const pythonQueries: TreeSitterQueries = {
            functions: `(function_definition name: (identifier) @name)`,
            classes: `(class_definition name: (identifier) @name)`,
            imports: `
                [
                    (import_statement (dotted_name (identifier) @name))
                    (from_import_statement (dotted_name (identifier) @name))
                ]`
        };
        this._queryMap.set('python', pythonQueries);
    } // TODO: ADD rust queries
    
    private getLanguage(languageId: string): any | undefined {
        return this._languageMap.get(languageId);
    }

    public parse(code: string, languageId: string): any | undefined {
        if (!this._parser) {
            console.warn(`⚠️ Parser not initialized, cannot parse ${languageId} code`);
            return undefined;
        }

        const language = this.getLanguage(languageId);
        if (!language) {
            console.warn(`⚠️ Language ${languageId} not loaded, cannot parse`);
            return undefined;
        }
        
        try {
            this._parser.setLanguage(language);
            return this._parser.parse(code);
        } catch (error) {
            console.error(`❌ Failed to parse ${languageId} code:`, error);
            return undefined;
        }
    }

    public query(tree: any, languageId: string, queryType: keyof TreeSitterQueries): any[] {
        if (!tree) {
            console.warn(`⚠️ No tree provided for ${languageId} query`);
            return [];
        }

        const language = this.getLanguage(languageId);
        const queries = this._queryMap.get(languageId);

        if (!language || !queries || !queries[queryType]) {
            console.warn(`⚠️ Language ${languageId} or query ${queryType} not available`);
            return [];
        }

        try {
            const query = language.query(queries[queryType]!);
            const captures = query.captures(tree.rootNode);
            return captures;
        } catch (error) {
            console.error(`❌ Tree-sitter query failed for language ${languageId}, query type ${queryType}:`, error);
            return [];
        }
    }

    public isInitialized(): boolean {
        return this._isInitialized;
    }

    public getLoadedLanguages(): string[] {
        return Array.from(this._languageMap.keys());
    }
}