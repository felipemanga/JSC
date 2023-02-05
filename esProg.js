import * as _esprima from './node_modules/esprima/dist/esprima.js'
import * as ir from './IR.js'

let JSC;

class ProgramParser {
    constructor(program) {
        this.program = program;
        this.scope = null;
        this.location = new ir.Location();
        this.node = null;
        this.discardResult = 0;
        this.scopeStack = [];
        this.parse = (node, ...args) => {
            const func = this[node.type];
            if (!func)  {
                console.error("Don't know how to parse " + node.type + " inside", this.node ? this.node.type : "null");
                console.log(JSON.stringify(node, 0, 4));
                throw new ir.Error("Internal error", this.location);
            }

            const prev = this.node;
            this.setNode(node);
            const ret = func.call(this, node, ...args);
            this.setNode(prev);
            return ret;
        };
    }

    getNodeLocation(node) {
        if (node && node.loc && node.loc.start) {
            return new ir.Location(this.location.file, node.loc.start.line, node.loc.start.column);
        }
        return this.location.clone();
    }

    setNode(node) {
        this.node = node;
        if (node && node.loc && node.loc.start) {
            this.location.column = node.loc.start.column;
            this.location.line = node.loc.start.line;
        }
    }

    error(msg) {
        throw new ir.Error(msg, this.location);
    }

    push(scope, cb) {
        this.scopeStack.push(scope);
        const oldScope = this.scope;
        this.scope = scope;
        cb(scope);
        this.scope = oldScope;
        this.scopeStack.pop();
    }

    Program(node) {
        this.push(this.program.main, _=>{
            node.body.forEach(b => this.parse(b));
        });
    }

    BreakStatement(node) {
        for (let i = this.scopeStack.length - 1; i > -1; --i) {
            let target = this.scopeStack[i];
            if (!target.breakable)
                continue;
            if (node.label && target.name != node.label.name)
                continue;
            target.hasBreak = true;
            this.scope.add(new ir.Break(target));
            return;
        }
    }

    ContinueStatement(node) {
        for (let i = this.scopeStack.length - 1; i > -1; --i) {
            let target = this.scopeStack[i];
            if (!target.continuable)
                continue;
            if (node.label && target.name != node.label.name)
                continue;
            target.hasContinue = true;
            this.scope.add(new ir.Continue(target));
            return;
        }
    }

    BlockStatement(node, child = null) {
        this.discardResult = 1;
        if (!child) {
            child = new ir.Scope();
            this.scope.add(child);
        }
        this.push(child, _=>{
            for (let b of node.body) {
                this.parse(b);
                if (JSC.opts.cancel) {
                    JSC.opts.cancel = false;
                    break;
                }
            };
        });
    }

    LabeledStatement(node, child) {
        this.discardResult = 1;
        if (!child)
            child = new ir.Scope();
        child.name = node.label.name;
        this.parse(node.body, child);
    }

    IfStatement(node, block) {
        block = block || new ir.Scope();
        this.scope.add(block);
        block.debug = 'if';

        this.push(block.addEnterCondition(), _=>{
            this.discardResult = 0;
            this.parse(node.test);
            this.discardResult = 1;
        });

        if (node.alternate) {
            this.push(block.addFailEnter(), _=>{
                this.parse(node.alternate);
            });
        }

        this.push(block, _=>{
            this.parse(node.consequent, block);
        });
    }

    WhileStatement(node, block) {
        block = block || new ir.Scope();
        this.scope.add(block);
        block.continuable = true;
        block.breakable = true;

        this.push(block.addEnterCondition(), _=>{
            this.discardResult = 0;
            this.parse(node.test);
            this.discardResult = 1;
        });

        this.push(block.addLoopCondition(), _=>{
            this.scope.add(new ir.Literal(true));
        });

        this.push(block, _=>{
            this.parse(node.body, block);
        });
    }

