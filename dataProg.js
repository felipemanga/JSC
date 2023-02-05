export function dataProg(ast, program, filename, jsc) {
    const name = filename.split('/').pop().split('.')[0];
    // console.log('Adding resource ', name, ast);
    program.resourceData[name] = ast;
    return program;
}
