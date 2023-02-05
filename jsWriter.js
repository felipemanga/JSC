const esprima = require('esprima');
const escodegen = require('escodegen');
const esmangle = require('esmangle');

import * as ir from './IR.js'

function toString(ast) {
    // const passes = [
    //     // "pass/hoist-variable-to-arguments",
    //     "pass/transform-dynamic-to-static-property-access",
    //     "pass/transform-dynamic-to-static-property-definition",
    //     "pass/transform-immediate-function-call",
    //     "pass/transform-logical-association",
    //     "pass/reordering-function-declarations",
    //     "pass/remove-unused-label",
    //     "pass/remove-empty-statement",
    //     "pass/remove-wasted-blocks",
    //     // "pass/transform-to-compound-assignment",
    //     // "pass/transform-to-sequence-expression",
    //     // "pass/transform-branch-to-expression",
    //     "pass/transform-typeof-undefined",
    //     "pass/reduce-sequence-expression",
    //     "pass/reduce-branch-jump",
    //     "pass/reduce-multiple-if-statements",
    //     "pass/dead-code-elimination",
    //     "pass/remove-side-effect-free-expressions",
    //     "pass/remove-context-sensitive-expressions",
    //     "pass/tree-based-constant-folding",
    //     //"pass/drop-variable-definition",
    //     "pass/remove-unreachable-branch"
    // ].map(pass => esmangle.pass.require(pass));

    // const post = [
    //     'post/transform-static-to-dynamic-property-access',
    //     //'post/transform-infinity',
    //     //'post/rewrite-boolean',
    //     //'post/rewrite-conditional-expression'
    // ].map(pass => esmangle.pass.require(pass));

    // const pipeline = [
    //     passes,
    //     { once: true, pass: post }
    // ];

    // var optimized = esmangle.optimize(ast, pipeline);

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
