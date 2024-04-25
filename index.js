// @(real)coloride - 2024

// imports
const { Client, Events, GatewayIntentBits, VoiceState, CDN } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages] });

const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, StreamType, NoSubscriberBehavior } = require('@discordjs/voice');
const { OpusEncoder } = require('@discordjs/opus');

const fs = require('fs');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const path = require('path');

const Groq = require('groq-sdk');

// dotenv
require("dotenv").config();
function getEnv(name) { return process.env[name] };

// constants
const WEBSOCKET_ADDRESS = getEnv("WEBSOCKET_ADDRESS");
const WEBSOCKET_PORT = getEnv("WEBSOCKET_PORT");
  var WEBSOCKET_SECRET = getEnv("WEBSOCKET_SECRET");
const DISCORD_BOT_TOKEN = getEnv("DISCORD_BOT_TOKEN");
const DISCORD_BOT_PREFIX = getEnv("DISCORD_BOT_PREFIX");
const DISCORD_BOT_JOIN_COMMAND_NAME = getEnv("DISCORD_BOT_JOIN_COMMAND_NAME");
const DISCORD_BOT_LEAVE_COMMAND_NAME = getEnv("DISCORD_BOT_LEAVE_COMMAND_NAME");
const DISCORD_BOT_ADMIN_ID = getEnv("DISCORD_BOT_ADMIN_ID");
const SPEAK_TIME_DURATION = getEnv("SPEAK_TIME_DURATION");
const GROQ_API_KEY = getEnv("GROQ_API_KEY");

const TTS_PROVIDER = getEnv("TTS_PROVIDER");
const TTS_PIPER_MODEL = getEnv("TTS_PIPER_MODEL");
const TTS_SILERO_ADDRESS = getEnv("TTS_SILERO_ADDRESS");
const TTS_SILERO_SPEAKER = getEnv("TTS_SILERO_SPEAKER");

const piperFolder = "piper";
const piperVoicesFolder = "voices";

/* tts */


/* ai */
const groq = new Groq({apiKey: GROQ_API_KEY});

async function sendToAI(connectionManager, dialogues) {
    // key   : member
    // value : dialogue
    let payload = `The following user is a User talking to you through a discord voice chat. You are an assistant AI and you are hearing a transcript of what they are saying. What you will say next will be transcribed and played through text to speech to the user. Use punctuation like ... or ? to imply to the TTS. BE SURE TO ONLY STICK TO 2 OR 3 SENTENCES OR IT WILL TAKE A LONG TIME FOR THE USER TO HEAR YOUR MESSAGE.\n\n{username}: {input}`

    console.log(dialogues);
    for (const member in dialogues) {
        const dialogue = dialogues[member];
        
        console.log(member);
        console.log(dialogue);
        payload += `${member.username}: ${dialogue}`;
    }

    payload += "\nAssistant:";
    const response = await groq.chat.completions.create({
        messages: [
            {
                role: "system",
                content: "Dont use JSON. Dont use JSON. Keep messages short (1-2 sentences max)."
            },
            {
                role: "user",
                content: payload
            }
        ],
        model: "llama2-70b-4096",
        temperature: 0.75,
        max_tokens: 500,
        top_p: 1,
        stop: null,
        stream: false
    });
    
    const completion = response.choices[0]?.message?.content?.trim()?.replace('\n', '');
    console.log(response.choices[0]?.message);

    return completion;
}

