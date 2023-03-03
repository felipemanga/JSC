export function dataProg(ast, program, filename, jsc) {
    const name = filename.split('/').pop().split('.')[0].replace(/^[^a-zA-Z_]+|[^a-zA-Z0-9_]+/gi, '');
    // console.log('Adding resource ', name, ast);
    program.resourceData[name] = ast;
    return program;
}
