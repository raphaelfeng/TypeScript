/// <reference path="..\compiler\program.ts"/>
/// <reference path="..\compiler\types.ts"/>
/// <reference path="..\compiler\commandLineParser.ts"/>
/// <reference path="..\services\services.ts"/>

module ts {
    export module ext {
        declare var require: any;

        class ExternWriter {
            private output: string = "";

            public writeLine(str: string): void {
                this.output += str + '\n';
            }

            public getText(): string {
                return this.output;
            }
        }

        var fs = require('fs');
        var writer = new ExternWriter();
        var checker: TypeChecker = null;

        export function execCmdLine(args: string[]) {
            var commandLine = parseCommandLine(args);
            var fileNames = commandLine.fileNames;

            if (! fileNames || fileNames.length < 1) {
                printUsage();
                return;
            }

            if (fileNames.length == 1) {
                let fileName = fileNames[0];
                let lastDotIndex = fileName.lastIndexOf('.');
                fileNames.push(fileName.substring(0, lastDotIndex) + '.externs');
            }

            exportExterns(commandLine.fileNames);
        }

        function printUsage(): void {
            console.log("Usage: ext [file ...]");
            console.log("Example: ext a.d.ts a.externs");
        }

        function exportExterns(fileNames: string[]) {
            var exportClassAndInterface = false;
            var typeFile = fileNames[0];
            var externFile = fileNames[1];
            console.log('generating ' + externFile + ' from ' + typeFile);

            var compilerOptions: CompilerOptions = {
                target: ScriptTarget.ES3,
                module: ModuleKind.None
            };

            var compilerHost = ts.createCompilerHost(compilerOptions);
            var program = ts.createProgram([typeFile], compilerOptions, compilerHost);
            program.emit();

            var sourceFile = program.getSourceFile(typeFile);
            checker = ts.createTypeChecker(program, true);
            var stack: ts.Symbol[] = [];
            var locals = sourceFile.locals;
            for (let key in locals) {
                locals[key]['ext.externName'] = getName(locals[key]);
                stack.push(locals[key]);
            }

            while (stack.length != 0) {
                var sym = stack.pop();
                var children = getChildren(sym);
                if (children.length == 0) {
                    visit(sym);
                }
                else {
                    for (var child of children) {
                        child['ext.externName'] = sym['ext.externName'] + '.' + getName(child);
                        if(! child['ext.visited']) {
                            stack.push(child);
                        }
                        else {
                            // still visit it as it's part of the parent symbol
                            // for example:
                            // declare var angular: ng.IAngularStatic;
                            // interface IAngularStatic {
                            //     config: () => void;
                            // }
                            visit(child);
                        }
                    }
                }
                sym['ext.visited'] = true;
            }

            // write the output extern file
            compilerHost.writeFile(externFile, writer.getText(), false);
            console.log(writer.getText());
        }

        function getName(sym: Symbol): string {
            // for the Export = case
            // declare angular {
            //     export = angular;
            // }
            if (sym.declarations && sym.declarations[0] &&
                sym.declarations[0]['isExportEquals']) {
                return sym.declarations[0]['expressions']['text'];
            }

            return sym.getName();
        }

        function getChildren(sym: Symbol): Symbol[] {
            // exports
            var children = checker.getExportsOfModule(sym);
            // members
            if (sym.members) {
                for (let name in sym.members) {
                    children.push(sym.members[name]);
                }
            }

            // a variable or property with a class or interface
            var type: Type = sym.valueDeclaration ?
                checker.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration) :
                null;
            if (sym.valueDeclaration && sym.valueDeclaration['type'] && (sym.valueDeclaration['type']['kind'] === SyntaxKind.ArrayType)) {
                // hack way to get the element type of array
                // because the checker.getSymbolType return an empty array without element type
                type = checker.getTypeAtLocation(sym.valueDeclaration['type']['elementType'])
            }
            if ((sym.getFlags() & (SymbolFlags.Variable | SymbolFlags.Property)) &&
                (type && (type.flags & TypeFlags.Class || type.flags & TypeFlags.Interface))) {
                var properties = checker.getPropertiesOfType(type);
                for (let prop of properties) {
                    let isPublic = true;
                    if (prop.valueDeclaration.modifiers) {
                        for (let modifier of prop.valueDeclaration.modifiers) {
                            if (modifier.kind === SyntaxKind.PrivateKeyword ||
                                modifier.kind === SyntaxKind.ProtectedKeyword) {
                                isPublic = false;
                            }
                        }
                    }
                    if (isPublic) {
                        children.push(prop);
                    }
                }
            }

            return children;
        }

        function visit(sym: Symbol): void {
            // properties, members with primitive types
            //var fullName = checker.getFullyQualifiedName(sym);
            if (! (sym.flags & SymbolFlags.Prototype)) {
                //writer.writeLine(fullName);
                writer.writeLine(sym['ext.externName']);
            }
        }

        function fileExists(path: string) {
            return fs.existsSync(path) && fs.statSync(path).isFile();
        }
    }
}
ts.ext.execCmdLine(ts.sys.args);
