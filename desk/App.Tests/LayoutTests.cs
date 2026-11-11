using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

public class LayoutTests
{
    static FrameworkElement[] Ids(DependencyObject root, string id) =>
        Fix.Walk<FrameworkElement>(root).Where(e => AutomationProperties.GetAutomationId(e) == id).ToArray();

    static double Outer(FrameworkElement e) => e.ActualHeight + e.Margin.Top + e.Margin.Bottom;
    static void Near(string n, double want, double got, double tol = 0.05) { Fix.Rec(n, got.ToString("0.###")); Assert.InRange(got, want - tol, want + tol); }

    [Fact]
    public void N1_N2_width_and_content()
    {
        var c = Sta.Run(() => Fix.Compose("lanes-and-items"));
        Sta.Run(() =>
        {
            Near("N1 window width", 320, c.View.ActualWidth);
            Near("N2 side padding token sp-lg", 16, Theme.D("sp-lg"));
            var head = Ids(c.View, "head")[0];
            Near("N2 content width", 288, head.ActualWidth);
        });
    }

    [Theory]
    [InlineData("healthy")]
    [InlineData("long-copy")]
    [InlineData("config-missing")]
    public void N3_N4_answer_slot_and_head_height(string state)
    {
        var c = Sta.Run(() => Fix.Compose(state));
        Sta.Run(() =>
        {
            var head = Ids(c.View, "head")[0];
            var answerBox = Fix.Walk<Grid>(head).First(g => g.Height > 40);
            Near($"N3 answer slot ({state})", 46.8, answerBox.ActualHeight, 0.5); // layout rounding snaps to whole pixels
            Near($"N4 head height ({state})", 74.8, Outer(head), 0.5);
        });
    }

    [Fact]
    public void N3_long_copy_shows_both_lines_and_the_ellipsis()
    {
        var c = Sta.Run(() => Fix.Compose("long-copy", 144));
        Sta.Run(() =>
        {
            var head = Ids(c.View, "head")[0];
            var tb = Fix.Walk<TextBlock>(head).First(t => t.Text.Length > 100);
            Fix.Rec("N3 long-copy answer lines at 144 dpi", (tb.ActualHeight / 23.4).ToString("0.##"));
            Assert.True(tb.ActualHeight >= 2 * 23.4 - 0.5 && tb.ActualHeight <= 2 * 23.4 + 1.25);
            Assert.Equal(TextTrimming.CharacterEllipsis, tb.TextTrimming);
        });
    }


    [Theory]
    [InlineData("long-copy", 96)]
    [InlineData("long-copy", 144)]
    [InlineData("lanes-and-items", 96)]
    [InlineData("lanes-and-items", 144)]
    public void M1_answer_second_line_has_ink(string state, int dpi)
    {
        var c = Sta.Run(() => Fix.Compose(state, dpi));
        var ink = Sta.Run(() =>
        {
            var tb = Fix.Walk<TextBlock>(Ids(c.View, "head")[0]).First(t => t.Text.Length > 20);
            var o = tb.TransformToAncestor(c.Host).Transform(new Point(0, 0));
            var k = dpi / 96.0;
            var lh = Theme.D("lh-headline");
            int x0 = (int)(o.X * k), x1 = (int)((o.X + tb.ActualWidth) * k), y0 = (int)((o.Y + lh + 2) * k), y1 = (int)((o.Y + 2 * lh - 2) * k);
            var n = 0;
            var buf = new byte[4];
            for (var y = y0; y < y1; y++)
                for (var x = x0; x < x1; x++)
                {
                    c.Bitmap.CopyPixels(new Int32Rect(x, y, 1, 1), buf, 4, 0);
                    if (buf[0] > 0x60 || buf[1] > 0x60 || buf[2] > 0x60) n++; // light ink on the dark panel
                }
            return n;
        });
        Fix.Rec($"M1 second-line ink pixels ({state} {dpi})", ink.ToString());
        Assert.True(ink > 20, $"second line empty: {ink} ink pixels");
    }


    [Theory]
    [InlineData("stale")]
    [InlineData("offline-with-last-known")]
    public void S1_dim_states_draw_vitals_in_ink_dim(string state)
    {
        var c = Sta.Run(() => Fix.Compose(state));
        Sta.Run(() =>
        {
            var dim = ((SolidColorBrush)Theme.B("ink-dim")).Color;
            var runs = Ids(c.View, "vitals")[0] is TextBlock tb ? tb.Inlines.OfType<System.Windows.Documents.Run>().Where(r => r.Text.Trim() is not ("" or "·")).ToArray() : [];
            Assert.True(runs.Length >= 6);
            Assert.All(runs, r => Assert.Equal(dim, ((SolidColorBrush)r.Foreground).Color));
        });
    }

