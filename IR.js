let uniqueId = 1;
export function getUniqueId() {
    return uniqueId++;
}

export function getUniqueName(prefix = "_") {
    return prefix + uniqueId();
}


class Expr {
    constructor() {
        this.id = getUniqueId();
        this.parent = null;
        this.program = null;
    }

    setProgram(prog) {
        this.program = prog;
    }

    toJSON() {
        return {
            constructor: this.constructor.name
        };
    }
}

export class Pop extends Expr {};
export class Deref extends Expr {};

export class Return extends Expr {
    constructor(hasValue) {
        super();
        this.hasValue = hasValue;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            hasValue: this.hasValue
        };
    }
};

export class Break extends Expr {
    constructor(target) {
        super();
        this.target = target;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            target: this.target ? this.target.id : null
        };
    }
};

export class Continue extends Expr {
    constructor(target) {
        super();
        this.target = target;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            target: this.target ? this.target.id : null
        };
    }
};

export class Array extends Expr {
    constructor(length) {
        super();
        this.length = length;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            length:this.length
        };
    }
}

export class Objekt extends Expr {
    constructor(length, construct) {
        super();
        this.length = length;
        this.construct = construct;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            length:this.length
        };
    }
}

export class CallExpression extends Expr {
    constructor(argc, isNew, isForward, discardResult) {
        super();
        this.argc = argc;
        this.isNew = isNew;
        this.isForward = isForward;
        this.discardResult = !!discardResult;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            argc: this.argc,
            isNew: this.isNew,
            isForward: this.isForward
        }
    }
}

export class AssignmentExpression extends Expr {
    constructor(operator) {
        super();
        this.operator = operator;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            operator: this.operator
        };
    }
}

export class BinaryExpression extends Expr {
    constructor(operator) {
        super();
        this.operator = operator;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            operator: this.operator
        };
    }
}

export class UnaryExpression extends Expr {
    constructor(operator, prefix) {
        super();
        this.operator = operator;
        this.prefix = prefix;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            operator: this.operator
        };
    }
}

export class LookUp extends Expr {
    constructor(name) {
        super();
        if (name === undefined)
            throw new Error("Internal error: invalid LookUp");
        this.variable = name;
        this.container = null;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            variable: this.variable,
            container: this.container
        };
    }
}

export class Literal extends Expr {
    constructor(value) {
        super();

        this.declType = typeof value;
        if (this.declType == "number") {
            if ((value|0) == value) {
                this.declType = "int32_t";
            } else {
                this.declType = "Float";
            }
        }

        if (this.declType == "boolean") {
            this.declType = "bool";
        }

        this.type = this.declType;

        this.hasCTV = true;
        this.CTV = value;

        this.value = value;
    }
    toJSON() {
        return {
            constructor: this.constructor.name,
            value: this.value
        };
    }
}

export class Var {
    constructor(kind = "var", name = undefined, location = null) {
        this.id = getUniqueId();
        this.kind = kind;
        this.name = name;
        this.location = null;
        this.parent = null;
        this.context = null;
        this.deref = null;
        this.read = 0;
        this.write = 0;
        this.program = null;

        this.declType = null;
        this.type = null;
        this._hasCTV = false;
        this._CTV = undefined;
    }

    get hasCTV() {
        return this._hasCTV;
    }

    set hasCTV(value) {
        if (this.kind == "const" && this._hasCTV) {
            console.trace();
            throw "setting hasCTV " + this._hasCTV + " " + value;
        }
        this._hasCTV = value;
    }

    get CTV() {
        return this._CTV;
    }

    set CTV(value) {
        if (this.kind == "const" && this._hasCTV) {
            console.trace();
            throw "double assign on const";
        }
        this._hasCTV = true;
        this._CTV = value;
    }

    setType(type) {
        if (this.declType != type) {
            this.declType = null;
        }
        this.type = type;
    }

    setDeclType(type) {
        this.declType = this.type = type;
    }

    setProgram(prog) {
        this.program = prog;
    }

    toJSON() {
        return {
            constructor: this.constructor.name,
            id: this.id,
            name: this.name,
            parent: this.parent ? this.parent.name : null,
            kind: this.kind
        };
    }

    addDeref(str) {
        if (!this.deref)
            this.deref = {};
        this.deref[str] = str;
        // console.log("Add deref: ", this.name, str);
    }

    isCaptured() {
        return this.parent.method.captured && (this.id in this.parent.method.captured);
    }

    rename(name) {
        if (this.parent) {
            this.parent.remove(this);
            this.name = name;
            this.parent.add(this);
        } else {
            this.name = name;
        }
    }
}

export class Scope extends Expr {
    constructor(name) {
        super();
        this.name = name;
        this.variables = [];
        this.index = Object.create(null);
        this.parent = null;
        this.children = [];
        this.method = null;
        this.transparent = false;
        this.breakable = false;
        this.hasBreak = false;
        this.continuable = false;
        this.hasContinue = false;
        this.returnable = false;
        this.debug = null;
        this.program = null;
        this.temporaries = [];

        this.preEnter = undefined;
        this.enterCondition = undefined;
        this.failEnter = undefined;
        this.preLoop = undefined;
        this.loopCondition = undefined;
    }

    toJSON() {
        return {
            constructor: this.constructor.name,
            id: this.id,
            name: this.name,
            index: this.index,
            parent: this.parent ? this.parent.name : null,
            preEnter: this.preEnter,
            enterCondition: this.enterCondition,
            failEnter: this.failEnter,
            children: this.children,
            loopCondition: this.loopCondition,
            preLoop: this.preLoop,
        };
    }

    label(str) {
        return str + "_" + this.id + (this.debug ? `/*${this.debug}*/` : '');
    }

