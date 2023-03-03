import * as ir from './IR.js'

function toString(ast) {
    const escodegen = require('escodegen');
    return escodegen.generate(ast, {
        format: {
            indent: {
                style: ''
            },
            quotes: 'auto',
            compact: true
        }
    });
}


export function jsWriter(program, opts) {
    const R = Object.keys(program.resourceData)
        .map(res => {
            const src = program.resourceData[res];
            const clean = res.replace(/^[^a-zA-Z_]+|[^a-zA-Z0-9_]+/gi, '');
            if (typeof src == 'string') {
                if (!src) {
                    return `//R.${clean}; // built-in`;
                }
                const out = [];
                for (let i = 0, len = src.length; i < len; i += 2)
                    out.push(parseInt(src.substr(i, 2), 16));
                return `R.${clean} = Uint8Array.from([${out.join(',')}]);`;
            } else {
                if (Array.isArray(src)) {
                    for (let el of src) {
                        if (el && typeof el == "object" && el.r)
                            el.r = el.r.split('.')[0].replace(/^[^a-zA-Z_]+|[^a-zA-Z0-9_]+/gi, '');
                    }
                }
                return `R.${clean} = ` + JSON.stringify(src);
            }
        }).join('\n');
    return R + '\n' + program.sourceAST.map(ast => toString(ast)).join('\n');
}