    ForOfStatement(node, block) {
        block = block || new ir.Scope();
        this.scope.add(block);
        block.continuable = true;
        block.breakable = true;
        block.debug = 'forOf';

        this.push(block, _=>{
            const arr = new ir.Var();
            block.add(arr);

            const it = new ir.Var();
            block.add(it);

            let val;

            this.push(block.addPreEnter(), preEnter=>{
                preEnter.add(new ir.LookUp(it.id))
                preEnter.add(new ir.Literal(0));
                preEnter.add(new ir.AssignmentExpression('='));
                preEnter.add(new ir.Pop());

                preEnter.add(new ir.LookUp(arr.id))
                this.parse(node.right);
                preEnter.add(new ir.AssignmentExpression('='));
                preEnter.add(new ir.Pop());

                this.parse(node.left);

                val = preEnter.find(node.left.declarations[0].id.name, true);
                if (!val)
                    this.error("Could not find iterator " + node.left.declarations[0].id.name);
            });

            this.push(block.addEnterCondition(), cond=>{
                cond.add(new ir.LookUp(it.id));
                cond.add(new ir.LookUp(arr.id));
                cond.add(new ir.Deref());
                cond.add(new ir.Literal("length"));
                cond.add(new ir.BinaryExpression("."));
                cond.add(new ir.BinaryExpression("<"));
            });

            this.push(block.addPreLoop(), preLoop=>{
                preLoop.add(new ir.LookUp(it.id));
                preLoop.add(new ir.Literal(1));
                preLoop.add(new ir.AssignmentExpression("+="));
                preLoop.add(new ir.Pop());
            });

            this.push(block.addLoopCondition(), cond=>{
                cond.add(new ir.Literal(true));
            });

            block.add(new ir.LookUp(val.id));
            block.add(new ir.LookUp(arr.id));
            block.add(new ir.Deref());
            block.add(new ir.LookUp(it.id));
            block.add(new ir.Deref());
            block.add(new ir.BinaryExpression("."));
            block.add(new ir.AssignmentExpression("="));
            this.parse(node.body, block);
        });
    }

    ForStatement(node, block) {
        block = block || new ir.Scope();
        this.scope.add(block);
        block.continuable = true;
        block.breakable = true;

        this.push(block, _=>{
            if (node.init) {
                this.push(block.addPreEnter(), _=>{
                    this.parse(node.init);
                });
            }

            if (node.test) {
                this.push(block.addEnterCondition(), _=>{
                    this.discardResult = 0;
                    this.parse(node.test);
                    this.discardResult = 1;
                });
            }

            if (node.update) {
                this.push(block.addPreLoop(), _=>{
                    this.parse(node.update);
                });
            }

            this.push(block.addLoopCondition(), _=>{
                this.scope.add(new ir.Literal(true));
            });

            this.parse(node.body, block);
        });
    }

    DoWhileStatement(node, block) {
        block = block || new ir.Scope();
        this.scope.add(block);
        block.continuable = true;
        block.breakable = true;

        this.push(block.addLoopCondition(), _=>{
            this.discardResult = 0;
            this.parse(node.test);
            this.discardResult = 1;
        });

        this.push(block, _=>{
            this.parse(node.body, block);
        });
    }

    VariableDeclaration(node) {
        node.declarations.forEach(child => this.parse(child, node.kind));
    }

    VariableDeclarator(node, kind) {
        const id = node.id;
        if (id.type != "Identifier")
            this.error("Unsupported initializer type: " + id.type);

        var scope = kind == "var" ? this.scope.method : this.scope;
        var prevInst = scope.find(id.name, false);
        if (!prevInst) {
            scope.add(new ir.Var(kind, id.name, this.location.clone()));
        } else if (kind != "var" || prevInst.kind != "var") {
            this.error("redeclaration of " + prevInst.kind + " " + prevInst.name);
        }

        if (node.init) {
            this.discardResult = 0;
            this.parse({
                type:"AssignmentExpression",
                operator:"=",
                left:{
                    type:"Identifier",
                    name:id.name
                },
                right:node.init
            });
            this.scope.add(new ir.Pop());
            this.discardResult = 1;
        }
    }

