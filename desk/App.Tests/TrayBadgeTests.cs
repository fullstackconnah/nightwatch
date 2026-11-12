using System.Windows.Media;
using System.Windows.Media.Imaging;
using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

/// <summary>DESK-N4: the badge never touches the activity glyph; at least 1 px of clear background between them.</summary>
public class TrayBadgeTests
{
    const double Clear = 1; // px between a glyph pixel and the badge's outer ring

    /// <summary>The kind drawn without its badge: the glyph exactly as placed, nothing covering it.</summary>
    static byte[] Pixels(TrayKind kind, int px) => Sta.Run(() =>
    {
        Theme.EnsureLoaded();
        var v = new DrawingVisual();
        using (var dc = v.RenderOpen()) TrayIcon.Draw(dc, kind, px, withBadge: false);
        var b = new RenderTargetBitmap(px, px, 96, 96, PixelFormats.Pbgra32);
        b.Render(v);
        var d = new byte[px * px * 4];
        b.CopyPixels(d, px * 4, 0);
        return d;
    });

    /// <summary>Smallest gap, in px, from a non-background pixel to the badge's outer ring (a 1 px pen on the disc edge), over every glyph pixel (a negative gap is an overlap).</summary>
    static double MinGap(TrayKind kind, int px)
    {
        var d = Pixels(kind, px);
        var (c, dia) = TrayIcon.BadgeAt(px);
        var outer = dia / 2 + .5;
        var o = (2 * px + px / 2) * 4; // disc interior above the glyph
        var min = double.MaxValue;
        for (var y = 0; y < px; y++)
            for (var x = 0; x < px; x++)
            {
                var i = (y * px + x) * 4;
                var r = px / 2.0;
                if (Math.Sqrt(Math.Pow(x + .5 - r, 2) + Math.Pow(y + .5 - r, 2)) > r - 2) continue; // the disc's own ring
                if (Math.Abs(d[i] - d[o]) + Math.Abs(d[i + 1] - d[o + 1]) + Math.Abs(d[i + 2] - d[o + 2]) < 40) continue; // background
                var dx = Math.Max(Math.Max(x - c, c - (x + 1)), 0);
                var dy = Math.Max(Math.Max(y - c, c - (y + 1)), 0);
                var gap = Math.Sqrt(dx * dx + dy * dy) - outer;
                if (gap < min) min = gap; // a negative gap is an overlap
            }
        Fix.Rec($"gap {kind} {px}", min.ToString("0.##"));
        return min;
    }

    [Theory]
    [InlineData(TrayKind.NeedsWarn, 16)]
    [InlineData(TrayKind.NeedsWarn, 20)]
    [InlineData(TrayKind.NeedsWarn, 24)]
    [InlineData(TrayKind.NeedsWarn, 32)]
    [InlineData(TrayKind.NeedsBad, 16)]
    [InlineData(TrayKind.NeedsBad, 20)]
    [InlineData(TrayKind.NeedsBad, 24)]
    [InlineData(TrayKind.NeedsBad, 32)]
    [InlineData(TrayKind.FixDesk, 16)]
    [InlineData(TrayKind.FixDesk, 20)]
    [InlineData(TrayKind.FixDesk, 24)]
    [InlineData(TrayKind.FixDesk, 32)]
    public void N4_badge_clears_the_glyph(TrayKind badged, int px) =>
        Assert.True(MinGap(badged, px) >= Clear, $"{badged} at {px}px");

    [Theory]
    [InlineData(16)]
    [InlineData(20)]
    [InlineData(24)]
    [InlineData(32)]
    public void N4_badge_stays_readable(int px) => Assert.True(TrayIcon.BadgeAt(px).Diameter >= px * .35 - 1e-9);
}
