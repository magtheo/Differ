# Differ 🔧

> Apply LLM-generated code changes safely with preview and rollback capabilities

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/magtheo.differ?color=blue&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=magtheo.differ)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/magtheo.differ?color=green)](https://marketplace.visualstudio.com/items?itemName=magtheo.differ)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/magtheo.differ?color=yellow)](https://marketplace.visualstudio.com/items?itemName=magtheo.differ)

Differ is a VS Code extension that bridges the gap between AI-generated code suggestions and safe implementation. Parse, validate, preview, and apply JSON-formatted code changes with confidence.

## ✨ Features

### 🎯 **Smart JSON Parsing**
- Parse structured code changes from ChatGPT, Claude, or any LLM
- Comprehensive validation with detailed error reporting
- Support for multiple programming languages

### 🔍 **Advanced Preview System**
- **File Diff View**: See exactly what will change before applying
- **Create File Preview**: Preview new files before creation
- **Target Validation**: Verify functions, methods, and classes exist
- **Syntax Highlighting**: Code previews with proper language support

### 🛡️ **Safety First**
- **Validation Engine**: Multi-layer validation before any changes
- **File Access Checks**: Verify permissions and file existence
- **Rollback Support**: Undo changes with built-in history
- **Selective Application**: Choose which changes to apply

### 🎨 **Modern Interface**
- **Clean Design**: Professional UI that matches VS Code themes
- **Responsive Layout**: Works on any screen size
- **Accessibility**: Full keyboard navigation and screen reader support
- **Real-time Feedback**: Live validation and status updates

## 🚀 Quick Start

### Installation
1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Differ"
4. Click **Install**

### Basic Usage

1. **Open Differ Panel**
   ```
   Ctrl+Shift+P → "Differ: Open Panel"
   ```

2. **Paste LLM-Generated JSON**
   ```json
   {
     "description": "Add error handling to user service",
     "changes": [
       {
         "file": "src/services/userService.ts",
         "action": "replace_function",
         "target": "getUserData",
         "code": "export async function getUserData(id: string): Promise<User> {\n  try {\n    const response = await fetch(`/api/users/${id}`);\n    if (!response.ok) throw new Error('User not found');\n    return response.json();\n  } catch (error) {\n    console.error('Failed to fetch user:', error);\n    throw error;\n  }\n}"
       }
     ]
   }
   ```

3. **Preview & Apply**
   - Click **Parse Changes** to validate
   - Use **Preview** to see diffs
   - Select changes to apply
   - Click **Apply Selected**

## 📖 Supported Actions

| Action | Description | Example Use Case |
|--------|-------------|------------------|
| `create_file` | Create new files | Adding new modules, components |
| `replace_function` | Replace entire functions | Updating function logic |
| `add_function` | Add new functions | Adding utility functions |
| `replace_method` | Replace class methods | Updating class behavior |
| `add_method` | Add new class methods | Extending class functionality |
| `add_import` | Add import statements | Adding new dependencies |
| `replace_block` | Replace code blocks | Updating configuration objects |
| `delete_function` | Remove functions | Cleaning up unused code |

## 💡 Example Workflows

### 🤖 With ChatGPT/Claude
1. Ask: *"Generate JSON changes to add error handling to my React component"*
2. Copy the JSON response
3. Paste into Differ
4. Preview and apply changes

### 🔄 Refactoring
1. Request: *"Refactor this class to use dependency injection"*
2. Get structured changes as JSON
3. Validate all targets exist
4. Apply changes incrementally

### 📁 Project Setup
1. Ask: *"Create a new Express.js route with validation"*
2. Get `create_file` actions for new files
3. Preview the complete file structure
4. Apply all changes at once

## ⚙️ Configuration

Access settings via `File → Preferences → Settings → Extensions → Differ`

| Setting | Default | Description |
|---------|---------|-------------|
| `differ.logLevel` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `differ.autoBackup` | `true` | Automatically backup files before changes |
| `differ.confirmBeforeApply` | `true` | Show confirmation dialog before applying |
| `differ.maxHistoryEntries` | `100` | Maximum number of history entries to keep |

## 🎯 JSON Schema

### Root Structure
```json
{
  "description": "Human-readable description of changes",
  "changes": [
    {
      "file": "relative/path/to/file.ts",
      "action": "replace_function",
      "target": "functionName",
      "code": "new function implementation",
      "class": "ClassName (for method operations)",
      "description": "Optional change description"
    }
  ]
}
```

### Required Fields
- `description`: Brief summary of the change set
- `changes`: Array of change objects
- `changes[].file`: Target file path (relative to workspace)
- `changes[].action`: Type of change to perform
- `changes[].target`: Function/method/identifier name
- `changes[].code`: New code content

### Optional Fields
- `changes[].class`: Required for `add_method` and `replace_method`
- `changes[].description`: Additional context for the change

## 🛠️ Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Differ: Open Panel` | - | Open the main Differ interface |
| `Differ: Apply Changes` | - | Apply parsed changes |
| `Differ: Clear Changes` | - | Clear current change set |
| `Differ: Show History` | - | View change history (Coming Soon) |
| `Differ: Undo Last Changes` | - | Revert last applied changes (Coming Soon) |

## 🔍 Validation Features

### ✅ **JSON Structure Validation**
- Syntax checking
- Required field validation
- Type checking
- Action validation

### ✅ **File System Validation**
- File existence checks
- Permission verification
- Path validation
- Overwrite warnings

### ✅ **Code Target Validation**
- Function existence verification
- Method and class detection
- Import statement checking
- Similarity suggestions for typos

### ✅ **Semantic Validation**
- Duplicate change detection
- Conflicting operation warnings
- Large change set notifications
- Performance impact analysis

## 🎨 Screenshots

### Main Interface
![Main Interface](https://via.placeholder.com/600x400/2d3748/ffffff?text=Main+Interface)

### Validation Errors
![Validation](https://via.placeholder.com/600x300/e53e3e/ffffff?text=Validation+Errors)

### Preview Diff
![Preview](https://via.placeholder.com/600x300/38a169/ffffff?text=Diff+Preview)

## 🔧 Development

### Prerequisites
- Node.js 18+
- VS Code 1.100.0+
- TypeScript 5.8+

### Setup
```bash
# Clone repository
git clone https://github.com/magtheo/differ.git
cd differ

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run in development
# Press F5 in VS Code to launch Extension Development Host
```

### Building
```bash
# Clean build
npm run clean
npm run compile

# Package extension
npm run package

# The .vsix file will be created in the root directory
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Quick Contribution Steps
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📋 Roadmap

### v0.1.0 (Current)
- [x] Basic JSON parsing and validation
- [x] File preview system
- [x] Modern UI design
- [x] Target existence validation

### v0.2.0 (Planned)
- [ ] Change history and rollback
- [ ] Batch operation support
- [ ] Enhanced diff visualization
- [ ] Template system for common patterns

### v0.3.0 (Future)
- [ ] AI integration for change suggestions
- [ ] Collaborative features
- [ ] Plugin system for custom actions
- [ ] Performance optimizations

## 🐛 Known Issues

- Large files (>5MB) may have slower validation
- Some complex TypeScript generics may not be detected properly
- History feature is not yet implemented

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 💬 Support

- **Issues**: [GitHub Issues](https://github.com/magtheo/differ/issues)
- **Discussions**: [GitHub Discussions](https://github.com/magtheo/differ/discussions)
- **Email**: your-email@example.com

## 🙏 Acknowledgments

- VS Code team for excellent extension APIs
- The open-source community for inspiration and feedback
- All contributors who help make Differ better

---

<div align="center">

**Made with ❤️ for developers who work with AI**

[Report Bug](https://github.com/magtheo/differ/issues) • [Request Feature](https://github.com/magtheo/differ/issues)

</div>