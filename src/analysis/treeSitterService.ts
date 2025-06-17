import * as vscode from 'vscode';

interface TreeSitterQueries {
    functions: string;
    classes: string;
    imports: string;
    methods?: string;
}

export class TreeSitterService {
    private _parser: any;
    private _languageMap: Map<string, any> = new Map();
    private _queryMap: Map<string, TreeSitterQueries> = new Map();
    private _isInitialized = false;
    private _Parser: any;
    private _Language: any; // Add this to store the Language class

    private constructor(private _extensionUri: vscode.Uri) {}

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
            console.log('🔄 Loading web-tree-sitter module...');
            
            // Import the bundled module
            const treeSitterModule = require('web-tree-sitter');
            
            // Handle different export patterns
            let ParserClass = treeSitterModule.default || treeSitterModule.Parser || treeSitterModule;
            
            // For bundled web-tree-sitter, the Language class might be accessed differently
            this._Language = treeSitterModule.Language || ParserClass.Language || treeSitterModule.default?.Language;
            
            if (!ParserClass || typeof ParserClass.init !== 'function') {
                throw new Error('Could not find Parser class with init method in web-tree-sitter module.');
            }
            
            if (!this._Language) {
                console.warn('⚠️ Language class not found, will try alternative approach');
            }
            
            this._Parser = ParserClass;
            
            console.log('🔄 Initializing web-tree-sitter Parser...');
            const wasmPath = vscode.Uri.joinPath(this._extensionUri, 'out', 'grammars', 'tree-sitter.wasm');
            
            const wasmBinary = await vscode.workspace.fs.readFile(wasmPath);
            await this._Parser.init({
                wasmBinary: wasmBinary,
            });
            
            this._parser = new this._Parser();
            console.log('✅ Parser instance created');
            
            await this.loadLanguages();
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
            const grammarPath = vscode.Uri.joinPath(this._extensionUri, 'out', 'grammars');
            
            // Try to load JavaScript grammar
            try {
                const jsWasmPath = vscode.Uri.joinPath(grammarPath, 'tree-sitter-javascript.wasm');
                const jsWasmData = await vscode.workspace.fs.readFile(jsWasmPath);
                
                // Try different approaches to load the language
                let JavaScript;
                if (this._Language && typeof this._Language.load === 'function') {
                    JavaScript = await this._Language.load(jsWasmData);
                } else if (this._Parser.Language && typeof this._Parser.Language.load === 'function') {
                    JavaScript = await this._Parser.Language.load(jsWasmData);
                } else {
                    // Alternative approach for bundled versions
                    const treeSitterModule = require('web-tree-sitter');
                    const Language = treeSitterModule.Language || treeSitterModule.default?.Language;
                    if (Language && typeof Language.load === 'function') {
                        JavaScript = await Language.load(jsWasmData);
                    } else {
                        throw new Error('Cannot find Language.load method');
                    }
                }
                
                this._languageMap.set('javascript', JavaScript);
                console.log('✅ Loaded JavaScript grammar');
            } catch (error) {
                console.warn('⚠️ Failed to load JavaScript grammar:', error);
            }

            // Try to load TypeScript grammar
            try {
                const tsWasmPath = vscode.Uri.joinPath(grammarPath, 'tree-sitter-typescript.wasm');
                const tsWasmData = await vscode.workspace.fs.readFile(tsWasmPath);
                
                let TypeScript;
                if (this._Language && typeof this._Language.load === 'function') {
                    TypeScript = await this._Language.load(tsWasmData);
                } else if (this._Parser.Language && typeof this._Parser.Language.load === 'function') {
                    TypeScript = await this._Parser.Language.load(tsWasmData);
                } else {
                    const treeSitterModule = require('web-tree-sitter');
                    const Language = treeSitterModule.Language || treeSitterModule.default?.Language;
                    if (Language && typeof Language.load === 'function') {
                        TypeScript = await Language.load(tsWasmData);
                    } else {
                        throw new Error('Cannot find Language.load method');
                    }
                }
                
                this._languageMap.set('typescript', TypeScript);
                console.log('✅ Loaded TypeScript grammar');
            } catch (error) {
                console.warn('⚠️ Failed to load TypeScript grammar:', error);
            }

