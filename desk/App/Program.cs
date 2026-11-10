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
        var waiter = new Thread(() => { while (show.WaitOne()) host.Summon(); }) { IsBackground = true };
        waiter.Start();
        return host.Run();
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
            View.Live l => $"Live tone={l.Glance.Tone} lanes={l.Glance.Lanes.Length} items={l.Glance.Items.Length}",
            View.WrongToken => "WrongToken " + Copy.Head(v),
            View.DeskOff => "DeskOff " + Copy.Head(v),
            View.ServerTooNew t => $"ServerTooNew v={t.V}",
            _ => "NoAnswer " + Copy.Head(v), // one failed poll is still FirstLaunch in the state machine
        });
        return v is View.Live ? 0 : 1;
    }
}
