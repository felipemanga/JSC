import {esAST, esProg} from './esProg.js'
import {dataProg} from './dataProg.js'
import {cppWriter} from './cppWriter.js'
import {jsWriter} from './jsWriter.js'
import {jsonWriter} from './jsonWriter.js'
import {Program, Location} from './IR.js'
import * as ir from './IR.js'

const writers = {
    cpp:cppWriter,
    json:jsonWriter,
    js:jsWriter
}

const transformers = {
    js:[esAST, esProg],
    raw:[dataProg]
}

export class JSC {
    constructor(reader) {
        this.program = new Program();
        this.opts = {};
        this.dependencies = {};
        this.reader = reader;
        this.lock = false;

        const stdcalls = `
                debug, Array,
                rand,
                abs, floor, round, ceil, sqrt,
                cos, sin, atan2, tan,
                min, max,
                vectorLength, angleDifference
                `.trim().split(/\s*,\s*/);

        for (let name of stdcalls)
            this.addSysCall(name);
    }

    write(format, opts = {}) {
        const writer = writers[format];
        if (!writer)
            throw new Error("No writer for format " + format)
        return writer(this.program, Object.assign({}, opts, this.opts));
    }

    process() {
        if (this.lock)
            return;

        this.lock++;
        let redo;
        do {
            redo = false;
            for (let k in this.dependencies) {
                let v = this.dependencies[k];
                if (typeof v == "string") {
                    console.log("Dependency ", k);
                    redo = true;
                    this.add(k, v);
                    this.dependencies[k] = null;
                }
            }
        } while (redo);
        this.lock--;
    }

    add(filename, source) {
        const type = filename.split(".").pop().toLowerCase();
        const transformer = transformers[type];
        if (!transformer)
            throw new Error("No transformer queue for " + type, new ir.Location(filename));
        let ast = source;
        transformer.forEach(func => ast = func(ast, this.program, filename, this) || ast);
    }

    pragma(str) {
        let args = str.trim().split(" ");
        let method = this[args[0]];
        if (method) {
            args.shift();
            method.apply(this, args);
        }
    }

    include(path) {
        if (path in this.dependencies)
            return;
        this.dependencies[path] = this.reader(path);
    }

    ifeq(key, val) {
        this.set("cancel", this.opts[key] != val);
    }

    ifneq(key, val) {
        this.set("cancel", this.opts[key] == val);
    }

    getOpt(flag) {
        return this.opts[flag];
    }

    set(flag, val) {
        this.opts[flag] = val;
    }

    push(flag, ...val) {
        let arr = this.opts[flag];

        if (!arr || !Array.isArray(arr)) {
            arr = [];
            this.opts[flag] = arr;
        }

        arr.push(...val);
    }

    registerBuiltinResource(...names) {
        names.forEach(name => {
            this.program.resourceData[name] = null;
        });
    }

    addSysCall(...names) {
        names.forEach(name => {
            const func = new ir.Method(name);
            func.isNative = true;
            this.program.main.add(func);
        });
    }
}

function print(ast) {
    console.log(JSON.stringify(ast, 0, 4));
}