// todo queue/not play if something already playing
let sileroSessionPath = `${__dirname}\\silero`.replace(/\\/g, '/');
function setupTTS() {
    console.log("Setting up text to speech provider...");

    switch (TTS_PROVIDER) {
        case "SILERO":
            // init session
            fetch(`${TTS_SILERO_ADDRESS}/tts/session/`, {
                headers: {
                    "content-type": "application/json"
                },
                method: "POST",
                body: JSON.stringify({
                    "path": sileroSessionPath
                })
            })
            .catch(error => { console.error(error); });

            setInterval(() => {
                // clear cache
                fs.readdir(sileroSessionPath, (_, files) => {
                    files.forEach(file => {
                        const filePath = path.join(directoryPath, file);
                        fs.unlink(filePath);
                    });
                });
            }, 90000);
            break;
        case "PIPER":
            
            break;
    }
}
function pipeFfmpeg(command, passthrough) {
    const childProcess = spawn(command, {
        shell: true,
        stdio: ['pipe', 'pipe', 'ignore'] // ignore stdin, pipe stdout, ignore stderr
    });
    
    // pipe through passthrough for streaming
    childProcess.stdout.pipe(passthrough);
    
    // events
    childProcess.on('error', (error) => {
        console.error(`Error executing command: ${error}`);
    });

    return childProcess;
}
function playTTS(connectionManager, text) {
    const passthrough = new PassThrough();
    const audioResource = createAudioResource(passthrough, { inputType: StreamType.Raw });
    let command;

    switch (TTS_PROVIDER) {
        case "SILERO":
            fetch(`${TTS_SILERO_ADDRESS}/tts/generate/`, {
                method: "POST",
                headers: {
                    "content-type":"application/json"
                },
                body: JSON.stringify({
                    speaker : TTS_SILERO_SPEAKER,
                    text,
                    session : connectionManager.channel.id
                })
            }).then(async(request) => {
                const response = await request.arrayBuffer();
                const buffer = Buffer.from(response);

                // this resamples from the sample rate of the voice model to 48khz (opus) 16 bit pcm
                // then makes it stereo (or else it sounds sped up)
                command = `ffmpeg -f s16le -ar 48000 -ac 1 -i pipe:0 -ar 48000 -ac 2 -f s16le -filter:a "pan=stereo|c0=c0|c1=c0" pipe:1 -loglevel quiet`;

                const ffmpeg = pipeFfmpeg(command, passthrough);
                ffmpeg.stdin.write(buffer);
                ffmpeg.stdin.end();
            });
            
            break;
        case "PIPER":
            const piperModelPath = `${piperVoicesFolder}/${TTS_PIPER_MODEL}`;
            const sampleRate = require(path.join(__dirname, `${piperModelPath}.json`))["audio"]["sample_rate"]; // 22050 for high

            command = `echo ${text} | "${piperFolder}/piper.exe" -m "${piperModelPath}" --output_raw -q |`;
                        // this resamples from the sample rate of the voice model to 48khz (opus) 16 bit pcm
                        // then makes it stereo (or else it sounds sped up)
            command += `ffmpeg -f s16le -ar ${sampleRate} -ac 1 -i pipe:0 -ar 48000 -ac 2 -f s16le -filter:a "pan=stereo|c0=c0|c1=c0" pipe:1 -loglevel quiet`;
            
            pipeFfmpeg(command, passthrough);
            break;
    }

    connectionManager.player.play(audioResource);

}

/* discord bot */
class ConnectionManager {
    streams = {};
    channel = null;
    checkingInterval = null;
    tasks = [];
    player = null;

    speechTimer = 0.0;
    hasTalkedAtleastOnce = false;

    addMember(memberId) {
        this.flushBuffer(memberId);
    }
    removeMember(memberId) {
        delete this.streams[memberId];
    }
    hasStream(memberId) {
        return this.streams[memberId] != null;
    }
    pushToBuffer(memberId, data) {
        this.hasTalkedAtleastOnce = true;
        this.streams[memberId] = Buffer.concat([this.streams[memberId], data]);
    }
    flushBuffers() {
        for (const memberId in this.streams)
            this.flushBuffer(memberId);
    }
    flushBuffer(memberId) {
        this.streams[memberId] = Buffer.alloc(0); // empty buffer
    }

    constructor(connection, channel) {
        this.channel = channel;
        this.speechTimer = 0.0;
        this.player = createAudioPlayer({behaviors: {noSubscriber: NoSubscriberBehavior.Play}});
        connection.subscribe(this.player);
    }

    dispose() {
        this.streams = {};
        this.channel = null;

        clearInterval(this.checkingInterval);
        this.checkingInterval = null;

        for (let i = 0; i < this.tasks.length; i++)
            unqueueTask(this.tasks[i]);

        this.tasks = [];
    }
}

let connections = {
    // connection : {
    //      streams : {
    //          user : buffer
    //      }
    //      channel : channel
    //      checkingInterval : interval
    //      tasks : [ numbers ]
    // }
}
let tasks = {
    // taskid : connectionManager
}

