using System.Net.Http;
using System.Windows;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

internal static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] is "--snapshot" or "--check") Console();
        if (args.Length > 0 && args[0] == "--snapshot") return Snapshot.Cli(args);
        if (args.Length > 0 && args[0] == "--check") return Check();

        using var mutex = new Mutex(true, @"Local\NightwatchDesk.Single", out var first);
        using var show = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\NightwatchDesk.Show");
        if (!first)
        {
            show.Set(); // the running widget shows itself; this launch ends
            return 0;
        }
        var host = new DeskHost();
        var waiter = new Thread(() => { try { while (show.WaitOne()) host.Summon(); } catch (ObjectDisposedException) { } }) { IsBackground = true };
        waiter.Start();
        return host.Run();
    }

    // Status, type and size only: the token and the picture's bytes are never printed.
    static string FrameLine(HttpClient http, ConfigResult.Ok ok, bool camera)
    {
        if (!camera) return "none";
        return CameraFrame.FetchAsync(http, ok.BaseUrl, ok.Token).GetAwaiter().GetResult() switch
        {
            FrameOutcome.Frame f => $"200 {(f.Bytes.Length > 1 && f.Bytes[0] == 0xFF && f.Bytes[1] == 0xD8 ? "image/jpeg" : "image/png")} {f.Bytes.Length}B",
            _ => "failed",
        };
    }

    static string WeatherKeys(WeatherNow? w)
    {
        if (w is null) return "none";
        var keys = new[] { w.TempC is null ? null : "tempC", w.FeelsC is null ? null : "feelsC", w.Label is null ? null : "label", w.HighC is null ? null : "highC", w.LowC is null ? null : "lowC", w.RainPct is null ? null : "rainPct", w.Icon is null ? null : "icon" };
        return string.Join(",", keys.Where(k => k is not null));
    }

    // A WinExe has no console; attach to the parent's so --check and --snapshot can print.
    static void Console()
    {
        Native.AttachConsole(-1);
        System.Console.SetOut(new StreamWriter(System.Console.OpenStandardOutput()) { AutoFlush = true });
    }

    /// <summary>One poll, one line, no token. The lead runs this after install.</summary>
    static int Check()
    {
        var r = DeskConfig.Load(DeskFiles.Config);
        if (r is not ConfigResult.Ok ok)
        {
            System.Console.WriteLine("Config " + Copy.Head(new View.Config(r)));
            return 1;
        }
        using var http = Poller.NewClient();
        var state = new DeskState(() => DateTimeOffset.Now);
        var v = state.Apply(Poller.FetchAsync(http, ok).GetAwaiter().GetResult());
        System.Console.WriteLine(v switch
        {
            View.Live l => $"Live tone={l.Glance.Tone} lanes={l.Glance.Lanes.Length} items={l.Glance.Items.Length} camera={(l.Glance.Camera ? "true" : "false")} frame={FrameLine(http, ok, l.Glance.Camera)} weather={WeatherKeys(l.Glance.Weather)}",
            View.WrongToken => "WrongToken " + Copy.Head(v),
            View.DeskOff => "DeskOff " + Copy.Head(v),
            View.ServerTooNew t => $"ServerTooNew v={t.V}",
            _ => "NoAnswer " + Copy.Head(v), // one failed poll is still FirstLaunch in the state machine
        });
        return v is View.Live ? 0 : 1;
    }
}
