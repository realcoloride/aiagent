using System.Net;
using System.Text;
using WebSocketSharp;
using WebSocketSharp.Server;
using Whisper.net;

namespace whisperserver
{
    public static class Server
    {
        public static readonly string WEBSOCKET_ADDRESS = DotNetEnv.Env.GetString("WEBSOCKET_ADDRESS");
        public static readonly int WEBSOCKET_PORT = DotNetEnv.Env.GetInt("WEBSOCKET_PORT");
        public static readonly int WEBSOCKET_SECRET = DotNetEnv.Env.GetInt("WEBSOCKET_SECRET");

        private static readonly WebSocketServer WebSocketServer = new(IPAddress.Parse(WEBSOCKET_ADDRESS), WEBSOCKET_PORT);

        public static void Start()
        {
            WebSocketServer.AddWebSocketService<Processor>("/");
            WebSocketServer.Start();

            while (true)
            {
                if (Processor.BufferQueue.Count == 0) continue;


                Thread.Sleep(10);
            }
        }
    }
}
