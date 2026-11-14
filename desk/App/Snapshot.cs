using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

/// <summary>Offscreen renders for the finish review (PLAN-AMEND 2): no window is ever shown, no browser is involved.</summary>
internal static class Snapshot
{
    public const double Backdrop = 12; // DIP of flat test backdrop around the panel, so the corners and border read
    public static readonly Color BackdropColor = Color.FromRgb(0x3a, 0x3a, 0x3a);
    static readonly DateTimeOffset At = new(2026, 1, 1, 14, 5, 0, TimeSpan.Zero); // fixtures are 14:05 UTC and render in UTC

    public static readonly string[] States =
    {
        "healthy", "first-launch", "pending", "one-lane", "lanes-and-items", "overflow", "long-copy", "vitals-null", "stale",
        "offline-with-last-known", "offline-never-answered", "config-missing", "config-invalid-json", "token-missing",
        "wrong-token-401", "desk-off-503", "server-too-new", "hover-row-1", "focus-row-1", "update-held",
        "weather-on", "weather-long", "weather-null", "weather-dim", "camera-loading", "camera-live", "camera-letterbox", "camera-stale",
        "camera-no-picture", "offline-last-frame", "camera-collapsed", "camera-folded", "camera-hidden", "camera-hover-frame", "camera-focus-header",
        "camera-watch-waking", "camera-watch-on", "camera-watch-stale", "camera-watch-no-picture", "camera-watch-letterbox", "camera-watch-folded", "camera-watch-focus",
    };

    const int CameraInterval = 30; // the default I; frame ages below are multiples of it
    public const double FoldedWorkHeight = 464; // 768 px at 150%: 512 DIP less the 48 DIP taskbar

