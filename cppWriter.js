import * as ir from './IR.js'
import {std} from './templates/std.js'
import {blit} from './templates/blit.js'
import {pico} from './templates/pico.js'
import {pokitto} from './templates/pokitto.js'
import {meta} from './templates/meta.js'
import {espboy} from './templates/espboy.js'

const platform = {
    std,
    blit,
    pico,
    pokitto,
    espboy,
    meta
};

const binOpName = {
    "+":"add",
    "-":"sub",
    "*":"mul",
    "%":"mod",
    "/":"div",
    "<":"lt",
    "<=":"leq",
    ">":"gt",
    ">=":"geq",
    "!=":"neq",
    "==":"eq",
    "===":"seq",
    "!==":"sneq",
    "|":"or",
    "&":"and",
    "^":"xor",
    "<<":"shl",
    ">>":"shr",
    ">>>":"sru",

    "+=":"add",
    "-=":"sub",
    "*=":"mul",
    "%=":"mod",
    "/=":"div",
    "|=":"or",
    "&=":"and",
    "^=":"xor",
    "<<=":"shl",
    ">>=":"shr",
    ">>>=":"sru"
};

let cpp;

function literalToString(value, reg) {
    let ret = value + '';
    let pos = -1;

    if (typeof value == 'string' || reg) {
        pos = cpp.stringTable.indexOf(ret);
        if (pos == -1) {
            pos = cpp.stringTable.length;
            cpp.stringTable.push(ret);
        }
        ret = `js::BufferRef{stringTable[${pos}]}`;
    } else if (value === null) {
        ret = '(js::Object*){}';
    } else if ((value|0) != value) {
        ret = `js::Float(${ret}f)`;
    } else {
        ret = `int32_t(${ret})`;
    }

    if (reg) {
        let safe = "V_" + (value + '').replace(/([^a-zA-Z_0-9])/g, (_, ch)=>ch.charCodeAt(0));
        if (!(safe in cpp.minStringTable)) {
            cpp.minStringTable[safe] = ret;
        }
        ret = safe;
    }

    return ret;
}

function local(node) {
    // if (node instanceof ir.Literal)
    //     return `${encode(node)}`;
    return encode(node);
}

function encode(node, reg)  {
    switch(node.constructor.name) {
    case "Method":
        if (node.isNative && node.name)
            return node.name;
    case "Var":
        if (cpp.globals[node.id])
            return node.name;

        // if (node.hasCTV) {
        //     return literalToString(node.CTV, !!reg);
        // }

        return node.name ?
            `_${node.id}/*${node.name}*/`
            : `_${node.id}`;

    case "Literal":
        return literalToString(node.value, !!reg);
    case "LookUp":
        const ctx = node.container || node.parent;
        if (ctx instanceof ir.Var) {
            ctx.read++;
            if (node.variable instanceof ir.Literal) {
                ctx.addDeref(node.variable.value);
                if (ctx == cpp.program.resources) {
                    if (!(node.variable.value in cpp.program.resourceData))
                        throw `No resource named ${node.variable.value}`;
                    return `RESOURCEREF(${node.variable.value})`;
                }
            }
            return `js::get(${encode(ctx)}, ${encode(node.variable, false)})`;
        } else if (ctx instanceof ir.Scope) {
            return encode(ctx.find(node.variable, true));
        }
    }
    return node.constructor.name;
}

class CPP {
    constructor() {
        this.minStringTable = {};
        this.globals = {};
        this.stringTable = [];
        this.header = [];
        this.out = [];
        this.method = null;
        this.indent = 0;
        this.stack = [];
        this.main = null;
        this.program = null;

        cpp = this;

        [
            "",
            "buffer",
            "length",
            "__proto__",
            "this",
            "undefined",
            "[Object]",
            "[Resource]",
            "[Array]",
            "[Function]",
            "null",
            "true",
            "false",
            "this",
            "0",
            "1", "2", "3", "4", "5",
            "6", "7", "8", "9", "10",
            "11", "12", "13", "14", "15",
            "16", "17", "18", "19", "20",
            "21", "22", "23", "24", "25",
            "26", "27", "28", "29", "30",
            "31", "32",
            "//new",
            "//method"
        ].forEach(str => literalToString(str, true));
    }

