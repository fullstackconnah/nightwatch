using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

/// <summary>The tray mark, drawn at runtime from tokens (SHAPE "Tray and toasts"): a disc, the brand's activity line, an optional badge. No .ico files.</summary>
internal static class TrayIcon
{
    const string Activity = "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2";
    const string Flat = "M2 12H22";
    static readonly Dictionary<(TrayKind, int), System.Drawing.Icon> Cache = new();

    public static void Draw(DrawingContext dc, TrayKind kind, double px)
    {
        var r = px / 2;
        dc.DrawEllipse(Theme.B("bg"), new Pen(Theme.B("line-bright"), 1), new Point(r, r), r - .5, r - .5);

        var flat = kind is TrayKind.NoAnswer or TrayKind.FixDesk;
        var glyphBrush = kind switch
        {
            TrayKind.Checking => Theme.B("ink-dim"),
            TrayKind.NoAnswer or TrayKind.FixDesk => Theme.B("ink-faint"),
            _ => Theme.B("accent"),
        };
        var s = px * .66 / 20; // the glyph spans 20 of the 24 units; it fills 66% of the disc
        var pen = new Pen(glyphBrush, 1.5 * px / 16 / s) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };
        dc.PushTransform(new TransformGroup { Children = { new TranslateTransform(-12, -12), new ScaleTransform(s, s), new TranslateTransform(r, r) } });
        dc.DrawGeometry(null, pen, Geometry.Parse(flat ? Flat : Activity));
        dc.Pop();

        var badge = kind switch { TrayKind.NeedsWarn or TrayKind.FixDesk => "warn", TrayKind.NeedsBad => "bad", _ => null };
        if (badge is null) return;
        var d = px * (px < 24 ? .35 : .4); // below 24 px the badge shrinks so it clears the glyph
        dc.DrawEllipse(Theme.B(badge), new Pen(Theme.B("bg"), 1), new Point(px - d / 2 - .5, px - d / 2 - .5), d / 2, d / 2);
    }

    public static BitmapSource Bitmap(TrayKind kind, int px)
    {
        Theme.EnsureLoaded();
        var v = new DrawingVisual();
        using (var dc = v.RenderOpen()) Draw(dc, kind, px);
        var rtb = new RenderTargetBitmap(px, px, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(v);
        return rtb;
    }

    // shortcut: icon handles are never destroyed; there are six kinds per size, so the leak is bounded.
    public static System.Drawing.Icon Icon(TrayKind kind, int px)
    {
        if (Cache.TryGetValue((kind, px), out var hit)) return hit;
        var src = Bitmap(kind, px);
        var data = new byte[px * px * 4];
        src.CopyPixels(data, px * 4, 0);
        using var bmp = new System.Drawing.Bitmap(px, px, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
        var bd = bmp.LockBits(new System.Drawing.Rectangle(0, 0, px, px), ImageLockMode.WriteOnly, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
        Marshal.Copy(data, 0, bd.Scan0, data.Length);
        bmp.UnlockBits(bd);
        return Cache[(kind, px)] = System.Drawing.Icon.FromHandle(bmp.GetHicon());
    }
}
