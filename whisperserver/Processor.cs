﻿using System.Text;
using WebSocketSharp;
using WebSocketSharp.Server;
using Whisper.net;

namespace whisperserver
{
    public class Processor : WebSocketBehavior
    {
        private static byte[] GetBytesBetween(byte[] data, int offset, int count) => data[offset..(offset + count)];
        private static int ReadInt32(byte[] data, int offset) => BitConverter.ToInt32(data, offset);
        private static short ReadInt16(byte[] data, int offset) => BitConverter.ToInt16(data, offset);
        private static byte ReadInt8(byte[] data, int offset) => data[offset];

        // taskid : { userid, list of queued raw samples }
        public static readonly Dictionary<short, Dictionary<string, List<byte[]>>> BufferQueue = new();

        public static float[] Convert16BitPCMToFloat32(byte[] pcmData)
        {
            int sampleCount = pcmData.Length / 2;
            float[] floatData = new float[sampleCount];

            for (int i = 0; i < sampleCount; i++)
            {
                short pcmSample = BitConverter.ToInt16(pcmData, i * 2);
                floatData[i] = pcmSample / 32768.0f;
            }

            return floatData;
        }

        protected override void OnMessage(MessageEventArgs e)
        {
            byte[] data = e.RawData;

            int secret = ReadInt32(data, 0);
            if (secret != Server.WEBSOCKET_SECRET) return;

            short taskId = ReadInt16(data, 4);
            short userCount = ReadInt16(data, 6);

            int offset = 4 + 2 + 2;

            if (!BufferQueue.ContainsKey(taskId))
                BufferQueue.Add(taskId, new());

            for (int i = 0; i < userCount; i++)
            {
                // user id length
                byte userIdLength = ReadInt8(data, offset);
                offset++;

                // user id
                string userId = Encoding.UTF8.GetString(data, offset, userIdLength);
                offset += userIdLength;

                // read voice buffer length
                int voiceBufferLength = ReadInt32(data, offset);
                offset += 4;

                // read voice data
                byte[] voiceBuffer = GetBytesBetween(data, offset, voiceBufferLength);
                offset += voiceBufferLength;

                if (!BufferQueue[taskId].ContainsKey(userId))
                    BufferQueue[taskId].Add(userId, new());

                BufferQueue[taskId][userId].Add(voiceBuffer);
            }

            //Send("test");
        }
    }
}