    ClassDeclaration(node) {
        const clazz = new ir.Method(node.id ? node.id.name : undefined);
        clazz.isClass = true;
        this.scope.add(clazz);
        this.push(clazz, _=>{
            this.parse(node.body);
        });

        const THIS = clazz.index["this"];
        const reg = {};
        for (let key in clazz.index) {
            const method = clazz.index[key];
            if ((method.id in reg) || !(method instanceof ir.Method))
                continue;
            reg[method.id] = method;

            let that = method.index["this"];
            THIS.addDeref(method.name);
            clazz.add(new ir.LookUp("this"));
            clazz.add(new ir.Deref());
            clazz.add(new ir.Literal(method.name));
            clazz.add(new ir.BinaryExpression("."));
            clazz.add(new ir.LookUp(method.id));
            clazz.add(new ir.AssignmentExpression("="));
            clazz.add(new ir.Pop());
        }

        if (clazz.index["constructor"]) {
            const ctor = new ir.LookUp("constructor");
            ctor.container = clazz;
            clazz.add(ctor);
            clazz.add(new ir.CallExpression(0, true, true, this.discardResult));
        }
    }

    ClassBody(node) {
        node.body.forEach(method => this.parse(method));
    }

    EmptyStatement(node) {
    }

    AssignmentExpression(node) {
        this.discardResult = 0;
        this.parse(node.left);
        this.parse(node.right);
        this.scope.add(new ir.Deref());
        this.scope.add(new ir.AssignmentExpression(node.operator));
    }

    ExpressionStatement(node) {
        if (node.expression.type == "Literal" && typeof node.expression.value == "string") {
            JSC.pragma(node.expression.value);
            return;
        }

        this.discardResult = 1;
        this.parse(node.expression);
        this.scope.add(new ir.Pop());
    }

    ReturnStatement(node) {
        this.discardResult = 0;
        if (node.argument)
            this.parse(node.argument);
        this.scope.add(new ir.Return(!!node.argument));
    }

    Identifier(node) {
        this.scope.add(new ir.LookUp(node.name));
    }

    ThisExpression(node) {
        this.scope.add(new ir.LookUp("this"));
    }

    ObjectExpression(node) {
        node.properties.forEach(prop => {
            this.parse(prop.key);
            this.parse(prop.value);
        });
        this.scope.add(new ir.Objekt(node.properties.length, false));
    }

    ArrayExpression(node) {
        node.elements.forEach(element => {
            this.parse(element);
        })
        this.scope.add(new ir.Array(node.elements.length));
    }

    Literal(node) {
        this.scope.add(new ir.Literal(node.value));
    }

    UnaryExpression(node) {
        this.parse(node.argument);
        this.scope.add(new ir.UnaryExpression(node.operator, node.prefix));
    }

    UpdateExpression(node) {
        this.discardResult = 0;
        this.parse(node.argument);
        this.scope.add(new ir.UnaryExpression(node.operator, node.prefix));
    }

    BinaryExpression(node) {
        this.parse(node.left);
        this.scope.add(new ir.Deref());
        this.parse(node.right);
        this.scope.add(new ir.Deref());
        this.scope.add(new ir.BinaryExpression(node.operator));
        if (node.operator == '.')
            console.log(node);
    }

    LogicalExpression(node) {
        if (node.operator != "&&" && node.operator != "||")
            this.error("Unimplemented operator " + node.operator);

        const tmp = new ir.Var("var");
        this.scope.add(tmp);
        this.scope.add(new ir.LookUp(tmp.id));
        this.parse(node.left);
        this.scope.add(new ir.AssignmentExpression("="));
        this.scope.add(new ir.Pop());

        const ifst = new ir.Scope();
        ifst.debug = node.operator;
        this.scope.add(ifst);
        this.push(ifst, _=>{
            this.push(ifst.addEnterCondition(), _=>{
                this.scope.add(new ir.LookUp(tmp.id));
            });

            this.push((node.operator == "&&" ? ifst : ifst.addFailEnter()), _=>{
                this.scope.add(new ir.LookUp(tmp.id));
                this.parse(node.right);
                this.scope.add(new ir.AssignmentExpression("="));
                this.scope.add(new ir.Pop());
            });
        });

        this.scope.add(new ir.LookUp(tmp.id));
    }

    MemberExpression(node) {
        this.parse(node.object);
        this.scope.add(new ir.Deref());
        if (node.computed) {
            this.parse(node.property);
        } else {
            this.scope.add(new ir.Literal(node.property.name));
        }
        this.scope.add(new ir.BinaryExpression(node.computed ? "[]" : "."));
    }

    CallExpression(node, isNew) {
        let discardResult = this.discardResult;
        this.discardResult = 0;
        this.parse(node.callee);
        node.arguments.forEach(arg => {
            this.parse(arg);
            this.scope.add(new ir.Deref());
        });
        this.scope.add(new ir.CallExpression(node.arguments.length, !!isNew, false, discardResult));
    }

