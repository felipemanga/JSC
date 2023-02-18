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
            if (!src) {
                return `//R.${res}; // built-in`;
            }
            const out = [];
            for (let i = 0, len = src.length; i < len; i += 2)
                out.push(parseInt(src.substr(i, 2), 16));
            return `R.${res} = Uint8Array.from([${out.join(',')}]);`;
        }).join('\n');
    return R + '\n' + program.sourceAST.map(ast => toString(ast)).join('\n');
}
