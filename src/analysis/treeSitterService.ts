import * as vscode from 'vscode';

interface TreeSitterQueries {
    functions: string;
    classes: string;
    imports: string;
    methods?: string;
}

interface LanguageConfig {
    id: string;
    wasmFile: string;
    displayName: string;
}

export class TreeSitterService {
    private _parser: any;
    private _languageMap: Map<string, any> = new Map();
    private _queryMap: Map<string, TreeSitterQueries> = new Map();
    private _isInitialized = false;
    private _Parser: any;
    private _Language: any;

    private static readonly SUPPORTED_LANGUAGES: LanguageConfig[] = [
        { id: 'javascript', wasmFile: 'tree-sitter-javascript.wasm', displayName: 'JavaScript' },
        { id: 'typescript', wasmFile: 'tree-sitter-typescript.wasm', displayName: 'TypeScript' },
        { id: 'python', wasmFile: 'tree-sitter-python.wasm', displayName: 'Python' },
        { id: 'rust', wasmFile: 'tree-sitter-rust.wasm', displayName: 'Rust' },
        { id: 'css', wasmFile: 'tree-sitter-css.wasm', displayName: 'CSS' }
    ];

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
            
            for (const config of TreeSitterService.SUPPORTED_LANGUAGES) {
                await this.loadSingleLanguage(config, grammarPath);
            }

            const loadedLanguages = Array.from(this._languageMap.keys());
            console.log(`🎯 TreeSitter initialized with languages: ${loadedLanguages.join(', ')}`);
            
        } catch (error) {
            console.error('❌ Failed to load any grammars:', error);
        }
    }

    private async loadSingleLanguage(config: LanguageConfig, grammarPath: vscode.Uri): Promise<void> {
        try {
            const wasmPath = vscode.Uri.joinPath(grammarPath, config.wasmFile);
            const wasmData = await vscode.workspace.fs.readFile(wasmPath);
            
            let language;
            if (this._Language && typeof this._Language.load === 'function') {
                language = await this._Language.load(wasmData);
            } else if (this._Parser.Language && typeof this._Parser.Language.load === 'function') {
                language = await this._Parser.Language.load(wasmData);
            } else {
                const treeSitterModule = require('web-tree-sitter');
                const Language = treeSitterModule.Language || treeSitterModule.default?.Language;
                if (Language && typeof Language.load === 'function') {
                    language = await Language.load(wasmData);
                } else {
                    throw new Error('Cannot find Language.load method');
                }
            }
            
            this._languageMap.set(config.id, language);
            console.log(`✅ Loaded ${config.displayName} grammar`);
            
        } catch (error) {
            console.warn(`⚠️ Failed to load ${config.displayName} grammar:`, error);
        }
    }

    private defineQueries(): void {
        // FIXED: Correct JavaScript/TypeScript queries with proper node names
        const jsQueries: TreeSitterQueries = {
            functions: `
                [
                    (function_declaration name: (identifier) @name)
                    (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])
                    (method_definition name: (property_identifier) @name)
                ]`,
            classes: `
                [
                    (class_declaration name: (identifier) @name)
                ]`,
            imports: `
                [
                    (import_statement (import_clause (identifier) @name))
                    (import_statement (import_clause (named_imports (import_specifier name: (identifier) @name))))
                ]`,
            methods: `(method_definition name: (property_identifier) @name)`
        };
        this._queryMap.set('javascript', jsQueries);

        // TypeScript has additional node types
        const tsQueries: TreeSitterQueries = {
        functions: `
            [
                (function_declaration name: (identifier) @name)
                (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])
                (method_definition name: (property_identifier) @name)
                (method_signature name: (property_identifier) @name)
            ]`,
        classes: `
            [
                (class_declaration name: (type_identifier) @name)
                (interface_declaration name: (type_identifier) @name)
                (type_alias_declaration name: (type_identifier) @name)
                (enum_declaration name: (identifier) @name) 
            ]`, // Corrected to use type_identifier and added enum
        imports: `
            [
                (import_statement (import_clause (identifier) @name))
                (import_statement (import_clause (named_imports (import_specifier name: (identifier) @name))))
            ]`,
        methods: `
            [
                (method_definition name: (property_identifier) @name)
                (method_signature name: (property_identifier) @name)
            ]`
    };
        this._queryMap.set('typescript', tsQueries);

        const pythonQueries: TreeSitterQueries = {
            functions: `(function_definition name: (identifier) @name)`,
            classes: `(class_definition name: (identifier) @name)`,
            imports: `
                [
                    (import_statement (dotted_name (identifier) @name))
                    (import_from_statement (dotted_name (identifier) @name))
                ]`,
            methods: `(function_definition name: (identifier) @name)`
        };
        this._queryMap.set('python', pythonQueries);

        const rustQueries: TreeSitterQueries = {
            functions: `
                [
                    (function_item name: (identifier) @name)
                    (function_signature_item name: (identifier) @name)
                ]`,
            classes: `
                [
                    (struct_item name: (type_identifier) @name)
                    (enum_item name: (type_identifier) @name)
                    (trait_item name: (type_identifier) @name)
                    (impl_item type: (type_identifier) @name)
                ]`,
            imports: `
                [
                    (use_declaration (use_list (identifier) @name))
                    (use_declaration (scoped_identifier name: (identifier) @name))
                ]`,
            methods: `
                [
                    (function_item name: (identifier) @name)
                ]`
        };
        this._queryMap.set('rust', rustQueries);

        const cssQueries: TreeSitterQueries = {
            functions: `(rule_set (selectors) @name)`,
            classes: `(class_selector (class_name) @name)`,
            imports: `(import_statement (string_value) @name)`
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