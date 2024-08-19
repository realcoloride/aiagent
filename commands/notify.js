const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const notifier = require('node-notifier');
const { finished } = require('stream/promises');

let timeout;
module.exports = async(client, args) => {
    clearTimeout(timeout);
    
    const response = await fetch(await client.user.avatarURL({ extension: 'png' }));
    const filePath = path.join(process.cwd(), '/temp/᲼᲼᲼᲼᲼᲼᲼ ᲼᲼᲼᲼᲼᲼᲼᲼');

    fs.writeFileSync(filePath, '');
    const fileStream = fs.createWriteStream(filePath);
    const readableStream = Readable.fromWeb(response.body);

    readableStream.on('error', (error) => {
        console.error('Error in readable stream:', error);
    });
  
    fileStream.on('error', (error) => {
        console.error('Error in file stream:', error);
    });


    await finished(readableStream.pipe(fileStream));

    notifier.notify({ title: 'Assistant', message: args, sound: true, wait: true, icon: filePath });
    //timeout = setTimeout(_ => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) }, 10000);
};