    /// <summary>A generated test picture (never a real camera frame): a greyscale diagonal gradient, a grid every 1/8 of the width and the aspect in white. JPEG, in memory.</summary>
    public static byte[] TestFrame(int w, int h, string label)
    {
        var v = new DrawingVisual();
        using (var dc = v.RenderOpen())
        {
            dc.DrawRectangle(new LinearGradientBrush(Color.FromRgb(0x20, 0x20, 0x20), Color.FromRgb(0xb0, 0xb0, 0xb0), new Point(0, 0), new Point(1, 1)), null, new Rect(0, 0, w, h));
            var grid = new Pen(new SolidColorBrush(Color.FromArgb(0x60, 0xff, 0xff, 0xff)), 1);
            for (var x = 0; x <= w; x += w / 8) dc.DrawLine(grid, new Point(x, 0), new Point(x, h));
            for (var y = 0; y <= h; y += w / 8) dc.DrawLine(grid, new Point(0, y), new Point(w, y));
            var t = new FormattedText(label, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, new Typeface("Segoe UI"), h / 4.0, Brushes.White, 1.0);
            dc.DrawText(t, new Point((w - t.Width) / 2, (h - t.Height) / 2));
        }
        var rtb = new RenderTargetBitmap(w, h, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(v);
        var enc = new JpegBitmapEncoder { QualityLevel = 85 };
        enc.Frames.Add(BitmapFrame.Create(rtb));
        using var ms = new MemoryStream();
        enc.Save(ms);
        return ms.ToArray();
    }

    static Cam FrameCam(string state, double dpi)
    {
        Theme.EnsureLoaded(); // the CLI builds the model before it composes
        // Watch live states: Live on with a frame 2 s, 20 s or 61 s old (fresh, stale, no picture); camera-watch-folded is a still that a fold left behind (Live ended).
        var live = state.StartsWith("camera-watch-") && state != "camera-watch-folded";
        var aspect43 = state is "camera-letterbox" or "camera-watch-letterbox";
        var age = state switch
        {
            "camera-stale" or "offline-last-frame" => 2 * CameraInterval + 5,
            "camera-no-picture" => 301,
            "camera-watch-on" or "camera-watch-letterbox" or "camera-watch-focus" => 2,
            "camera-watch-stale" => 20,
            "camera-watch-no-picture" => 61,
            _ => 10, // Snap.FrameAge
        };
        var at = At.AddSeconds(-age);
        var s = live ? FrameClock.ComputeLive(At, at, false) : FrameClock.Compute(At, at, CameraInterval, false, false);
        var img = s == FrameState.NoPicture ? null : CameraFeed.Decode(aspect43 ? TestFrame(480, 360, "4:3") : TestFrame(640, 360, "16:9"), dpi / 96, live);
        return new Cam(state == "camera-collapsed", state is "camera-folded" or "camera-watch-folded" ? FoldedWorkHeight : double.PositiveInfinity, s, img, at,
            HoverFrame: state == "camera-hover-frame", FocusHeader: state == "camera-focus-header", Live: live, FocusLive: state == "camera-watch-focus");
    }

    public static Model ModelFor(string state, Glance g, double dpi = 96)
    {
        View v = state switch
        {
            "first-launch" => new View.FirstLaunch(),
            "stale" or "weather-dim" => new View.Stale(g, At),
            "offline-with-last-known" or "offline-last-frame" => new View.Offline(g, At),
            "offline-never-answered" => new View.Offline(null, null),
            "config-missing" => new View.Config(new ConfigResult.Missing()),
            "config-invalid-json" => new View.Config(new ConfigResult.Unreadable(3)),
            "token-missing" => new View.Config(new ConfigResult.TokenMissing()),
            "wrong-token-401" => new View.WrongToken(At),
            "desk-off-503" => new View.DeskOff(At),
            "server-too-new" => new View.ServerTooNew(2),
            _ => new View.Live(g),
        };
        var strip = g.Weather is { } w ? new Strip(w, v is View.Stale or View.Offline) : null; // fixtures without weather draw no strip
        Cam? cam = state switch
        {
            "camera-loading" => new Cam(false, double.PositiveInfinity, FrameState.Loading, null, null),
            "camera-watch-waking" => new Cam(false, double.PositiveInfinity, FrameState.Loading, null, null, Live: true),
            "camera-live" or "camera-letterbox" or "camera-stale" or "camera-no-picture" or "offline-last-frame" or "camera-collapsed"
                or "camera-folded" or "camera-hover-frame" or "camera-focus-header"
                or "camera-watch-on" or "camera-watch-stale" or "camera-watch-no-picture" or "camera-watch-letterbox"
                or "camera-watch-folded" or "camera-watch-focus" => FrameCam(state, dpi),
            _ => null, // camera-hidden: the fixture says camera, three false polls took the block away
        };
        return new Model(v, v, state == "update-held", state == "hover-row-1", state == "focus-row-1", strip, cam);
    }

    public sealed record Composed(Border Host, DeskView View, RenderTargetBitmap Bitmap, double Dpi);

    public static Composed Compose(Model m, double dpi)
    {
        Theme.EnsureLoaded();
        var view = new DeskView(TimeZoneInfo.Utc);
        view.Render(m);
        var host = new Border { Background = new SolidColorBrush(BackdropColor), Padding = new Thickness(Backdrop), Child = view, UseLayoutRounding = true, SnapsToDevicePixels = true };
        var scale = dpi / 96;
        VisualTreeHelper.SetRootDpi(host, new DpiScale(scale, scale)); // layout rounding then snaps to the device grid of the target DPI
        host.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        host.Arrange(new Rect(host.DesiredSize));
        host.UpdateLayout();
        var rtb = new RenderTargetBitmap((int)Math.Ceiling(host.ActualWidth * scale), (int)Math.Ceiling(host.ActualHeight * scale), dpi, dpi, PixelFormats.Pbgra32);
        rtb.Render(host);
        return new Composed(host, view, rtb, dpi);
    }

    public static void SavePng(BitmapSource bmp, string path)
    {
        var enc = new PngBitmapEncoder();
        enc.Frames.Add(BitmapFrame.Create(bmp));
        using var f = File.Create(path);
        enc.Save(f);
    }

    /// <summary>The six tray states at 16, 20, 24 and 32 px on a dark and a light taskbar, each pixel-exact then magnified 4x with nearest-neighbour.</summary>
    public static BitmapSource TraySheet()
    {
        Theme.EnsureLoaded();
        var kinds = Enum.GetValues<TrayKind>();
        var sizes = new[] { 16, 20, 24, 32 };
        const int zoom = 4, cell = 32 * zoom + 24, rowH = 32 * zoom + 24, label = 150;
        var half = sizes.Length * cell;
        var w = label + 2 * half;
        var h = 30 + kinds.Length * rowH;
        var v = new DrawingVisual();
        using (var dc = v.RenderOpen())
        {
            dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(0x20, 0x20, 0x20)), null, new Rect(0, 0, label + half, h));
            dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(0xf3, 0xf3, 0xf3)), null, new Rect(label + half, 0, half, h));
            void Label(string t, double x, double y, Color c) => dc.DrawText(new FormattedText(t, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, new Typeface("Segoe UI"), 12, new SolidColorBrush(c), 1.0), new Point(x, y));
            for (var s = 0; s < sizes.Length; s++)
            {
                Label($"{sizes[s]} px", label + s * cell + 8, 6, Color.FromRgb(0xcc, 0xcc, 0xcc));
                Label($"{sizes[s]} px", label + half + s * cell + 8, 6, Color.FromRgb(0x33, 0x33, 0x33));
            }
            for (var k = 0; k < kinds.Length; k++)
            {
                Label(kinds[k].ToString(), 10, 30 + k * rowH + rowH / 2 - 8, Color.FromRgb(0xcc, 0xcc, 0xcc));
                for (var s = 0; s < sizes.Length; s++)
                    foreach (var x0 in new[] { label, label + half })
                    {
                        var bmp = TrayIcon.Bitmap(kinds[k], sizes[s]);
                        var d = sizes[s] * zoom;
                        var r = new Rect(x0 + s * cell + 8, 30 + k * rowH + 8, d, d);
                        var img = new DrawingGroup();
                        RenderOptions.SetBitmapScalingMode(img, BitmapScalingMode.NearestNeighbor);
                        using (var ic = img.Open()) ic.DrawImage(bmp, r);
                        dc.DrawDrawing(img);
                    }
            }
        }
        var rtb = new RenderTargetBitmap(w, h, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(v);
        return rtb;
    }

    /// <summary>NightwatchDesk.exe --snapshot fixture.json state out.png [dpi]   (state "tray-sheet" ignores the fixture).</summary>
    public static int Cli(string[] a)
    {
        if (a.Length < 4) { Console.Error.WriteLine("usage: --snapshot <fixture.json> <state> <out.png> [dpi]"); return 2; }
        var dpi = a.Length > 4 ? double.Parse(a[4], CultureInfo.InvariantCulture) : 96;
        if (a[2] == "tray-sheet") { SavePng(TraySheet(), a[3]); return 0; }
        if (!States.Contains(a[2])) { Console.Error.WriteLine("unknown state " + a[2]); return 2; }
        if (GlanceParser.Parse(File.ReadAllText(a[1])) is not Outcome.Ok ok) { Console.Error.WriteLine("fixture is not a v1 glance"); return 2; }
        SavePng(Compose(ModelFor(a[2], ok.Glance, dpi), dpi).Bitmap, a[3]);
        return 0;
    }
}