    NewExpression(node) {
        this.CallExpression(node, true);
    }

    ArrowFunctionExpression(node) {
        const method = this.FunctionDeclaration(node, true);
        this.scope.add(new ir.LookUp(method.id));
    }

    FunctionExpression(node) {
        const method = this.FunctionDeclaration(node);
        this.scope.add(new ir.LookUp(method.id));
    }

    MethodDefinition(node) {
        this.FunctionDeclaration(node.value, node.key.name)
    }

    FunctionDeclaration(node, name) {
        const method = new ir.Method(name || (node.id ? node.id.name : undefined));
        this.scope.add(method);
        this.push(method, _=>{
            let needsArgc = false;
            let needsArgs = false;
            node.params.forEach((param, index) => {
                if (param.type == "AssignmentPattern") {
                    needsArgc = true;
                }
                if (param.name == "arguments") {
                    needsArgs = true;
                }
            });

            let args = method.args;

            if (needsArgs) {
                args = new ir.Var("var", "arguments");
                this.scope.add(args);
            }

            const argc = needsArgc ? new ir.Var("var") : null;
            if (argc) {
                this.scope.add(argc);
                this.scope.add(new ir.LookUp(argc.id));
                this.scope.add(new ir.LookUp(args.id));
                if (needsArgs) {
                    this.scope.add(new ir.LookUp(method.args.id));
                    this.scope.add(new ir.AssignmentExpression("="));
                }
                this.scope.add(new ir.Literal("length"));
                this.scope.add(new ir.BinaryExpression("."));
                this.scope.add(new ir.AssignmentExpression("="));
                this.scope.add(new ir.Pop());
            } else if (needsArgs) {
                this.scope.add(new ir.LookUp(args.id));
                this.scope.add(new ir.LookUp(method.args.id));
                this.scope.add(new ir.AssignmentExpression("="));
                this.scope.add(new ir.Pop());
            }

            node.params.forEach((param, index) => {
                const variable = new ir.Var("var", param.name, this.getNodeLocation(param));
                if (param.type == "Identifier") {
                    this.scope.add(new ir.LookUp(variable.id));
                    this.scope.add(new ir.LookUp(args.id));
                    this.scope.add(new ir.Deref());
                    this.scope.add(new ir.Literal(index));
                    this.scope.add(new ir.BinaryExpression("."));
                    this.scope.add(new ir.AssignmentExpression("="));
                    this.scope.add(new ir.Pop());
                } else if (param.type == "AssignmentPattern") {
                    variable.rename(param.left.name);
                    this.scope.add(new ir.LookUp(variable.id));
                    this.scope.add(new ir.LookUp(method.args.id));
                    this.scope.add(new ir.Literal(index));
                    this.scope.add(new ir.BinaryExpression("."));
                    this.scope.add(new ir.AssignmentExpression("="));
                    this.scope.add(new ir.Pop());

                    const ifst = new ir.Scope();
                    this.scope.add(ifst);
                    this.push(ifst.addEnterCondition(), _=>{
                        this.scope.add(new ir.LookUp(argc.id));
                        this.scope.add(new ir.Literal(index));
                        this.scope.add(new ir.BinaryExpression("<="));
                    });

                    this.push(ifst, _=>{
                        this.scope.add(new ir.LookUp(variable.id));
                        this.parse(param.right);
                        this.scope.add(new ir.AssignmentExpression("="));
                        this.scope.add(new ir.Pop());
                    });
                }
                this.scope.add(variable);
            });

            this.discardResult = 0;

            this.parse(node.body, method);

            if (node.expression) {
                this.scope.add(new ir.Deref());
                this.scope.add(new ir.Return(true));
            }
        });
        return method;
    }
}

export function esAST(source, program, path) {
    const esprima = (typeof exports === "object" && exports.esprima) ? exports.esprima : _esprima;
    const ast = esprima.parse(source, { loc: true });
    ast.file = path;
    return ast;
}

export function esProg(ast, program, filename, jsc) {
    JSC = jsc;
    const parser = new ProgramParser(program);
    parser.location.file = ast.file;
    parser.parse(ast);
    program.sourceAST.unshift(ast);
    return program;
}