            // Try to load Python grammar
            try {
                const pyWasmPath = vscode.Uri.joinPath(grammarPath, 'tree-sitter-python.wasm');
                const pyWasmData = await vscode.workspace.fs.readFile(pyWasmPath);
                
                let Python;
                if (this._Language && typeof this._Language.load === 'function') {
                    Python = await this._Language.load(pyWasmData);
                } else if (this._Parser.Language && typeof this._Parser.Language.load === 'function') {
                    Python = await this._Parser.Language.load(pyWasmData);
                } else {
                    const treeSitterModule = require('web-tree-sitter');
                    const Language = treeSitterModule.Language || treeSitterModule.default?.Language;
                    if (Language && typeof Language.load === 'function') {
                        Python = await Language.load(pyWasmData);
                    } else {
                        throw new Error('Cannot find Language.load method');
                    }
                }
                
                this._languageMap.set('python', Python);
                console.log('✅ Loaded Python grammar');
            } catch (error) {
                console.warn('⚠️ Failed to load Python grammar:', error);
            }

            // Try to load Rust grammar
            try {
                const rustWasmPath = vscode.Uri.joinPath(grammarPath, 'tree-sitter-rust.wasm');
                const rustWasmData = await vscode.workspace.fs.readFile(rustWasmPath);
                
                let Rust;
                if (this._Language && typeof this._Language.load === 'function') {
                    Rust = await this._Language.load(rustWasmData);
                } else if (this._Parser.Language && typeof this._Parser.Language.load === 'function') {
                    Rust = await this._Parser.Language.load(rustWasmData);
                } else {
                    const treeSitterModule = require('web-tree-sitter');
                    const Language = treeSitterModule.Language || treeSitterModule.default?.Language;
                    if (Language && typeof Language.load === 'function') {
                        Rust = await Language.load(rustWasmData);
                    } else {
                        throw new Error('Cannot find Language.load method');
                    }
                }
                
                this._languageMap.set('rust', Rust);
                console.log('✅ Loaded Rust grammar');
            } catch (error) {
                console.warn('⚠️ Failed to load Rust grammar:', error);
            }

            try {
                const cssWasmPath = vscode.Uri.joinPath(grammarPath, 'tree-sitter-css.wasm');
                const cssWasmData = await vscode.workspace.fs.readFile(cssWasmPath);
                
                let CSS;
                if (this._Language && typeof this._Language.load === 'function') {
                    CSS = await this._Language.load(cssWasmData);
                } else if (this._Parser.Language && typeof this._Parser.Language.load === 'function') {
                    CSS = await this._Parser.Language.load(cssWasmData);
                } else {
                    const treeSitterModule = require('web-tree-sitter');
                    const Language = treeSitterModule.Language || treeSitterModule.default?.Language;
                    if (Language && typeof Language.load === 'function') {
                        CSS = await Language.load(cssWasmData);
                    } else {
                        throw new Error('Cannot find Language.load method');
                    }
                }
                
                this._languageMap.set('css', CSS);
                console.log('✅ Loaded CSS grammar');
            } catch (error) {
                console.warn('⚠️ Failed to load CSS grammar:', error);
            }

            const loadedLanguages = Array.from(this._languageMap.keys());
            console.log(`🎯 TreeSitter initialized with languages: ${loadedLanguages.join(', ')}`);
            
        } catch (error) {
            console.error('❌ Failed to load any grammars:', error);
        }
    }

    private defineQueries(): void {
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

        const cssQueries: TreeSitterQueries = {
            functions: `(rule_set (selectors) @name)`,
            classes: `(class_selector (class_name) @name)`,
            imports: `(import_statement (string_value) @name)`  // ← Fixed: removed extra parenthesis
        };
        this._queryMap.set('css', cssQueries);
    }
    
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
            // FIX: Use the new Query constructor instead of language.query()
            const treeSitterModule = require('web-tree-sitter');
            const Query = treeSitterModule.Query || treeSitterModule.default?.Query;
            
            if (Query) {
                const query = new Query(language, queries[queryType]!);
                const captures = query.captures(tree.rootNode);
                return captures;
            } else {
                // Fallback to the old method if new one isn't available
                const query = language.query(queries[queryType]!);
                const captures = query.captures(tree.rootNode);
                return captures;
            }
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