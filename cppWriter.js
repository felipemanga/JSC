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
        ret += 'f';
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
    if (node instanceof ir.Literal)
        return `{${encode(node)}}`;
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
            return `js::get(${encode(ctx)}, ${encode(node.variable, true)})`;
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
            "0", "1", "2", "3", "4", "5",
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
            : v.isCaptured()
            ? `js::Tagged& ${encode(v)} = *js::set(${encode(this.method.context)}, ${literalToString(v.name, true)}, {});`
            : `js::Local ${encode(v)}; // ${v.kind}`
    }

    Scope(node, endWithReturn) {
        const decls = [];
        const setup = [];
        const before = [`// begin ${node.debug}`, (node.transparent ? '' : '{'), setup, decls];
        const after = [(node.transparent ? '' : '}'), `// end ${node.debug}`];
        const children = node.children.map(child => this.write(child));

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

        const locals = node.index;
        for (let key in locals) {
            let v = locals[key];
            if ((v.id in varindex) || !(v instanceof ir.Var))
                continue;
            varindex[v.id] = v;
            let decl = this.declare(v);
            if (node == this.main && v.name) {
                this.out.unshift(decl);
            } else {
                decls.push(decl);
            }
        }

        if (node instanceof ir.Method) {
            decls.unshift('PROFILER;');
            const that = node.index["this"];
            if (that.read || that.write) {
                decls.push(`js::initThis(${encode(node.index["this"])}, ${encode(node.args)}, ${node.guessObjectSize()}, isNew);`);
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
            if (ctx instanceof ir.Var) {
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
                ret.push(`js::set(${encode(ctx)}, ${encode(lookup.variable, true)}, ${encode(right)});`);
            } else {
                ret.push(`js::set(${encode(ctx)}, ${encode(lookup.variable)}, ${encode(right)});`);
            }
        } else if (ctx instanceof ir.Scope) {
            let v = ctx.find(lookup.variable, true);
            if (!v)
                this.error(`Variable ${lookup.variable} not defined`);
            ret.push(`${encode(v)} = ${encode(right)};`);
            v.write++;
        }
        this.stack.push(right);
        return ret;// `// assign ${lookup.variable} ${node.operator} ${right.constructor.name}`;
    }

    UnaryExpression(node) {
        const lookup = this.stack.pop();
        const tmp = new ir.Var();
        node.parent.method.add(tmp);
        const opName = {
            true:{
                "++":"preinc",
                "--":"predec",
                "!":"not",
                "-":"neg",
                "+":"pos"
            },
            false:{
                "++":"inc",
                "--":"dec"
            }
        }[!!node.prefix][node.operator];
        this.stack.push(tmp);
        return `js::op_${opName}(${encode(tmp)}, ${encode(lookup)}); // ${node.operator}`;
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
        const tmp = new ir.Var();
        node.parent.add(tmp);
        this.stack.push(tmp);
        tmp.write++;
        const opName = {
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
        out.push(`js::op_${opName[node.operator] || node.operator}(${encode(tmp)}, ${local(left)}, ${local(right)});`);
        return out;
    }

    Array(node) {
        const array = new ir.Var();
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
            values[node.length - i - 1] = `js::set(${strobj}, ${literalToString(key.variable, true)}, ${encode(value)});`;
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
                return Object.keys(this.program.resourceData)
                    .map(res => {
                        const src = this.program.resourceData[res];
                        if (!src)
                            return '// RESOURCEDECL(${res}); // built-in';
                        const out = [];
                        for (let i = 0, len = src.length; i < len; i += 2)
                            out.push(parseInt(src.substr(i, 2), 16));
                        return `RESOURCEDECL(${res}) = {${out.join(',')}};`;
                    }).join('\n');
            }
            let sym = this.main;
            if (key != 'main')
                sym = this.main.find(key, true);
            if (!sym)
                this.error(`Could not find ${key}`);
            return encode(sym);
        });

        return str;

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
