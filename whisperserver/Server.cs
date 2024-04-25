using NAudio.Wave;
using System.IO;
using System.Net;
using WebSocketSharp.Server;

namespace whisperserver
{
    public static class Server
    {
        public static readonly string WEBSOCKET_ADDRESS = DotNetEnv.Env.GetString("WEBSOCKET_ADDRESS");
        public static readonly int WEBSOCKET_PORT = DotNetEnv.Env.GetInt("WEBSOCKET_PORT");
        public static readonly int WEBSOCKET_SECRET = DotNetEnv.Env.GetInt("WEBSOCKET_SECRET");

        private static readonly WebSocketServer WebSocketServer = new(IPAddress.Parse(WEBSOCKET_ADDRESS), WEBSOCKET_PORT);

        public static float[] Convert16BitToFloat(byte[] input)
        {
            // 16 bit input, so 2 bytes per sample
            int inputSamples = input.Length / 2;
            float[] output = new float[inputSamples];
            int outputIndex = 0;
            for (int n = 0; n < inputSamples; n++)
            {
                short sample = BitConverter.ToInt16(input, n * 2);
                output[outputIndex++] = sample / 32768f;
            }
            return output;
        }

        public static void Start()
        {
            WebSocketServer.AddWebSocketService<Processor>("/");
            WebSocketServer.Start();

            // test
            byte[] pcmData = File.ReadAllBytes("../../../../test.wav");

            var stream = new MemoryStream(pcmData);
            using var fileStream = File.OpenRead("../../../../test.wav");


            //var stream = new RawSourceWaveStream(pcmData, 0, pcmData.Length, new WaveFormat(8000, 1));

            WhisperHelper.WhisperProcessor.Process(stream);
            Console.ReadKey();
        }
    }
}