    [Fact]
    public void M2_pending_fixture_draws_the_ring_mark()
    {
        var c = Sta.Run(() => Fix.Compose("pending"));
        Sta.Run(() =>
        {
            var ring = Fix.Walk<System.Windows.Shapes.Ellipse>(Ids(c.View, "head")[0]).Single();
            Assert.Null(ring.Fill); // the ring is a stroke only
            Assert.NotNull(ring.Stroke);
        });
    }

    [Fact]
    public void N5_N6_row_height_and_columns()
    {
        var c = Sta.Run(() => Fix.Compose("lanes-and-items"));
        Sta.Run(() =>
        {
            var row = Ids(c.View, "row")[0];
            Near("N5 row height", 56, row.ActualHeight);
            var grid = Fix.Walk<Grid>(row).First(g => g.ColumnDefinitions.Count == 5);
            var w = grid.ColumnDefinitions.Select(d => d.ActualWidth).ToArray();
            Fix.Rec("N6 row columns", string.Join("/", w.Select(x => x.ToString("0.##"))));
            Assert.Equal(new[] { 8d, 12d, 248d, 8d, 12d }, w.Select(x => Math.Round(x, 2)).ToArray());
            Near("N5 line 1", 19.6, Fix.Walk<TextBlock>(row).First().ActualHeight, 0.6);
        });
    }

    [Fact]
    public void N7_label_band_N8_more_N9_vitals_N10_footer()
    {
        var c = Sta.Run(() => Fix.Compose("overflow"));
        Sta.Run(() =>
        {
            var lab = Ids(c.View, "label")[0];
            Near("N7 label band", 26, Outer(lab), 0.1);
            Near("N8 more row", 32, Ids(c.View, "more")[0].ActualHeight);
            Near("N9 vitals line", 42, Outer(Ids(c.View, "vitals")[0]), 0.1);
            var foot = Ids(c.View, "footer")[0];
            Near("N10 footer", 36.8, Outer(foot), 0.5);
            var held = Fix.Walk<TextBlock>(foot).First(t => t.Text == "UPDATE HELD");
            Assert.Equal(Visibility.Hidden, held.Visibility); // reserved slot, never Collapsed
        });
    }

    [Fact]
    public void N11_healthy_height_N12_max_height()
    {
        var h = Sta.Run(() => Fix.Compose("healthy").View.ActualHeight);
        var max = Sta.Run(() => Fix.Compose("overflow").View.ActualHeight);
        Near("N11 healthy window height", 157, h, 1);
        Fix.Rec("N12 max height (overflow)", max.ToString("0.##"));
        Assert.True(max <= 584, $"max {max}");
    }

    static readonly double[] Sizes = { 10, 11.2, 12, 14, 18 };

    [Fact]
    public void N13_no_text_smaller_than_label_or_outside_the_table()
    {
        var bad = new List<string>();
        double min = 99;
        foreach (var s in Snapshot.States)
        {
            var c = Sta.Run(() => Fix.Compose(s));
            Sta.Run(() =>
            {
                foreach (var t in Fix.Walk<TextBlock>(c.View))
                {
                    min = Math.Min(min, t.FontSize);
                    foreach (var r in t.Inlines.OfType<System.Windows.Documents.Run>().Select(r => r.FontSize).Append(t.FontSize))
                        if (!Sizes.Contains(Math.Round(r, 2))) bad.Add($"{s}:{r}");
                }
            });
        }
        Fix.Rec("N13 smallest text", min.ToString("0.#"));
        Assert.Empty(bad);
        Assert.True(min >= 10);
    }