    error(msg, location) {
        throw new ir.Error(msg, location);
    }

    write(node) {
        const writer = this[node.constructor.name];
        if (!writer) {
            this.error("No writer for " + node.constructor.name, node.location);
        } else {
            // this.stack.forEach((e, i) => console.log(i + ") " + JSON.stringify(e)));
            // console.log(node.constructor.name);
            return writer.call(this, node);
        }
    }

    Program(node) {
        cpp = this;
        this.program = node;
        this.main = node.main;
        this.out.push(this.write(node.main));
        this.writeStringTable();
    }

    writeStringTable() {
        this.out.unshift([
            '',
            `js::Buffer* const stringTable[] = `, `{`,
            this.stringTable.map((s, index)=>`(js::Buffer*) _str${index}.data()`).join(",\n  "),
            `};`,
            '',
            `const uint32_t stringTableSize = ${this.stringTable.length};`,
            ''
        ]);

        this.out.unshift([
            this.stringTable.map((s, index)=>{
                let str = JSON.stringify(s);
                let size = s.length + 1;
                return `STRDECL(_str${index}, ${size}, ${str});`;
            })
        ]);
    }

    Inline(node) {
        if (node.backend === "cpp") {
            if (node.target == "inline") {
                return node.code;
            }
            if (node.target == "header") {
                this.header.push(node.code);
            }
        }
    }

    Break(node) {
        return `goto ${node.target.label('failEnter')}; // break`;
    }

    Continue(node) {
        return `goto ${node.target.label('preLoop')}; // continue`;
    }

    Return(node) {
        return [
            this.Deref(),
            node.hasValue
                ? `return {${encode(this.stack.pop())}};`
                : `return {};`
        ];
    }

    Method(node) {
        this.out.unshift(`js::Local ${encode(node)}(js::Local&, bool);`);
        if (node.isNative)
            return;
        const oldMethod = this.method;
        this.method = node;
        const method = ['', `js::Local ${encode(node)}(js::Local& ${encode(node.args)}, bool isNew)`];
        this.out.push(method);
        method.push(this.Scope(node, true));
        this.method = oldMethod;
    }

    declare(v) {
        return v.kind == "capture"
            ? `js::Tagged& ${encode(v)} = *js::getTaggedPtr(js::to<js::Object*>(${encode(this.method.args)}), ${literalToString(v.name, true)}, true);`

            : v.kind == "cache"
            ? `js::Tagged& ${encode(v)} = *js::getTaggedPtr(${encode(this.method.index["this"])}.object(), ${literalToString(v.name, true)}, true, true);`

            : v.isCaptured()
            ? `js::Tagged& ${encode(v)} = *js::set(${encode(this.method.context)}, ${literalToString(v.name, true)}, {});`

            : v.declType == "int32_t"
            ? `int32_t ${encode(v)}; // ${v.kind}`

            : v.declType == "uint32_t"
            ? `uint32_t ${encode(v)}; // ${v.kind}`

            : v.declType == "Float"
            ? `js::Float ${encode(v)}; // ${v.kind}`

            : v.declType == "string"
            ? `js::BufferRef ${encode(v)}; // ${v.kind}`

            : `js::Local ${encode(v)}; // ${v.kind} ${v.declType}`
    }

