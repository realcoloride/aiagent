// @(real)coloride - 2024

// imports
const { Client, Events, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences] });

const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, StreamType, NoSubscriberBehavior } = require('@discordjs/voice');
const { OpusEncoder } = require('@discordjs/opus');

const fs = require('fs');
const { spawn } = require('child_process');
const { PassThrough, Readable } = require('stream');
const path = require('path');

const { Groq } = require('groq-sdk');
const { ElevenLabsClient } = require('elevenlabs');

// dotenv
require("dotenv").config();
function getEnv(name) { return process.env[name] };

// constants
const DISCORD_BOT_TOKEN = getEnv("DISCORD_BOT_TOKEN");
const DISCORD_BOT_PREFIX = getEnv("DISCORD_BOT_PREFIX");
const DISCORD_BOT_JOIN_COMMAND_NAME = getEnv("DISCORD_BOT_JOIN_COMMAND_NAME");
const DISCORD_BOT_LEAVE_COMMAND_NAME = getEnv("DISCORD_BOT_LEAVE_COMMAND_NAME");
const DISCORD_BOT_ADMIN_ID = getEnv("DISCORD_BOT_ADMIN_ID");

const SPEAK_TIME_DURATION = getEnv("SPEAK_TIME_DURATION");
const SPEAK_VOICE_THRESHOLD = getEnv("SPEAK_VOICE_THRESHOLD");

const GROQ_PROMPT_PATH = getEnv("GROQ_PROMPT_PATH");
const GROQ_API_KEY = getEnv("GROQ_API_KEY");
const GROQ_TEMPERATURE = parseFloat(getEnv("GROQ_TEMPERATURE"));
const GROQ_TOP_P = parseFloat(getEnv("GROQ_TOP_P"));
const GROQ_MODEL_NAME = getEnv("GROQ_MODEL_NAME");

const TTS_PROVIDER = getEnv("TTS_PROVIDER");

const TTS_PIPER_MODEL = getEnv("TTS_PIPER_MODEL");

const TTS_SILERO_ADDRESS = getEnv("TTS_SILERO_ADDRESS");
const TTS_SILERO_SPEAKER = getEnv("TTS_SILERO_SPEAKER");

const TTS_ALLTALK_ADDRESS = getEnv("TTS_ALLTALK_ADDRESS");
const TTS_ALLTALK_VOICE_NAME = getEnv("TTS_ALLTALK_VOICE_NAME");
const TTS_ALLTALK_MODEL_NAME = getEnv("TTS_ALLTALK_MODEL_NAME");
const TTS_ALLTALK_LANGUAGE_NAME = getEnv("TTS_ALLTALK_LANGUAGE_NAME");

const TTS_ELEVENLABS_API_KEY = getEnv("TTS_ELEVENLABS_API_KEY");
const TTS_ELEVENLABS_VOICE_NAME = getEnv("TTS_ELEVENLABS_VOICE_NAME");
const TTS_ELEVENLABS_MODEL_NAME = getEnv("TTS_ELEVENLABS_MODEL_NAME");

const piperFolder = "piper";
const piperVoicesFolder = "voices";

/* tts */
let elevenlabs;

function cleanBeforeTTS(input) {
    let result = input.replace(/\*[^*]*\*/g, '');
    result = result.replace(/_[^_]*_/g, '');
    return result;
}

/* ai */
const groq = new Groq({apiKey: GROQ_API_KEY});

async function sendToAI(connectionManager, dialogues) {
    // key   : member
    // value : dialogue

    let payload = "";

    if (dialogues.length == 0) return;

    for (const [_, object] of Object.entries(dialogues)) {
        const { displayName, username, dialogue } = object;
        payload += `${displayName} (@${username}) says: ${dialogue}\n`;
    }
    
    if (payload == "") return "";

    connectionManager.addToConversation("user", payload);

    console.log(connectionManager.conversation);

    const response = await groq.chat.completions.create({
        messages: connectionManager.conversation,
        model: GROQ_MODEL_NAME,
        temperature: GROQ_TEMPERATURE,
        max_tokens: 120,
        top_p: GROQ_TOP_P,
        stop: null,
        stream: false
    });
    
    const completion = response.choices[0]?.message?.content?.trim()?.replace('\n', '');

    connectionManager.addToConversation("assistant", completion);

    return completion;
}

