const spawn = require('child_process').spawn;
const fs = require('fs');

let timeout;
module.exports = async(_, args) => {
    clearTimeout(timeout);

    const filePath = './temp/᲼᲼᲼᲼᲼';
    fs.writeFileSync(filePath, args);
    spawn('notepad', [filePath], { stdio: 'inherit' });

    setTimeout(_ => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) }, 10000);
};