    Scope(node, endWithReturn) {
        const decls = [];
        const setup = [];
        const before = [`// begin ${node.debug}`, (node.transparent ? '' : '{'), setup, decls];
        const after = [(node.transparent ? '' : '}'), `// end ${node.debug}`];
        const children = [];

        node.children.forEach(child => {if (!(child instanceof ir.Method)) children.push(this.write(child))});
        node.children.forEach(child => {if ((child instanceof ir.Method)) children.push(this.write(child))});

        if (endWithReturn) {
            const lastChild = node.children[node.children.length - 1];
            let hasReturn = lastChild && (lastChild instanceof ir.Return);
            if (!hasReturn) {
                children.push(`return {};`);
            }
        }

        if (node.preEnter) {
            before.push(this.Scope(node.preEnter, false));
        }

        if (node.loopCondition) { // while, do/while, for
            const enterCondition = node.label('enterCondition');
            const failEnter = node.label('failEnter');
            const preLoop = node.label('preLoop');

            before.push(enterCondition + ':;');

            if (node.enterCondition) {
                before.push(this.write(node.enterCondition));
                before.push(this.Deref());
                before.push(`if (!js::to<bool>(${encode(this.stack.pop())})) goto ${failEnter};`);
            }

            if (node.hasContinue)
                children.push(preLoop + ':;');
            if (node.preLoop) {
                children.push(this.write(node.preLoop));
                this.stack.pop();
            }

            if (node.loopCondition && node.loopCondition.children[0]) {
                let firstChild = node.loopCondition.children[0];
                if ((firstChild instanceof ir.Literal) && firstChild.value) {
                    children.push(`goto ${enterCondition};`);
                } else if ((firstChild instanceof ir.Literal) && !firstChild.value) {
                } else {
                    children.push(this.write(node.loopCondition));
                    children.push(`if (js::to<bool>(${encode(this.stack.pop())})) goto ${enterCondition};`);
                }
            }

            after.unshift(failEnter + ':;');
        } else { // if, block
            if (node.enterCondition) {
                before.push(this.write(node.enterCondition));
                before.push(this.Deref());
                const failEnter = node.label('failEnter');
                before.push(`if (!js::to<bool>(${encode(this.stack.pop())})) goto ${failEnter};`);
                if (node.failEnter) {
                    let afterFail = node.label('afterFail');
                    after.unshift([
                        `goto ${afterFail};`,
                        failEnter + ':;',
                        this.write(node.failEnter),
                        afterFail + ':;',
                    ]);
                } else {
                    after.push(failEnter + ':;');
                }
            }
        }

        const varindex = {};
        varindex[node.method.args.id] = node.method.args;

        if (node.context) {
            varindex[node.context.id] = node.context;
            setup.push(this.declare(node.context));
            setup.push(`${encode(node.context)} = js::alloc(${Object.keys(node.captured).length});`);
        }

        if (node.that) {
            setup.unshift(`PROFILER_NAMED("${this.method.name}");`);

            const that = node.that;
            varindex[that.id] = that;
            if (that.read || that.write) {
                setup.push(this.declare(that));
                decls.push(`js::initThis(${encode(that)}, ${encode(node.args)}, ${node.guessObjectSize()}, isNew);`);
            }
        }

        const locals = node.index;
        for (let key in locals) {
            let v = locals[key];
            if ((v.id in varindex) || !(v instanceof ir.Var))
                continue;
            varindex[v.id] = v;
            let decl = this.declare(v);
            if (v.kind != "const")
                v.hasCTV = false;
            if (node == this.main && v.name) {
                this.out.unshift(decl);
            } else {
                decls.push(decl);
            }
        }

        return [before, children, after];
    }

    LookUp(node) {
        this.stack.push(node);
    }

    Literal(node) {
        this.stack.push(node);
    }

    Deref() {
        const lookup = this.stack.pop();
        if (lookup instanceof ir.LookUp) {
            const ctx = lookup.container || lookup.parent;
            if (ctx === this.method.that && (lookup.variable instanceof ir.Literal)) {
                ctx.read++;
                this.stack.push(this.method.cached(lookup.variable.value));
            } else if ((ctx instanceof ir.Var) || (ctx instanceof ir.Literal)) {
                const variable = new ir.Var();
                this.method.add(variable);
                this.stack.push(variable);
                return `${encode(variable)} = ${encode(lookup)};`;
            } else if (ctx instanceof ir.Scope) {
                const variable = ctx.find(lookup.variable, true);
                if (!variable)
                    this.error(`ReferenceError: ${lookup.variable} is not defined`, lookup.location);
                this.stack.push(variable);
                if (variable instanceof ir.Method)
                    return this.Deref();
                return;
            } else {
                this.error('Null context in lookup');
            }
        } else if ((lookup instanceof ir.Method) && lookup.captures) {
            let captureCount = 1;

            const captures = new ir.Var();
            const strcaptures = encode(captures);

            this.method.add(captures);
            this.stack.push(captures);

            const out = [];
            out.push(`${strcaptures} = js::alloc(${captureCount}, ${encode(this.method.context)});`);
            out.push(`js::set(${strcaptures}, V_4747method, ${encode(lookup)});`);

            return out;
        } else {
            this.stack.push(lookup);
            return;
        }
    }