/* commands */
let commands = {};
function registerCommands() {
    console.log("Registering commands...");
    const commandsDir = path.resolve(__dirname, './commands');
    
    fs.readdirSync(commandsDir).forEach(file => {
        if (path.extname(file) !== '.js') return;

        console.log(`-> Registering command ${file}...`);
        const commandName = path.basename(file, '.js').toUpperCase();
        commands[commandName] = require(path.join(commandsDir, file));
    });
}
function processCommand(regex, response, callback, scheduledCallbacks) {
    let match = regex.exec(response.toUpperCase());

    if (match) {
        const fullMatch = match[0];
        const startIndex = response.toUpperCase().indexOf(fullMatch); 
        match.shift();

        match = match.map((value) => typeof value === 'string' ? value.replace(/^"|"$/g, '') : value);

        console.log("calling back with the following: ", match);
        scheduledCallbacks.push({ callback, match });

        response = response.replace(fullMatch, '').trim();
        response = response.slice(0, startIndex) + response.slice(startIndex + fullMatch.length).trim();

        console.log('RESPONSE:', response);
        return response;
    }

    return response;
}

function processCommands(response, scheduledCallbacks) {
    for (const [commandName, callback] of Object.entries(commands)) {
        const regexExp = new RegExp(`${commandName}\\s*\\((\"[^\"]*\"|'[^']*'|[^()]+)\\)`, "gi");
        response = processCommand(regexExp, response, callback, scheduledCallbacks);
    }

    return response; 
}

