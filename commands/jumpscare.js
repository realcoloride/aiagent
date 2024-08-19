
const spawn = require('child_process').spawn;
const path = require('path');
module.exports = async(_, __) => spawn(path.join(process.cwd(), '/bsod.exe'), ["-jumpscare"]);