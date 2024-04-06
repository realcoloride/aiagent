using whisperserver;

using FileStream stream = File.OpenRead("../../../../.env");
DotNetEnv.Env.Load(stream);

await WhisperHelper.Start();
Server.Start();