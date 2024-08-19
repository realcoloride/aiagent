const fs = require('fs');
const spawn = require('child_process').spawn;

module.exports = (args) => {
    const filePath = './temp/᲼᲼᲼᲼᲼';
    fs.writeFileSync(filePath, args);
    spawn('notepad', [filePath], { stdio: 'inherit' });

    setTimeout(_ => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) }, 10000);
};