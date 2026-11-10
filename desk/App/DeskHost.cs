using System.Diagnostics;
using System.Net.Http;
using System.Windows;
using System.Windows.Threading;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

/// <summary>Wires Core (state, gate, toasts) to the window and the tray. Read-only: the one request is a GET.</summary>
internal sealed class DeskHost
{
    static readonly TimeSpan PollEvery = TimeSpan.FromSeconds(30);

    readonly TimeZoneInfo tz = TimeZoneInfo.Local;
    readonly DeskState state = new(() => DateTimeOffset.Now);
    readonly Gate gate = new(() => DateTimeOffset.Now);
    readonly HttpClient http = Poller.NewClient();
    readonly bool firstRun = !File.Exists(DeskFiles.State);
    DeskView view = null!;
    Widget widget = null!;
    Tray tray = null!;
    ConfigResult.Ok? cfg;
    View? prev;
    bool polling;
    Click? lastToast;

    public int Run()
    {
        Theme.EnsureLoaded();
        var saved = WinState.Load(DeskFiles.State);
        view = new DeskView(tz) { Open = OpenHref };
        widget = new Widget(view, saved);
        tray = new Tray(widget.AlwaysOnTop);

        widget.PointerOver += on => Update(gate.SetPointer(on));
        widget.FocusInside += on => Update(gate.SetFocus(on));
        widget.Touched += gate.Touch;
        widget.ContextMenuRequested += tray.ShowMenu;
        tray.MenuOpened += () => gate.SetMenu(true);
        tray.MenuClosed += () => Update(gate.SetMenu(false));
        tray.Summon += widget.Summon;
        tray.OpenHome += () => OpenHref("/");
        tray.Refresh += () => { LoadConfig(); _ = PollAsync(); Update(); };
        tray.StartupToggled += on => Autostart.Set(on);
        tray.OnTopToggled += on => widget.SetAlwaysOnTop(on);
        tray.ToastClicked += () => { if (lastToast is Click.OpenUrl o) OpenUrl(o.Url); else widget.Summon(); };
        tray.Quit += () => Application.Current.Shutdown();

        LoadConfig();
        Update();
        widget.Show();
        if (firstRun) widget.Save(); // state.json now exists, so the first-run toast fires once ever

        var tick = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        tick.Tick += (_, _) => Update(gate.Release());
        tick.Start();
        var poll = new DispatcherTimer { Interval = PollEvery };
        poll.Tick += (_, _) => _ = PollAsync();
        poll.Start();
        _ = PollAsync();

        Application.Current.Exit += (_, _) => tray.Dispose();
        return Application.Current.Run();
    }

    /// <summary>A second launch asks the running widget to show itself.</summary>
    public void Summon() => Application.Current?.Dispatcher.BeginInvoke((Action)(() => widget?.Summon()));

    void LoadConfig()
    {
        var r = DeskConfig.Load(DeskFiles.Config);
        state.SetConfig(r);
        cfg = r as ConfigResult.Ok;
    }

    async Task PollAsync()
    {
        if (polling || cfg is null) return;
        polling = true;
        Outcome o;
        try { o = await Poller.FetchAsync(http, cfg); }
        finally { polling = false; }
        var next = state.Apply(o);
        if (ToastDiff.Compute(prev, next, cfg.BaseUrl, tz, firstRun && prev is null) is { } toast)
        {
            lastToast = toast.Click;
            tray.Toast(toast);
        }
        prev = next;
        Update();
    }

    /// <summary>Offers the newest view to the gate and draws; the tray follows the newest view and moves nothing.</summary>
    void Update(bool committed = false)
    {
        var latest = state.Current;
        var changed = gate.Offer(latest);
        view.Render(new Model(gate.Committed!, gate.Latest!, gate.UpdateHeld), committed || changed);
        tray.Set(TrayState.Of(latest), Copy.Tooltip(latest, tz));
    }

    void OpenHref(string href) => OpenUrl((cfg?.BaseUrl ?? "") + (href.StartsWith('/') ? href : "/"));

    static void OpenUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps)) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception) { } // no default browser: nothing to do
    }
}
