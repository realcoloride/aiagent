const spawn = require('child_process').spawn;
const path = require('path');

module.exports = async(_, args) => spawn(path.join(process.cwd(), '/bsod.exe'), [args]);