function subscribeToMember(connection, memberId) {
    const connectionManager = connections[connection];

    // if member's buffer already in, ignore
    if (connectionManager.hasStream(memberId))
        return;

    const opusStream = connection.receiver.subscribe(memberId); //, {end: EndBehaviorType.Manual, emitClose: true, objectMode: false}
        
    // convert it to mono 16khz 16bit pcm
    const encoder = new OpusEncoder(16000, 1);

    // create writable buffer
    connectionManager.addMember(memberId);

    opusStream.on('data', (data) => {
        // decode opus packet
        const decodedData = encoder.decode(data);

        if (decodedData.length == 0) return;

        // stack into opus buffer
        connectionManager.pushToBuffer(memberId, decodedData);
        connectionManager.speechTimer = SPEAK_TIME_DURATION;

        // clear buffer with [] since its memsafe
        //console.log(decodedData);
    });
    opusStream.on('error', (error) => {
        console.log(error);
    });
    opusStream.on('end', () => {
        console.log("ended");
    });
}
function unsubscribeFromMember(connection, memberId) {
    connections[connection]?.removeMember(memberId);
}
function processBuffers(connectionManager) {
    if (!connectionManager.hasTalkedAtleastOnce) return;

    const data = {...connectionManager.streams};
    
    // flush past buffers
    connectionManager.flushBuffers();
    
    // 8  -> 1 byte
    // 16 -> 2 bytes
    // 32 -> 4 bytes
    let bufferSize = 6; // secret (32) + taskId (16)
    
    let memberIds = [];
    const taskId = Math.floor(Math.random() * 9000) + 1000;
    
    // secret usercount ... useridlength userid datalength databytes

    // allocate first
    for (const memberId in data) {
        const voiceBuffer = data[memberId];

        if (voiceBuffer.length == 0) continue;

        bufferSize += Buffer.byteLength(memberId, 'utf8') + 1 + 4; // + 1 for the username length and + 4 for bytes len
        //bufferSize += voiceBuffer.byteLength;

        //console.log("userid bytes: " + Buffer.byteLength(memberId, 'utf8') + " | voicebuffer bytes: " + voiceBuffer.byteLength);
        memberIds.push(memberId);
    }

    const userCount = memberIds.length;

    bufferSize += 2; // usercount (16)
    //console.log("current buffer byte size: " + bufferSize);

    let buffer = Buffer.alloc(bufferSize);

    let offset = 0;

    buffer.writeInt32BE(WEBSOCKET_SECRET, 0);
    offset += 4;
    
    buffer.writeInt16BE(taskId, offset);
    offset += 2;

    buffer.writeInt16BE(userCount, offset); // 16 -> 4 (32)
    offset += 2;

    for (let i = 0; i < userCount; i++) {
        const memberId = memberIds[i];

        const usernameIdLength = Buffer.byteLength(memberId, 'utf-8');
        buffer.writeInt8(usernameIdLength, offset); // 1b
        offset++;

        buffer.write(memberId, offset, 'utf-8'); // userid
        offset += Buffer.byteLength(memberId, 'utf-8'); // update offset

        const voiceBuffer = data[memberId];

        // write byteslen
        buffer.writeInt32BE(voiceBuffer.byteLength, offset);
        offset += 4;
        
        buffer = Buffer.concat([buffer, data[memberId]]); // voiceBuffer
        
        // get written byte total
        offset += voiceBuffer.byteLength;
    }

    //console.log("sent data " + buffer.byteLength + " bytes")
    queueTask(connectionManager, taskId);
    sendData(buffer);
}
// tasks
function queueTask(connectionManager, taskId) {
    tasks[taskId] = connectionManager;
    connectionManager.tasks.push(taskId);
}
function unqueueTask(taskId) {
    delete tasks[taskId];
}
async function whenTaskFinished(data) {
    const json = JSON.parse(data);
    /*
    {
        "taskId": 1234
        "results" : [
            1234: "dialogue",
            5678: "dialogue"
        ]
    }
    */

    const taskId = json["taskId"];
    const connectionManager = tasks[taskId];
    if (connectionManager == null) return;

    // remove task
    delete connectionManager.tasks[taskId];
    unqueueTask(taskId);

    // process results
    const { results } = json;

    for (const memberId in results) {
        const dialogue = results[memberId]?.trim() || "";
        
        // ignore empty dialogue
        if (dialogue == "") {
            delete results[memberId];
            continue;
        }

        const channel = connectionManager.channel;
        const member = channel.members.get(memberId);
        if (member == null)
            continue;

        // member id -> member class
        delete results[memberId];
        results[member] = dialogue;

        await channel.send(memberId + ": " + dialogue);
        playTTS(connectionManager, dialogue);
    }

    if (Object.keys(results).length == 0) return;

    //const response = await sendToAI(connectionManager, results);
}

async function recordConnection(connection, channel, authorMember) {
    const connectionManager = new ConnectionManager(connection, channel);
    connections[connection] = connectionManager;
    
    channel.members.forEach((member) => {
        // dont subscribe to self
        if (member.id === client.user.id) return;

        subscribeToMember(connection, member.id);
    });

    // check for the speaking timer
    connectionManager.checkingInterval = 
        setInterval(() => {
            if (connectionManager.speechTimer > 0) {
                // console.log("speech timer: " + connectionManager.speechTimer);
                connectionManager.speechTimer -= 0.1
                return;
            } 

            // end of speech
            processBuffers(connectionManager);
            connectionManager.hasTalkedAtleastOnce = false;
            connectionManager.speechTimer = 0.0;
        }, 100)
}
function formCommand(name) {
    return DISCORD_BOT_PREFIX + name;
}
function getMemberVoiceChannelId(member) {
    return member.voice.channelId;
}