    Pop() {
        this.stack.pop();
    }

    AssignmentExpression(node) {
        let right = this.stack.pop();
        if (!right)
            this.error(`Missing right-hand side for ${node.operator}`);

        const lookup = this.stack.pop();
        if (!lookup)
            this.error(`Missing left-hand side for ${node.operator}${encode(right)}`);
        if (!(lookup instanceof ir.LookUp))
            this.error(`Invalid assignment left-hand side ${encode(lookup)}`);

        const ctx = lookup.container || lookup.parent;
        let ret = [];
        if (node.operator != "=") {
            this.stack.push(lookup);
            ret.push(this.Deref());
            this.stack.push(right);
            ret.push(this.BinaryExpression(node));
            right = this.stack.pop();
        }
        if (ctx instanceof ir.Var) {
            ctx.read++;
            if (lookup.variable instanceof ir.Literal) {
                ctx.addDeref(lookup.variable.value);
                if (ctx == this.method.that) {
                    ctx.read++;
                    let v = this.method.cached(lookup.variable.value);
                    // v.setType(right.declType || right.type);
                    ret.push(`${encode(v)} = ${encode(right)};`);
                } else {
                    ret.push(`js::set(${encode(ctx)}, ${encode(lookup.variable, true)}, ${encode(right)});`);
                }
            } else {
                ret.push(`js::set(${encode(ctx)}, ${encode(lookup.variable)}, ${encode(right)});`);
            }
        } else if (ctx instanceof ir.Scope) {
            let v = ctx.find(lookup.variable, true);
            if (!v)
                this.error(`Variable ${lookup.variable} not defined`);

            if (v.kind == "const") {
                v.setDeclType(right.type);
                if (right.hasCTV)
                    v.CTV = right.CTV;
            }

            ret.push(`${encode(v)} = ${encode(right)};`);

            v.write++;
        }
        this.stack.push(right);
        return ret;// `// assign ${lookup.variable} ${node.operator} ${right.constructor.name}`;
    }

    UnaryExpression(node) {
        const lookup = this.stack.pop();
        const opName = {
            true:{
                "++":"preinc",
                "--":"predec",
                "!":"not",
                "~":"bitnot",
                "-":"neg",
                "+":"pos"
            },
            false:{
                "++":"inc",
                "--":"dec"
            }
        }[!!node.prefix][node.operator];

        let tmp = new ir.Var();

        if (opName == "bitnot") {
            if (lookup.hasCTV) {
                tmp = new ir.Literal(~lookup.value);
            } else {
                tmp.setDeclType("int32_t");
            }
        } else if (opName == "not") {
            if (lookup.hasCTV) {
                tmp = new ir.Literal(!lookup.value);
            } else {
                tmp.setDeclType("bool");
            }
        } else if (opName == "neg") {
            if (lookup.hasCTV) {
                tmp = new ir.Literal(-lookup.value);
            } else {
                tmp.setDeclType("Float");
            }
        } else {
            tmp.setDeclType("Float");
        }

        this.stack.push(tmp);

        if (tmp instanceof ir.Var) {
            node.parent.method.add(tmp);
            let ret = `js::op_${opName}(${encode(tmp)}, ${encode(lookup)}); // ${node.operator}`;
            lookup.type = tmp.type;
            return ret;
        }
    }