    // CIE76 on sRGB, enough for "no state colour".
    internal static (double L, double a, double b) Lab(Color c)
    {
        static double F(double v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4); }
        double r = F(c.R), g = F(c.G), bl = F(c.B);
        double x = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * bl, z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
        static double T(double t) => t > 0.008856 ? Math.Cbrt(t) : 7.787 * t + 16.0 / 116;
        return (116 * T(y) - 16, 500 * (T(x) - T(y)), 200 * (T(y) - T(z)));
    }

    internal static double DeltaE(Color p, Color q) { var a = Lab(p); var b = Lab(q); return Math.Sqrt(Math.Pow(a.L - b.L, 2) + Math.Pow(a.a - b.a, 2) + Math.Pow(a.b - b.b, 2)); }

    internal static Color Pixel(BitmapSource bmp, int x, int y)
    {
        var px = new byte[4];
        bmp.CopyPixels(new Int32Rect(x, y, 1, 1), px, 4, 0);
        return Color.FromRgb(px[2], px[1], px[0]);
    }

    [Fact]
    public void N14_healthy_png_has_no_state_colour()
    {
        var c = Sta.Run(() => Fix.Compose("healthy"));
        var states = Sta.Run(() => new[] { ((SolidColorBrush)Theme.B("warn")).Color, ((SolidColorBrush)Theme.B("bad")).Color, Color.FromRgb(0x34, 0xd3, 0x99), Color.FromRgb(0x4a, 0xde, 0x80) });
        var min = double.MaxValue;
        var (w, h) = Sta.Run(() => (c.Bitmap.PixelWidth, c.Bitmap.PixelHeight));
        var buf = new byte[w * h * 4];
        Sta.Run(() => c.Bitmap.CopyPixels(buf, w * 4, 0));
        for (var i = 0; i < buf.Length; i += 4)
        {
            var px = Color.FromRgb(buf[i + 2], buf[i + 1], buf[i]);
            foreach (var s in states) min = Math.Min(min, DeltaE(px, s));
        }
        Fix.Rec("N14 healthy min deltaE to warn/bad/ok", min.ToString("0.#"));
        Assert.True(min > 10);
    }

    [Fact]
    public void N15_hover_row_fill_is_panel_2()
    {
        var c = Sta.Run(() => Fix.Compose("hover-row-1"));
        var (want, got) = Sta.Run(() =>
        {
            var row = Ids(c.View, "row")[0];
            var p = row.TransformToAncestor(c.Host).Transform(new Point(3, row.ActualHeight / 2));
            return (((SolidColorBrush)Theme.B("panel-2")).Color, Pixel(c.Bitmap, (int)p.X, (int)p.Y));
        });
        Fix.Rec("N15 hover fill", got.ToString());
        Assert.Equal(want.R, got.R); Assert.Equal(want.G, got.G); Assert.Equal(want.B, got.B);
    }

    [Fact]
    public void N16_focus_ring_is_1_accent_radius_md()
    {
        var c = Sta.Run(() => Fix.Compose("focus-row-1"));
        Sta.Run(() =>
        {
            var row = (Button)Ids(c.View, "row")[0];
            var ring = (Border)row.Template.FindName("Ring", row);
            Fix.Rec("N16 focus ring", $"visible={ring.Visibility} thickness={ring.BorderThickness.Left} radius={ring.CornerRadius.TopLeft}");
            Assert.Equal(Visibility.Visible, ring.Visibility);
            Assert.Equal(1, ring.BorderThickness.Left);
            Assert.Equal(Theme.D("r-md"), ring.CornerRadius.TopLeft);
            Assert.Equal(((SolidColorBrush)Theme.B("accent")).Color, ((SolidColorBrush)ring.BorderBrush).Color);
        });
    }

    [Fact]
    public void N17_hairlines_at_150_percent_land_on_whole_device_pixels()
    {
        var c = Sta.Run(() => Fix.Compose("lanes-and-items", 144));
        var bad = new List<string>();
        Sta.Run(() =>
        {
            var line = ((SolidColorBrush)Theme.B("line")).Color;
            foreach (var h in Ids(c.View, "hairline").Where(Fix.Shown))
            {
                var r = h.TransformToAncestor(c.Host).TransformBounds(new Rect(0, 0, h.ActualWidth, h.ActualHeight));
                var top = r.Top * 1.5; var hgt = r.Height * 1.5;
                if (Math.Abs(top - Math.Round(top)) > 0.01 || Math.Abs(hgt - Math.Round(hgt)) > 0.01 || hgt < 1) { bad.Add($"{top}/{hgt}"); continue; }
                var p = Pixel(c.Bitmap, (int)(r.Left * 1.5) + 40, (int)Math.Round(top));
                if (p.R != line.R || p.G != line.G || p.B != line.B) bad.Add($"px {p} vs {line}");
            }
        });
        Fix.Rec("N17 hairline misses at 144 dpi", bad.Count.ToString());
        Assert.Empty(bad);
    }
}
