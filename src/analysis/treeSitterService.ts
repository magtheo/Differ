import * as vscode from 'vscode';
import Parser from 'tree-sitter';
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const Python = require('tree-sitter-python');
const Rust = require('tree-sitter-rust');

interface TreeSitterQueries {
    functions: string;
    classes: string;
    imports: string;
    methods?: string; // Query to find methods within a class context
}

export class TreeSitterService {
    private _parser!: Parser; // Definite assignment in initialize
    private _languageMap: Map<string, any> = new Map();
    private _queryMap: Map<string, TreeSitterQueries> = new Map();
    private _isInitialized = false;

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
    this._parser = new Parser();
    this.loadLanguages();  // Load languages directly
    this.defineQueries();
    this._isInitialized = true;
    }

    private loadLanguages(): void {
        // Store the language objects directly
        this._languageMap.set('javascript', JavaScript);
        this._languageMap.set('typescript', TypeScript.typescript);
        this._languageMap.set('python', Python);
        this._languageMap.set('rust', Rust);
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

    public parse(code: string, languageId: string): Parser.Tree | undefined {
        const language = this.getLanguage(languageId);
        if (!language) {
            return undefined;
        }
        this._parser.setLanguage(language);
        return this._parser.parse(code);
    }

    public query(tree: Parser.Tree, languageId: string, queryType: keyof TreeSitterQueries): Parser.QueryCapture[] {
        const language = this.getLanguage(languageId);
        const queries = this._queryMap.get(languageId);

        if (!language || !queries || !queries[queryType]) {
            return [];
        }

        try {
            const query = language.query(queries[queryType]!);
            const captures = query.captures(tree.rootNode);
            return captures;
        } catch (error) {
            console.error(`Tree-sitter query failed for language ${languageId}, query type ${queryType}`, error);
            return [];
        }
    }
}