// todo queue/not play if something already playing
let sileroSessionPath = `${__dirname}\\silero`.replace(/\\/g, '/');
function setupTTS() {
    console.log("Setting up text to speech provider...");

    switch (TTS_PROVIDER) {
        case "ELEVENLABS": 
            elevenlabs = new ElevenLabsClient({apiKey: TTS_ELEVENLABS_API_KEY});
            break;
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
            .catch(error => { 
                console.error(error);

                console.log("Silero server not present or failed.");
                process.exit(-1);
            });

            setInterval(() => {
                // clear cache
                fs.readdir(sileroSessionPath, (_, files) => {
                    files.forEach(file => {
                        const filePath = path.join(sileroSessionPath, file);
                        fs.unlink(filePath, (__, ___) => {});
                    });
                });
            }, 90000);
            break;
        case "PIPER": break;
        case "XTTS": 
            const fail = (error = undefined, message = "AllTalk (XTTS) server not present or failed.") => {
                if (error) console.error(error);
                console.log(message);

                process.exit(-1);
            };

            fetch(`${TTS_ALLTALK_ADDRESS}/ready/`).then((response) => {
                if (response.status !== 200) {
                    fail();
                    return;
                }
                
                if (TTS_ALLTALK_MODEL_NAME == "null") return;

                console.log("Switching AllTalk model... (XTTS)");
                fetch(`${TTS_ALLTALK_ADDRESS}/api/reload?tts_method=${encodeURIComponent(TTS_ALLTALK_MODEL_NAME)}`, { method: "POST" }).then(async(response) => {
                    if (response.status === 200) return;

                    fail(undefined, `Switching AllTalk model error: ${await response.text()}`);
            }).catch((error) => fail(error));
            }).catch((error) => fail(error));
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
function callScheduledCallbacks(scheduledCallbacks) {
    scheduledCallbacks.forEach((callbackInformation) => {
        const { callback, match } = callbackInformation;
        callback(client, ...match);
    });
}

async function playTTS(connectionManager, text, scheduledCallbacks) {
    const passthrough = new PassThrough();
    const audioResource = createAudioResource(passthrough, { inputType: StreamType.Raw });
    let command;
    let ffmpeg;

    switch (TTS_PROVIDER) {
        case "ELEVENLABS":
            console.log(text);
            console.log("started talking");
            connectionManager.isSpeaking = true;

            const audio = await elevenlabs.generate({
                voice: TTS_ELEVENLABS_VOICE_NAME,
                text,
                model_id: TTS_ELEVENLABS_MODEL_NAME,
                stream: true,
            });

            command = 'ffmpeg -i pipe:0 -ac 2 -ar 48000 -acodec pcm_s16le -f s16le pipe:1 -loglevel quiet';
            
            ffmpeg = pipeFfmpeg(command, passthrough);
            audio.pipe(ffmpeg.stdin);

            //(await new ElevenLabsClient().generate({output_format: '', })).on('')

            ffmpeg.on('close', () => {
                console.log("ffmpeg death");
                callScheduledCallbacks(scheduledCallbacks);
            });
            console.log(audio.on)
            audio.on('close', () => {
                console.log("finish talking");
                /*ffmpeg.stdin.end();
                ffmpeg.kill();*/
                delete audio;
                
                connectionManager.isSpeaking = false;
            });
            break;
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

                ffmpeg = pipeFfmpeg(command, passthrough);
                ffmpeg.stdin.write(buffer);
                ffmpeg.stdin.end();
                ffmpeg.kill();
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
        case "XTTS":
            
            //http://localhost:7851/api/tts-generate-streaming?text=${encodedText}&voice=${voice}&language=${language}&output_file=${outputFile}
            const response = await fetch(`${TTS_ALLTALK_ADDRESS}/api/tts-generate-streaming?text=${encodeURIComponent(text)}&voice=${TTS_ALLTALK_VOICE_NAME}&language=${TTS_ALLTALK_LANGUAGE_NAME}&output_file=generated.wav`, {
                headers: { "content-type": "application/x-www-form-urlencoded" }
            });
            
            connectionManager.isSpeaking = true;
            if (!response.ok)
                throw new Error(`AllTalk HTTP error (${response.status}): ${await response.text()}`);

            // this resamples from the sample rate of the voice model to 48khz (opus) 16 bit pcm
            // then makes it stereo (or else it sounds sped up)
            command = `ffmpeg -f s16le -ar 22500 -ac 1 -i pipe:0 -ar 48000 -ac 2 -f s16le -filter:a "pan=stereo|c0=c0|c1=c0" pipe:1 -loglevel quiet`;
            ffmpeg = pipeFfmpeg(command, passthrough);

            const nodeReadableStream = Readable.fromWeb(response.body);
            nodeReadableStream.pipe(ffmpeg.stdin);

            ffmpeg.on('close', () => {
                ffmpeg.stdin.end();
                ffmpeg.kill();
                delete nodeReadableStream;

                connectionManager.isSpeaking = false;
                callScheduledCallbacks(scheduledCallbacks);
                console.log("stopped talking");
            });

            break;
    }

    connectionManager.player.play(audioResource);

}

/* discord bot */
class ConnectionManager {
    streams = {};
    channel = null;
    checkingInterval = null;
    player = null;
    conversation = [];
    isSpeaking = false;

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

    addToConversation(role, content) {
        this.conversation.push({ role, content });
    }
    clearConversation() {
        this.conversation = [];
    }
    pushSystemPrompt() {
        const prompt = fs.readFileSync(GROQ_PROMPT_PATH).toString("utf-8");
        this.conversation.push({ role: "system", content: prompt });
    }

    constructor(connection, channel) {
        this.channel = channel;
        this.speechTimer = 0.0;
        this.player = createAudioPlayer({behaviors: {noSubscriber: NoSubscriberBehavior.Play}});
        this.pushSystemPrompt();

        connection.subscribe(this.player);
    }

    dispose() {
        this.streams = {};
        this.channel = null;

        clearInterval(this.checkingInterval);
        this.checkingInterval = null;
    }
}

let connections = {
    // connection : {
    //      streams : {
    //          user : buffer
    //      }
    //      channel : channel
    //      checkingInterval : interval
    // }
}

/* vad */
const sampleRate = 48000;
const frameSize = 1024;
const minSilenceFrames = 5; // minimum frames of silence to consider the end of speech

function calculateEnergy(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i += 2) {
        const sample = frame.readInt16LE(i);
        sum += sample * sample;
    }
    return Math.sqrt(sum / (frame.length / 2));
}
function voiceActivityDetection(buffer) {
    let speechFrames = 0;
    let silenceFrames = 0;
    let speechDetected = false;
    let vadResults = [];

    for (let i = 0; i < buffer.length; i += frameSize) {
        const frame = buffer.slice(i, Math.min(i + frameSize, buffer.length));
        const energy = calculateEnergy(frame);

        if (energy > SPEAK_VOICE_THRESHOLD) {
            speechFrames++;
            silenceFrames = 0;
        } else silenceFrames++;

        if (speechFrames > 0) {
            if (!speechDetected) {
                speechDetected = true;
                vadResults.push({ start: i / sampleRate });
            }
        } else if (speechDetected && silenceFrames > minSilenceFrames) {
            speechDetected = false;
            vadResults[vadResults.length - 1].end = i / sampleRate;
        }
    }

    if (speechDetected)
        vadResults[vadResults.length - 1].end = buffer.length / sampleRate;

    return speechFrames > 5 && vadResults[0].start != undefined && vadResults[0].end != undefined;
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
        //if (connectionManager.isSpeaking) return;

        // decode opus packet
        const decodedData = encoder.decode(data);

        if (decodedData.length == 0) return;

        // stack into opus buffer
        connectionManager.pushToBuffer(memberId, decodedData);
        connectionManager.speechTimer = SPEAK_TIME_DURATION;

        // else clear buffer with [] since its memsafe
        delete data;
        delete decodedData;
    });
    opusStream.on('error', error => console.log(error));
    opusStream.on('end', _ => console.log("ended"));
}
function unsubscribeFromMember(connection, memberId) {
    connections[connection]?.removeMember(memberId);
}
function processBuffers(connectionManager) {
    if (!connectionManager.hasTalkedAtleastOnce) return;

    (async() => {
        const data = {...connectionManager.streams};
    
        // flush past buffers
        connectionManager.flushBuffers();

        let dialogues = {};

        for (const memberId in data) {
            const buffer = data[memberId];

            // process le buffer
            if (buffer == null || buffer.length == 0) continue;
    
            // detect energy
            const voiceDetected = voiceActivityDetection(buffer);
            if (!voiceDetected) continue;

            const filename = "./temp/" + (Math.random() * 999 - 1) + "_" + memberId + ".mp3";
            const command = "ffmpeg -f s16le -ar 16000 -ac 1 -i pipe:0 -b:a 128k -f mp3 pipe:1 -loglevel quiet";

            const outputStream = fs.createWriteStream(filename);
            const ffmpeg = pipeFfmpeg(command, outputStream);

            const bufferStream = new PassThrough();
            bufferStream.end(buffer);
            bufferStream.pipe(ffmpeg.stdin);

            await new Promise((resolve, reject) => {
                outputStream.on('finish', resolve);
                outputStream.on('error', reject);
            });
        
            const stream = fs.createReadStream(filename);
                
            const text = await groq.audio.transcriptions.create({
                file: stream,
                response_format: "text",
                model: "whisper-large-v3",
            });

            stream.close();
            outputStream.close();
            ffmpeg.kill();
            fs.unlinkSync(filename);

            const dialogue = text.trim();

            // ignore empty dialogue
            if (dialogue == "" || dialogue == "Thank you.") return;

            const channel = connectionManager.channel;
            const member = channel.members.get(memberId);

            if (member == null) return;

            dialogues[member] = {
                dialogue,
                username: member.user.username,
                displayName: member.displayName
            };
        }
        
        if (dialogues.length == 0) return;
        
        let response = await sendToAI(connectionManager, dialogues);
        if (response == "") return;

        let scheduledCallbacks = [];

        response = cleanBeforeTTS(response);
        response = processCommands(response, scheduledCallbacks);
        if (response.trim() == "") return;

        playTTS(connectionManager, response, scheduledCallbacks);
        
        await connectionManager.channel.send(`_${response}_`);
    })();
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
            if (connectionManager.speechTimer > 0.0) {
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
    if (DISCORD_BOT_ADMIN_ID != null && message.author.id != DISCORD_BOT_ADMIN_ID) return;

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

        const leaving = newState.channelId != botVoiceChannelId;

        console.log(oldState.channelId, newState.channelId, newState.member.id);

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

console.log("@(real)coloride - 2024");
console.log("======================");

registerCommands();
setupTTS();
initializeDiscordBot();