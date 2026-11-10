using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

/// <summary>One STA dispatcher thread for the whole run: WPF allows one Application and it must stay on the thread that made it.</summary>
internal static class Sta
{
    static readonly Dispatcher dispatcher;

    static Sta()
    {
        Dispatcher? d = null;
        var ready = new ManualResetEventSlim();
        var t = new Thread(() => { d = Dispatcher.CurrentDispatcher; ready.Set(); Dispatcher.Run(); }) { IsBackground = true };
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        ready.Wait();
        dispatcher = d!;
    }

    public static T Run<T>(Func<T> f) => dispatcher.Invoke(f);
    public static void Run(Action a) => dispatcher.Invoke(a);
}

internal static class Fix
{
    // desk/App/snapshots/fixtures, copied next to the test dll through the App project.
    public static Glance Load(string name)
    {
        var p = Path.Combine(AppContext.BaseDirectory, "snapshots", "fixtures", name + ".json");
        return ((Outcome.Ok)GlanceParser.Parse(File.ReadAllText(p))).Glance;
    }

    /// <summary>The fixture each of the 20 states renders from (see snapshots.ps1, which uses the same table).</summary>
    public static string For(string state) => state switch
    {
        "healthy" or "first-launch" => "healthy",
        "pending" => "pending",
        "one-lane" => "one-lane",
        "overflow" => "overflow",
        "long-copy" => "long-copy",
        "vitals-null" => "vitals-null",
        _ => "lanes-and-items",
    };

    public static Snapshot.Composed Compose(string state, double dpi = 96) =>
        Snapshot.Compose(Snapshot.ModelFor(state, Load(For(state))), dpi);

    public static IEnumerable<T> Walk<T>(DependencyObject root) where T : DependencyObject
    {
        if (root is T t) yield return t;
        var n = root is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetChildrenCount(root) : 0;
        for (var i = 0; i < n; i++)
            foreach (var c in Walk<T>(VisualTreeHelper.GetChild(root, i))) yield return c;
    }

    static readonly object gate = new();
    /// <summary>Every measured value lands in measured.txt next to the test dll, for the build report.</summary>
    public static void Rec(string n, string value)
    {
        lock (gate) File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "measured.txt"), $"{n} {value}{Environment.NewLine}");
    }
}