    BinaryExpression(node) {
        let out = [];
        const right = this.stack.pop();
        out.push(this.Deref());
        const left = this.stack.pop();
        switch (node.operator) {
        case ".":
        case "[]":
            const lookup = new ir.LookUp(right);
            lookup.container = left;
            this.stack.push(lookup);
            return out;
        }

        let tmp = new ir.Var();
        const op = binOpName[node.operator] || node.operator;

        switch (op) {
        case "add":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  + ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV + right.CTV);
            } else {
                tmp.hasCTV = false;
                if (left.declType == "Object*" || right.declType == "Object*" || !left.declType || !right.declType) {
                    // tmp.setDeclType("js::Local");
                } else if (left.declType == "string" || right.declType == "string") {
                    tmp.setDeclType("string");
                } else if (left.declType == "Undefined" || right.declType == "Undefined") {
                    tmp.setDeclType("Undefined");
                } else if (left.declType == "Float" || right.declType == "Float") {
                    tmp.setDeclType("Float");
                } else {
                    tmp.setDeclType("int32_t");
                }
            }

            break;

        case "sub":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  - ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV - right.CTV);
            } else {
                tmp.hasCTV = false;
                if (left.declType == "int32_t" && right.declType == "int32_t") {
                    tmp.setDeclType("int32_t");
                } else if (left.declType == "uint32_t" && right.declType == "uint32_t") {
                    tmp.setDeclType("uint32_t");
                } else {
                    tmp.setDeclType("Float");
                }
            }

            break;

        case "mul":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  * ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV * right.CTV);
            } else {
                tmp.hasCTV = false;
                if (left.declType == "int32_t" && right.declType == "int32_t") {
                    tmp.setDeclType("int32_t");
                } else if (left.declType == "uint32_t" && right.declType == "uint32_t") {
                    tmp.setDeclType("uint32_t");
                } else {
                    tmp.setDeclType("Float");
                }
            }

            break;

        case "mod":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  - ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV % right.CTV);
            } else {
                tmp.hasCTV = false;
                if (left.declType == "int32_t" && right.declType == "int32_t") {
                    tmp.setDeclType("int32_t");
                } else if (left.declType == "uint32_t" && right.declType == "uint32_t") {
                    tmp.setDeclType("uint32_t");
                } else {
                    tmp.setDeclType("Float");
                }
            }

            break;

        case "div":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  - ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV / right.CTV);
            } else {
                tmp.hasCTV = false;
                if (left.declType == "int32_t" && right.declType == "int32_t") {
                    tmp.setDeclType("int32_t");
                } else if (left.declType == "uint32_t" && right.declType == "uint32_t") {
                    tmp.setDeclType("uint32_t");
                } else {
                    tmp.setDeclType("Float");
                }
            }

            break;

        case "lt":
            tmp.setDeclType("int32_t");
            tmp.hasCTV = left.hasCTV && right.hasCTV;
            if (tmp.hasCTV) {
                tmp.CTV = left.CTV < right.CTV;
            }
            break;

        case "leq":
            tmp.setDeclType("int32_t");
            tmp.hasCTV = left.hasCTV && right.hasCTV;
            if (tmp.hasCTV) {
                tmp.CTV = left.CTV <= right.CTV;
            }
            break;

        case "gt":
            tmp.setDeclType("int32_t");
            tmp.hasCTV = left.hasCTV && right.hasCTV;
            if (tmp.hasCTV) {
                tmp.CTV = left.CTV > right.CTV;
            }
            break;

        case "geq":
            tmp.setDeclType("int32_t");
            tmp.hasCTV = left.hasCTV && right.hasCTV;
            if (tmp.hasCTV) {
                tmp.CTV = left.CTV >= right.CTV;
            }
            break;

        case "neq":
            tmp.setDeclType("int32_t");
            tmp.hasCTV = left.hasCTV && right.hasCTV;
            if (tmp.hasCTV) {
                tmp.CTV = left.CTV != right.CTV;
            }
            break;

        case "eq":
            tmp.setDeclType("int32_t");
            tmp.hasCTV = left.hasCTV && right.hasCTV;
            if (tmp.hasCTV) {
                tmp.CTV = left.CTV == right.CTV;
            }
            break;

        case "seq":
            tmp.setDeclType("int32_t");
            tmp.hasCTV = left.hasCTV && right.hasCTV;
            if (tmp.hasCTV) {
                tmp.CTV = left.CTV === right.CTV;
            }
            break;

        case "sneq":
            tmp.setDeclType("int32_t");
            tmp.hasCTV = left.hasCTV && right.hasCTV;
            if (tmp.hasCTV) {
                tmp.CTV = left.CTV !== right.CTV;
            }
            break;

        case "or":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  | ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV | right.CTV);
            } else {
                tmp.setDeclType("int32_t");
            }

            break;

        case "and":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  | ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV & right.CTV);
            } else {
                tmp.setDeclType("int32_t");
            }

            break;

        case "xor":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  ^ ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV ^ right.CTV);
            } else {
                tmp.setDeclType("int32_t");
            }

            break;

        case "shl":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  | ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV << right.CTV);
            } else {
                tmp.setDeclType("int32_t");
            }

            break;

        case "shr":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  | ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV >> right.CTV);
            } else {
                tmp.setDeclType("int32_t");
            }

            break;

        case "sru":
            // console.log("CTV ", left.hasCTV, left.name, "(", left.CTV, ")  | ", right.hasCTV, right.name, "(", right.CTV, ")");

            if (left.hasCTV && right.hasCTV) {
                tmp = new ir.Literal(left.CTV >>> right.CTV);
            } else {
                tmp.setDeclType("int32_t");
            }

            break;
        }

        node.parent.add(tmp);
        this.stack.push(tmp);

        if (tmp instanceof ir.Var) {
            tmp.write++;
            out.push(`js::op_${op}(${encode(tmp)}, ${encode(left)}, ${encode(right)});`);
        }

        return out;
    }

    Array(node) {
        const array = new ir.Var();
        array.setDeclType("Object*");
        this.method.add(array);
        array.write++;
        const out = [];
        const values = [];
        const strarray = encode(array);
        out.push(`${strarray} = js::arguments(${node.length});`);
        out.push(values);

        for (let i = 0; i < node.length; ++i) {
            values[node.length - i - 1] = `js::set(${strarray}, ${literalToString(node.length - i - 1, true)}, ${encode(this.stack.pop())});`;
        }

        this.stack.push(array);
        return out;
    }

    Objekt(node) {
        const obj = new ir.Var();
        obj.setDeclType("Object*");
        this.method.add(obj);
        obj.write++;
        const out = [];
        const values = [];
        const strobj = encode(obj);
        out.push(`${strobj} = js::alloc(${node.length});`);
        out.push(values);

        for (let i = 0; i < node.length; ++i) {
            let value = this.stack.pop();
            let key = this.stack.pop();
            if (key instanceof ir.LookUp)
                key = key.variable;
            else if (key instanceof ir.Literal)
                key = key.value;
            values[node.length - i - 1] = `js::set(${strobj}, ${literalToString(key, true)}, ${encode(value)});`;
        }

        this.stack.push(obj);
        return out;
    }

    CallExpression(node) {
        if (node.isForward) {
            const calleeLU = this.stack.pop();
            const strcallee = encode(calleeLU);
            return `js::call(${strcallee}, ${encode(this.method.args)}, false);`;
        }

        var args = this.method.temporaries.pop();
        if (!args) {
            args = new ir.Var();
            this.method.add(args);
        }

        var ret;
        if (!node.discardResult) {
            ret = new ir.Var();
            ret.hasCTV = false;
            this.method.add(ret);
        }

        const argv  = [];
        const strargs = encode(args);
        for (let i = 0; i < node.argc; ++i) {
            argv[node.argc - i - 1] = `js::set(${strargs}, ${literalToString(node.argc - i - 1, true)}, ${encode(this.stack.pop())});`;
        }
        const calleeLU = this.stack.pop();
        this.stack.push(calleeLU);
        argv.push(this.Deref());

        let argc = node.argc;
        const strcallee = encode(this.stack.pop());
        if (node.isNew) {
            argc++;
        } else if (calleeLU.container) {
            argv.push(`js::set(${strargs}, V_this, ${encode(calleeLU.container)});`);
            argc++;
        }

        this.stack.push(ret);

        this.method.temporaries.push(args);

        const assign = ret ? `${encode(ret)} = ` : '';

        return [
            `${strargs} = js::arguments(${argc});`,
            argv,
            `${assign}js::call(${strcallee}, ${strargs}, ${node.isNew});`,
            `${strargs}.reset();`
        ];
    }

    toString(platformName) {
        let minStringTable = Object.keys(this.minStringTable).map(s => `#define ${s} ${this.minStringTable[s]}`).join('\n');

        let translated = '';
        toString.call(this, this.out);

        let str = (platform[platformName] || platform.std).replace(/\$\[\[([^\]]+)\]\]/g, (m, key)=>{
            if (key == 'minStringTable')
                return minStringTable;
            if (key == 'translated')
                return translated;
            if (key == 'resources') {
                const acc = [];
                const resources = Object.keys(this.program.resourceData)
                      .sort((l, r) => (typeof l) < (typeof r) ? -1 : 1); // objects after strings

                for (let res of resources) {
                    const src = this.program.resourceData[res];
                    if (!src || typeof src == "string")
                        continue;

                    if (!Array.isArray(src))
                        continue;

                    const type = src.type || 'uintptr_t';
                    acc.push(`extern const ${type} ${res}[];`);
                }

                for (let res of resources) {
                    const src = this.program.resourceData[res];
                    if (!src)
                        continue;// `// RESOURCEDECL(${res}); // built-in`;
                    if (typeof src == "string") {
                        const out = [];
                        for (let i = 0, len = src.length; i < len; i += 2)
                            out.push(parseInt(src.substr(i, 2), 16));
                        acc.push(`RESOURCEDECL(${res}) = {${out.join(',')}};`);
                        continue;
                    }
                    if (Array.isArray(src)) {
                        const type = src.type || 'uintptr_t';
                        const out = [];
                        for (let el of src) {
                            if (typeof el == 'object' && el) {
                                if ('h' in el) {
                                    out.push(`js::hash(${JSON.stringify(el.h)})`);
                                    continue;
                                }

                                if (typeof el.r == 'string') {
                                    const name = el.r.split('/').pop().split('.')[0].replace(/^[^a-zA-Z_]+|[^a-zA-Z0-9_]+/gi, '');
                                    let val = typeof el.o === 'number' ? `(${name} + ${el.o|0})` : name;
                                    if (type === 'uint32_t' || type == 'uintptr_t') {
                                        out.push(`${type}(${val})`);
                                    } else if (type === 'uint8_t') {
                                        out.push(`${type}(uintptr_t(${val}) >>  0)`);
                                        out.push(`${type}(uintptr_t(${val}) >>  8)`);
                                        out.push(`${type}(uintptr_t(${val}) >> 16)`);
                                        out.push(`${type}(uintptr_t(${val}) >> 24)`);
                                    }
                                    continue;
                                }
                            }
                            if (typeof el === 'number') {
                                out.push(el | 0);
                                continue;
                            }
                        }
                        acc.push(`const ${type} ${res}[] = {${out.join(',')}};`);
                    }
                }
                return acc.join('\n');
            }
            let sym = this.main;
            if (key != 'main')
                sym = this.main.find(key, true);
            if (!sym)
                this.error(`Could not find ${key}`);
            return encode(sym);
        });

        return this.header.join('\n') + '\n' + str;

        function toString(arr) {
            for (let i = 0, max = arr.length; i < max; ++i) {
                const v = arr[i];
                if (typeof v == "string") {
                    if (v[0] == "}") this.indent--;
                    translated += "    ".repeat(this.indent);
                    translated += v;
                    translated += "\n"
                    if (v == "{") this.indent++;
                } else if (v === undefined) {
                } else {
                    toString.call(this, v);
                }
            }
        }
    }
}

export function cppWriter(program, opts) {
    const cpp = new CPP();

    if (Array.isArray(opts.strings)) {
        opts.strings.forEach(str => literalToString(str, true));
    }

    if (Array.isArray(opts.globals)) {
        opts.globals.forEach(name => {
            let v = program.main.index[name];
            if (!v) {
                v = new ir.Var("var", name);
                program.main.add(v);
            }
            cpp.globals[v.id] = v;
        });
    }

    if (Array.isArray(opts.strings)) {
        opts.strings.forEach(str => {
            literalToString(str, true);
        });
    }

    cpp.write(program);
    return cpp.toString(opts.platform);
}
