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

    /// <summary>The state now. At No picture the kept bitmap is dropped from memory; the time of the last frame stays for the line under it.</summary>
    public FrameState State
    {
        get
        {
            var s = FrameClock.Compute(clock(), FrameAt, IntervalSeconds, fetching, everFailed);
            if (s == FrameState.NoPicture) Image = null;
            return s;
        }
    }

    void Set(ref bool field, bool value)
    {
        if (field == value) return;
        var was = Active;
        field = value;
        if (!was && Active) _ = ResumeAsync();
    }

    /// <summary>One fetch at once on every resume. A kept frame at or past the No-picture threshold is dropped first, never shown hours old.</summary>
    async Task ResumeAsync()
    {
        if (FrameAt is { } t && FrameClock.DropOnResume(clock(), t, IntervalSeconds)) { Image = null; FrameAt = null; everFailed = false; }
        await TickAsync().ConfigureAwait(true);
    }

    /// <summary>The interval timer calls this; it does nothing while paused or while a fetch is still running.</summary>
    public async Task TickAsync()
    {
        if (!Active || fetching) return;
        fetching = true;
        FrameOutcome o;
        try { o = await fetch(CancellationToken.None).ConfigureAwait(true); }
        finally { fetching = false; }
        if (o is FrameOutcome.Frame f && Decode(f.Bytes, dpiScale()) is { } img)
        {
            Image = img; FrameAt = clock(); everFailed = false;
        }
        else if (FrameAt is null) everFailed = true; // a failure keeps the last frame; with none, the block says so
        Changed?.Invoke();
    }

    /// <summary>MemoryStream, decoded at the frame's pixel width, loaded now and frozen. Null when the bytes are not a picture.</summary>
    public static ImageSource? Decode(byte[] bytes, double scale)
    {
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.DecodePixelWidth = (int)Math.Round(Theme.D("frame-w") * scale);
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
