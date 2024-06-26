﻿using Whisper.net;
using Whisper.net.Ggml;
using Whisper.net.Logger;

namespace whisperserver
{
    public static class WhisperHelper
    {
        public static WhisperProcessor WhisperProcessor;

        public static async Task<List<SegmentData>> ProcessBuffer(float[] samples)
        {
            List<SegmentData> segments = new();

            await foreach (var result in WhisperProcessor.ProcessAsync(samples))
            {
                //Console.WriteLine($"{result.Start}->{result.End}: {result.Text}");
            }
            Console.WriteLine("nextup");

            return segments;
        }
        public static async Task Start()
        {
            Console.WriteLine("loading model");

            // load model
            GgmlType ggmlType = GgmlType.Base;
            string modelName = "ggml-base.bin";

            if (!File.Exists(modelName))
            {
                Console.WriteLine("not found, downloading");
                using var modelStream = await WhisperGgmlDownloader.GetGgmlModelAsync(ggmlType);
                using var fileWriter = File.OpenWrite(modelName);
                await modelStream.CopyToAsync(fileWriter);
            }

            LogProvider.Instance.OnLog += (level, message) =>
            {
                Console.Write($"{level}: {message}");
            };

            using var whisperFactory = WhisperFactory.FromPath("ggml-base.bin");

            WhisperProcessor = whisperFactory.CreateBuilder()
                .WithLanguage("auto")
                .Build();

            Console.WriteLine("done loading model");
            
            /* test sample
            
            using var fileStream = File.OpenRead("../../../../temp/bush.wav");
            await foreach (var result in WhisperProcessor.ProcessAsync(fileStream))
            {
                Console.WriteLine($"{result.Start}->{result.End}: {result.Text}");
            }*/
        }
    }
}