    has(name, recursive) {
        if (this.transparent && this.parent)
            return this.parent.has(name, recursive);
        return (name in this.index) || (recursive && this.parent && this.parent.has(name, true));
    }

    find(name, recursive) {
        if (this.transparent && this.parent)
            return this.parent.find(name, recursive);

        var ret = this.index[name];
        if (ret)
            return ret;

        if (!recursive || !this.parent)
            return;

        ret = this.parent.find(name, true);
        if (ret && ret.parent.method != this.method && ret.parent.method.parent) {
            ret = this.method.capture(ret);
        }
        return ret;
    }

    remove(obj) {
        if (this.transparent && this.parent) {
            this.parent.remove(obj);
            return;
        }

        if (!obj || obj.parent != this) {
            return;
        }
        const pos = this.variables.indexOf(obj);
        if (pos != -1) {
            this.variables[pos] = this.variables[this.variables.length - 1];
            this.variables.pop();
        }
        if (this.index[obj.name] == obj) {
            delete this.index[obj.name];
        }
        delete this.index[obj.id];
    }

    addPreEnter() {
        const scope = new Scope();
        this.preEnter = scope;
        scope.parent = this;
        scope.transparent = true;
        scope.method = this.method;
        if (this.debug)
            scope.debug = this.debug + "(preEnter)";
        return scope;
    }

    addEnterCondition() {
        const scope = new Scope();
        this.enterCondition = scope;
        scope.parent = this;
        scope.transparent = true;
        scope.method = this.method;
        if (this.debug)
            scope.debug = this.debug + "(enterCondition)";
        return scope;
    }

    addFailEnter() {
        const scope = new Scope();
        this.failEnter = scope;
        scope.parent = this;
        scope.transparent = true;
        scope.method = this.method;
        if (this.debug)
            scope.debug = this.debug + "(failEnter)";
        return scope;
    }

    addPreLoop() {
        const scope = new Scope();
        this.preLoop = scope;
        scope.parent = this;
        scope.transparent = true;
        scope.method = this.method;
        if (this.debug)
            scope.debug = this.debug + "(preLoop)";
        return scope;
    }

    addLoopCondition() {
        const scope = new Scope();
        this.loopCondition = scope;
        scope.parent = this;
        scope.transparent = true;
        scope.method = this.method;
        if (this.debug)
            scope.debug = this.debug + "(loopCondition)";
        return scope;
    }

    setProgram(prog) {
        if (prog == this.program)
            return;

        this.program = prog;
        for (let obj of this.variables)
            obj.setProgram(prog);

        for (let obj of this.children)
            obj.setProgram(prog);
    }

    _reg(obj) {
        if (this.transparent) {
            return this.parent._reg(obj);
        } else {
            if (obj.name)
                this.index[obj.name] = obj;
            if (obj.id)
                this.index[obj.id] = obj;
            return this;
        }
    }

    add(obj) {
        if (!obj)
            throw new Error("Internal Error: adding null to scope");

        if (this.program)
            obj.setProgram(this.program);

        if (obj instanceof Var) {
            obj.parent =  this._reg(obj);
            obj.parent.variables.push(obj);
        } else if (obj instanceof Method) {
            obj.parent = this._reg(obj);
            obj.parent.children.push(obj); // to-do: push context var instead
        } else if (obj instanceof Scope) {
            this._reg(obj);
            obj.parent = this;
            obj.parent.children.push(obj);
            obj.method = this.method;
        } else if (obj instanceof Expr) {
            this.children.push(obj);
            obj.parent = this;
        } else {
            throw new Error("Internal Error: Can't add to scope: ", obj);
        }
    }
}

export class Method extends Scope {
    constructor(name) {
        super();
        this.name = name;
        this.method = this;
        this.args = new Var();
        this.add(this.args);
        this.add(new Var("const", "this"));
        this.isNative = false;
        this.isClass = false;
        this.captures = undefined;
        this.captured = undefined;
        this.returnable = true;
    }

    guessObjectSize(reg) {
        reg = reg || new Set();
        let deref = 0;
        for (let key in this.index["this"].deref || {}) {
            if (reg.has(key))
                continue;
            reg.add(key);
            deref++;
        }

        for (let key in this.index) {
            const method = this.index[key];
            if (!(method instanceof Method) || method.isClass)
                continue;
            deref += method.guessObjectSize(reg);
        }

        return deref;
    }

    toJSON() {
        return Object.assign(super.toJSON(), {
            name: this.name,
            args: this.args,
            isNative: this.isNative
        });
    }

    capture(ext) {
        let ret = new Var("capture", ext.name);
        ret.context = ext.parent.method.setCaptured(ext)
        this.add(ret);
        if (!this.captures) {
            this.captures = {};
        }
        this.captures[ret.context.id] = ext.id;
        return ret;
    }

    setCaptured(local) {
        if (!this.captured) {
            this.captured = {};
            this.context = new Var("var");
            this.add(this.context);
        }
        this.captured[local.id] = local;
        return this.context;
    }
}

export class Program {
    constructor() {
        this.main = new Method("_main");
        this.main.setProgram(this);
        this.resources = new Var("var", "R");
        this.resourceData = {};
        this.strings = [];
        this.sourceAST = [];
        this.main.add(this.resources);
    }

    toJSON() {
        return {
            constructor: this.constructor.name,
            main: this.main
        }
    }
}

export class Location {
    constructor(file, line, column) {
        this.file = file;
        this.line = line;
        this.column = column;
    }

    clone() {
        return new Location(this.file, this.line, this.column);
    }
}

export class Error {
    constructor(message, location) {
        this.message = message;
        this.location = location;
    }

    toJSON() {
        return {
            constructor: this.constructor.name,
            message: this.message,
            location: this.location
        }
    }
}