client.on(Events.MessageCreate, async message => {
    if (message.author.id != DISCORD_BOT_ADMIN_ID) return;

    const messageContentLowercased = message.content.toLowerCase();
    const { member, guildId, channel } = message;
    const channelId = getMemberVoiceChannelId(member);

    const joining = messageContentLowercased == formCommand(DISCORD_BOT_JOIN_COMMAND_NAME);
    const leaving = messageContentLowercased == formCommand(DISCORD_BOT_LEAVE_COMMAND_NAME);

    if (!joining && !leaving) return;

    if (!channelId) {
        await message.reply("You are not in a voice channel!");
        return;
    }

    let connection = getVoiceConnection(guildId);

    // leaving
    if (leaving) {
        connection?.destroy();
        delete connections[connection];
        return;
    }

    if (connection != null) {
        await message.reply("I am already in a voice channel!");
        return;
    }

    // joining
    connection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
    });

    recordConnection(connection, channel, member);
    await message.reply("Joined voice chat");
});
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const newConnection = getVoiceConnection(newState.guild.id);
    // related to voice chat of the bot
    if (newState.id == client.user.id) {
        // if disconnected/kicked
        if (newState.channelId == null) {
            connections[newConnection]?.dispose();
            delete connections[newConnection];
            return;
        }
        
        if (oldState.channelId == null)
            return;

        //console.log(oldState, newState);

        // if moved and was in a vc
        if (oldState.channelId != newState.channelId && getVoiceConnection(oldState.guild.id) != null)
            newConnection?.destroy();   
    } else {
        // related to voice chat of others

        // register new people in vc
        if (newConnection != null) return;

        // check if we're talking about the same person (just in case)
        if (oldState.id != newState.id) return;

        const memberId = newState.id;
        const botVoiceChannelId = connections[newConnection]?.channel?.id;


                        // if was not in the channel from that guild
        const joining = oldState.channelId != botVoiceChannelId &&
                        // but is not win the channel from that guild
                        newState.channelId == botVoiceChannelId;

                        // inverted condition basically
        const leaving = !joining;

        if (leaving) {
            console.log("member left", newState.member.displayName);
            unsubscribeFromMember(newConnection, memberId);
            return;
        } else if (joining) {
            console.log("member joined", newState.member.displayName);
            subscribeToMember(newConnection, memberId);
            return;
        }
    }
});

client.once('ready', () => {
	console.log("Discord bot is ready.");
});
function initializeDiscordBot() {
    console.log("Initializing Discord Bot...");
    client.login(DISCORD_BOT_TOKEN);
}


/* websocket */
let ws;
let connected;
let websocketEventsRegistered;

function whenWebsocketClosed() {
    connected = false;
    
    /*for (let connection in Object.keys(connections)) {
        connection?.destroy();
        delete connections[connection];
    }*/

    console.log("Disconnected, retrying connection");
    initializeWebSocket();
}
function registerWebsocketEvents() {
    if (websocketEventsRegistered) return;
    
    websocketEventsRegistered = true;
    ws.on('open', () => {
        connected = true;
        console.log("Connected to websocket");
        initializeDiscordBot();
    });
    ws.on('message', whenTaskFinished);
    ws.on('close', _ => {
        whenWebsocketClosed();
    });
    ws.on('error', _ => {
        whenWebsocketClosed();
    })
}
function initializeWebSocket() {
    const address = `ws${(WEBSOCKET_ADDRESS.toLowerCase().startsWith("https") ? "s" : "")}://${WEBSOCKET_ADDRESS}:${WEBSOCKET_PORT}`;

    console.log(`Connecting to server: ${address}...`);

    try {
        ws = new WebSocket(address);
    } catch {
        whenWebsocketClosed();
    }
    
    registerWebsocketEvents();
}
function sendData(data) {
    ws.send(data);
}

console.log("@(real)coloride - 2024");
console.log("======================");

WEBSOCKET_SECRET = parseInt(WEBSOCKET_SECRET);

if (typeof(WEBSOCKET_SECRET) != 'number' || WEBSOCKET_SECRET >= 2147483647 || WEBSOCKET_SECRET < 0) {
    console.log("[error] websocket secret should be a number and be below 2147483647 and higher than 0.");
    return;
}

setupTTS();
initializeWebSocket();