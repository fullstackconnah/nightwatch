using System.Diagnostics;
using System.Net.Http;
using System.Windows;
using Microsoft.Win32;
using System.Windows.Threading;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

/// <summary>Wires Core (state, gate, toasts) to the window and the tray. Read-only: the one request is a GET.</summary>
internal sealed class DeskHost
{
    static readonly TimeSpan PollEvery = TimeSpan.FromSeconds(30);
    internal static readonly TimeSpan DoorEvery = TimeSpan.FromSeconds(5), DoorBackoff = TimeSpan.FromSeconds(10);

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
    DoorState door = new();
    DispatcherTimer doorTimer = null!;
    bool doorPolling;

    // The camera and the weather (SHAPE 2, 3). The *Vis objects are fed once per poll outcome; what shows changes only at a gate commit.
    readonly WeatherVisibility weatherVis = new();
    readonly CameraVisibility camVis = new();
    CameraFeed feed = null!;
    DispatcherTimer camTimer = null!;
    WeatherNow? lastWeather;
    bool shownWeather, shownCam, collapsed;
    double workHeight = double.PositiveInfinity;

    public int Run()
    {
        Theme.EnsureLoaded();
        var saved = WinState.Load(DeskFiles.State);
        view = new DeskView(tz) { Open = OpenHref };
        widget = new Widget(view, saved);
        tray = new Tray(widget.AlwaysOnTop);

        collapsed = widget.CameraCollapsed;
        feed = new CameraFeed(
            ct => cfg is { } c ? CameraFrame.FetchAsync(http, c.BaseUrl, c.Token, ct) : Task.FromResult<FrameOutcome>(new FrameOutcome.Failure()),
            () => DateTimeOffset.Now, () => widget.DpiScale);
        feed.Changed += () => Update();
        view.CameraToggled = () => { collapsed = !collapsed; widget.SetCameraCollapsed(collapsed); Update(); };
        widget.VisibilityChanged += () => feed.WindowHidden = widget.IsHiddenOrMinimised;
        widget.DisplayChanged += () => { workHeight = widget.WorkHeight(); Update(); };
        SystemEvents.SessionSwitch += OnSession;
        SystemEvents.PowerModeChanged += OnPower;

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
        camTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(feed.IntervalSeconds) };
        camTimer.Tick += (_, _) => _ = feed.TickAsync();
        camTimer.Start();
        doorTimer = new DispatcherTimer { Interval = DoorEvery };
        doorTimer.Tick += (_, _) => _ = DoorAsync();
        doorTimer.Start();
        _ = PollAsync();

        Application.Current.DispatcherUnhandledException += (_, e) => e.Handled = true; // a stray UI exception must not end the widget; nothing is logged, so no token can leak
        Application.Current.Exit += (_, _) =>
        {
            SystemEvents.SessionSwitch -= OnSession;
            SystemEvents.PowerModeChanged -= OnPower;
            tray.Dispose();
        };
        return Application.Current.Run();
    }

    /// <summary>A second launch asks the running widget to show itself.</summary>
    public void Summon() => Application.Current?.Dispatcher.BeginInvoke((Action)(() => widget?.Summon()));

    void LoadConfig()
    {
        var r = DeskConfig.Load(DeskFiles.Config);
        state.SetConfig(r);
        cfg = r as ConfigResult.Ok;
        if (cfg is not null && feed is not null)
        {
            feed.IntervalSeconds = cfg.CameraIntervalSeconds;
            if (camTimer is not null) camTimer.Interval = TimeSpan.FromSeconds(cfg.CameraIntervalSeconds);
        }
    }

    async Task PollAsync()
    {
        if (polling || cfg is null) return;
        polling = true;
        var c = cfg; // a Refresh during the await may swap cfg
        Outcome o;
        try { o = await Poller.FetchAsync(http, c); }
        finally { polling = false; }
        var next = state.Apply(o);
        weatherVis.OnPoll(o);
        camVis.OnPoll(o);
        if (o is Outcome.Ok { Glance.Weather: { } w }) lastWeather = w;
        if (ToastDiff.Compute(prev, next, c.BaseUrl, tz, firstRun && prev is null) is { } toast)
        {
            lastToast = toast.Click;
            tray.Toast(toast);
        }
        prev = next;
        Update();
    }

    /// <summary>The door toast (SHAPE: same rule as the kiosk). Polls only while a camera is configured and doorToasts is on; a failed poll is silent and backs off.</summary>
    async Task DoorAsync()
    {
        if (doorPolling || cfg is not { DoorToasts: true } c || !camVis.Visible) return;
        doorPolling = true;
        DoorSnapshot? snap;
        try { snap = await Poller.FetchDoorAsync(http, c.BaseUrl); }
        finally { doorPolling = false; }
        doorTimer.Interval = snap is null ? DoorBackoff : DoorEvery;
        if (snap is null) return;
        var (next, toast) = DoorRing.Next(door, snap, TimeSpan.FromTicks(DateTime.UtcNow.Ticks), c.BaseUrl);
        door = next;
        if (toast is null) return;
        lastToast = toast.Click; // a click routes by this, so the door toast opens the kiosk
        tray.Toast(toast);
    }

    /// <summary>Offers the newest view to the gate and draws; the tray follows the newest view and moves nothing.</summary>
    void Update(bool committed = false)
    {
        var latest = state.Current;
        var changed = gate.Offer(latest);
        var err = latest is View.Config or View.WrongToken or View.DeskOff or View.ServerTooNew;
        if (!gate.Held) // showing or hiding either block changes the height, so it waits for a commit
        {
            shownWeather = weatherVis.Visible && !err;
            shownCam = camVis.Visible && !err;
            if (shownCam && !collapsed) workHeight = widget.WorkHeight();
        }
        var dim = latest is View.Stale or View.Offline;
        var strip = shownWeather && lastWeather is { } w ? new Strip(w, dim || weatherVis.Dim) : null;
        var cam = shownCam ? new Cam(collapsed, workHeight, feed.State, feed.Image, feed.FrameAt) : null;
        view.Render(new Model(gate.Committed!, gate.Latest!, gate.UpdateHeld, Weather: strip, Camera: cam), committed || changed);
        feed.ClientError = err;
        feed.BlockHidden = !shownCam || collapsed || view.CameraFolded;
        tray.Set(TrayState.Of(latest), Copy.Tooltip(latest, tz));
    }

    void OnSession(object? s, SessionSwitchEventArgs e)
    {
        if (e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.SessionUnlock)
            Application.Current?.Dispatcher.BeginInvoke((Action)(() => feed.Locked = e.Reason == SessionSwitchReason.SessionLock));
    }

    void OnPower(object? s, PowerModeChangedEventArgs e)
    {
        if (e.Mode is PowerModes.Suspend or PowerModes.Resume)
            Application.Current?.Dispatcher.BeginInvoke((Action)(() => feed.Suspended = e.Mode == PowerModes.Suspend));
    }

    void OpenHref(string href) => OpenUrl((cfg?.BaseUrl ?? "") + (href.StartsWith('/') ? href : "/"));

    static void OpenUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps)) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception) { } // no default browser: nothing to do
    }
}
