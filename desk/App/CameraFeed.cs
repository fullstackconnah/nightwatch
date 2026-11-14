using System.Windows.Media;
using System.Windows.Media.Imaging;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

/// <summary>
/// Holds the latest door-camera frame and decides when to fetch. The fetch, clock and DPI are injected so the pause rules can be tested.
/// Bytes live only in memory: nothing is written to disk and nothing is logged.
/// </summary>
internal sealed class CameraFeed
{
    readonly Func<CancellationToken, Task<FrameOutcome>> fetch;
    readonly Func<DateTimeOffset> clock;
    readonly Func<double> dpiScale;
    bool windowHidden, blockHidden = true, clientError, locked, suspended, fetching, everFailed;

    public CameraFeed(Func<CancellationToken, Task<FrameOutcome>> fetch, Func<DateTimeOffset> clock, Func<double> dpiScale)
    {
        this.fetch = fetch;
        this.clock = clock;
        this.dpiScale = dpiScale;
    }

    public int IntervalSeconds { get; set; } = DeskConfig.DefaultCameraInterval;
    public ImageSource? Image { get; private set; }
    public DateTimeOffset? FrameAt { get; private set; }
    /// <summary>Raised on the UI thread when a fetch result landed.</summary>
    public event Action? Changed;

    public bool WindowHidden { set => Set(ref windowHidden, value); }
    /// <summary>The block is collapsed, folded or hidden.</summary>
    public bool BlockHidden { set => Set(ref blockHidden, value); }
    public bool ClientError { set => Set(ref clientError, value); }
    public bool Locked { set => Set(ref locked, value); }
    public bool Suspended { set => Set(ref suspended, value); }

    public bool Active => FrameGate.ShouldFetch(windowHidden, blockHidden, clientError, locked, suspended);

    /// <summary>Watch live is on: one fetch a second (<see cref="LiveTickAsync"/>) and the 5 s / 60 s frame ages. Never saved, never restarted by a resume.</summary>
    public bool Live { get; private set; }

    /// <summary>The state now. Pure: the stale bitmap is dropped by DropStale on a tick, a result and a pause.</summary>
    public FrameState State => Live
        ? FrameClock.ComputeLive(clock(), FrameAt, everFailed)
        : FrameClock.Compute(clock(), FrameAt, IntervalSeconds, fetching, everFailed);

    /// <summary>At No picture the kept bitmap is dropped from memory; the time of the last frame stays for the line under it.</summary>
    void DropStale() { if (State == FrameState.NoPicture) Image = null; }

    /// <summary>
    /// Any pause (window hidden, block collapsed or folded or hidden, client error, session locked, PC suspended) ends Live for good:
    /// a resume goes back to the still and never to Live.
    /// </summary>
    void Set(ref bool field, bool value)
    {
        var liveEnded = value && Live; // also when the pause was already in force: Live started on a closed block, then the fold said hidden
        if (liveEnded) Live = false;
        if (field != value)
        {
            var was = Active;
            field = value;
            if (!Active) DropStale(); // a hidden block never ticks, so free the frame as it pauses
            if (!was && Active) _ = ResumeAsync();
        }
        if (liveEnded) Changed?.Invoke();
    }

    /// <summary>
    /// Enter Live. The still's frame is dropped so the block says "Waking the camera…" until the first Live frame lands (it is a fresh picture,
    /// not one aged under another rule). Fetches at once when the block is showing; otherwise the resume that shows it does.
    /// </summary>
    public void StartLive()
    {
        if (Live) return;
        Live = true;
        Image = null; FrameAt = null; everFailed = false;
        if (Active) _ = TickAsync();
    }

    /// <summary>The live button was pressed again: back to the still. The frame stays and ages under the still's rules.</summary>
    public void EndLive()
    {
        if (!Live) return;
        Live = false;
        Changed?.Invoke();
    }

    /// <summary>The 1 s UI tick calls this; it fetches only while Live, and never while a fetch is running (<see cref="TickAsync"/>).</summary>
    public Task LiveTickAsync() => Live ? TickAsync() : Task.CompletedTask;

    /// <summary>One fetch at once on every resume. A kept frame at or past the No-picture threshold is dropped first, never shown hours old.</summary>
    async Task ResumeAsync()
    {
        if (FrameAt is { } t && FrameClock.DropOnResume(clock(), t, IntervalSeconds)) { Image = null; FrameAt = null; everFailed = false; }
        await TickAsync().ConfigureAwait(true);
    }

    /// <summary>The interval timer calls this; it does nothing while paused or while a fetch is still running.</summary>
    public async Task TickAsync()
    {
        DropStale();
        if (!Active || fetching) return;
        fetching = true;
        FrameOutcome o;
        try { o = await fetch(CancellationToken.None).ConfigureAwait(true); }
        finally { fetching = false; }
        if (o is FrameOutcome.Frame f && Decode(f.Bytes, dpiScale(), Live) is { } img)
        {
            Image = img; FrameAt = clock(); everFailed = false;
        }
        else if (FrameAt is null) everFailed = true; // a failure keeps the last frame; with none, the block says so
        DropStale();
        Changed?.Invoke();
    }

    /// <summary>MemoryStream, decoded at the frame's pixel width, loaded now and frozen. Null when the bytes are not a picture.</summary>
    public static ImageSource? Decode(byte[] bytes, double scale, bool live = false)
    {
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.DecodePixelWidth = (int)Math.Round(Theme.D(live ? "frame-live-w" : "frame-w") * scale);
            bmp.StreamSource = new MemoryStream(bytes);
            bmp.EndInit();
            bmp.Freeze();
            return bmp;
        }
        catch (Exception e) when (e is NotSupportedException or InvalidOperationException or FileFormatException or ArgumentException or IOException)
        {
            return null;
        }
    }
}
