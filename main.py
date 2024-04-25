# @(real)coloride - 2024
import asyncio
import websockets
import dotenv
import os
import struct
import numpy as np
import whisper
import torch
from faster_whisper import WhisperModel
import json
import time
from whispercpp import Whisper

dotenv.load_dotenv()

WEBSOCKET_ADDRESS = os.getenv('WEBSOCKET_ADDRESS')
WEBSOCKET_PORT = os.getenv('WEBSOCKET_PORT')
WEBSOCKET_SECRET = os.getenv('WEBSOCKET_SECRET')

enable_vad = True
audio_model = None # loaded below

data_queue = []

def send_data(data):
    data_queue.append(data)

def process_buffer(voice_buffer):
    #print(user_id).
    start_time = time.time()

    audio_np = np.frombuffer(voice_buffer, dtype=np.int16).astype(np.float32) / 32768.0

    #audio_file_check_path = f"./temp/{user_id}_speech.pcm"
    #with open(audio_file_check_path, "wb") as f:
    #    f.write(audio_np)

    #result = audio_model.transcribe(audio_np, beam_size=4, language="en")
    segments, info = audio_model.transcribe(audio_np, beam_size=4, language="en", vad_filter=True)
    
    #segments = audio_model.transcribe(audio_np, beam_size=5)
    dialogue = ""

    for segment in segments: dialogue += segment.text
    #for segment in segments: dialogue += segment

    print(dialogue)

    end_time = time.time()
    transcribe_time = (end_time - start_time) 

    print(f"transcribed in {transcribe_time} seconds")

    return dialogue

def process_message(data_bytes):
    secret = struct.unpack('>i', data_bytes[:4])[0] # 32
    #print(secret," <- secret    user_count -> " , user_count)
    
    # check secret
    if secret != WEBSOCKET_SECRET: return

    task_id = struct.unpack('>H', data_bytes[4:6])[0] # 16
    user_count = struct.unpack('>H', data_bytes[6:8])[0] # 16
    
    offset = 4 + 2 + 2

    results = {}
    
    for _ in range(user_count):
        # user id length
        user_id_length = struct.unpack('B', data_bytes[offset:offset + 1])[0]
        offset += 1

        #print(f"user_id_length: {user_id_length}")
        
        # user id
        user_id = data_bytes[offset:offset + user_id_length].decode('utf-8')
        offset += user_id_length

        # print(f"user_id: {user_id}")
        
        # read voice buffer length
        voice_buffer_length = struct.unpack('>I', data_bytes[offset:offset + 4])[0]
        offset += 4

        #print(f"voice_buffer_length: {voice_buffer_length}")
        
        # Read the data
        voice_buffer = data_bytes[offset:offset + voice_buffer_length]
        offset += voice_buffer_length

        results[user_id] = process_buffer(voice_buffer)
        
    send_data(json.dumps({
        "taskId": task_id,
        "results": results
    }))
    
# create handler for each connection
async def handler(websocket, _):
    print("webserver ready, listening...")
    while True:
        in_data = await websocket.recv()

        process_message(in_data)

        for out_data in data_queue:
            await websocket.send(out_data)

print(f"Hosting at {WEBSOCKET_ADDRESS}:{WEBSOCKET_PORT}")
print("@realcoloride - 2024")
print("====================")

try:
    WEBSOCKET_SECRET = int(WEBSOCKET_SECRET)
except ValueError:
    print("[error] websocket secret should be a number.")
    exit()

if not (isinstance(WEBSOCKET_SECRET, int) and 0 <= WEBSOCKET_SECRET < 2147483647):
    print("[error] websocket secret should be a number and be below 2147483647 and higher than or equal to 0.")
    exit()


print("loading speech to text model...")

audio_model = WhisperModel("distil-small.en", device="cuda", compute_type="float32")
#audio_model = whisper.load_model("medium", device="cuda")
#audio_model = Whisper('small')

print("model loaded!")

start_server = websockets.serve(handler, WEBSOCKET_ADDRESS, WEBSOCKET_PORT)

print("websocket server started.")

asyncio.get_event_loop().run_until_complete(start_server)
asyncio.get_event_loop().run_forever()