using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Automation.Provider;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

/// <summary>N21-N40 (desk-cam SHAPE 6): the weather strip, the camera block, the feed and the fit-fold.</summary>
public class CameraTests
{
    static FrameworkElement[] Ids(DependencyObject root, string id) =>
        Fix.Walk<FrameworkElement>(root).Where(e => AutomationProperties.GetAutomationId(e) == id).ToArray();

    static void Near(string n, double want, double got, double tol = 0.05) { Fix.Rec(n, got.ToString("0.###")); Assert.InRange(got, want - tol, want + tol); }

    static Glance CameraGlance(string name) => Fix.Load(name);

    static Snapshot.Composed Open(string fixture, bool collapsed = false, double work = double.PositiveInfinity, double dpi = 96, string frame = "camera-live")
    {
        var g = Fix.Load(fixture);
        var m = Snapshot.ModelFor(frame, g, dpi);
        m = m with { Camera = m.Camera! with { Collapsed = collapsed }, WorkHeight = work };
        return Sta.Run(() => Snapshot.Compose(m, dpi));
    }

    static Color Brush(string key) => ((SolidColorBrush)Theme.B(key)).Color;

    // --- weather strip ----------------------------------------------------------------------
    [Theory]
    [InlineData("weather-on")]
    [InlineData("weather-dim")]
    [InlineData("weather-long")]
    public void N21_N22_N23_strip_height_columns_and_lines(string state)
    {
        var c = Sta.Run(() => Fix.Compose(state));
        Sta.Run(() =>
        {
            var strip = Ids(c.View, "weather").Single();
            // slice 2: the strip is the TODAY body, so the block is the header (hairline + more-height = 33) plus the strip
            Near($"N21 strip block ({state})", 89, Ids(c.View, "today-block").Single().ActualHeight);
            Near($"N21 strip row ({state})", 56, strip.ActualHeight);
            var cols = ((Grid)strip).ColumnDefinitions.Select(d => Math.Round(d.ActualWidth, 2)).ToArray();
            Fix.Rec($"N22 strip columns ({state})", string.Join("/", cols));
            Assert.Equal(new[] { 16d, 6d, 266d }, cols);
            Assert.Equal(Theme.D("frame-w"), cols.Sum());
            var lines = Fix.Walk<TextBlock>(strip).ToArray();
            Near($"N23 line 1 ({state})", 19.6, lines[0].ActualHeight, 0.6);
            Near($"N23 line 2 ({state})", 16.8, lines[1].ActualHeight, 0.6);
            var text = (FrameworkElement)lines[0].Parent;
            var top = text.TransformToAncestor(strip).Transform(new Point(0, 0)).Y;
            var bottom = strip.ActualHeight - top - text.ActualHeight;
            Near($"N23 inset difference ({state})", 0, top - bottom, 1.01); // layout rounding moves one text edge by up to one DIP
        });
    }

    [Theory]
    [InlineData(96)]
    [InlineData(144)]
    public void N24_the_worst_weather_text_never_trims(int dpi)
    {
        var c = Sta.Run(() => Snapshot.Compose(Snapshot.ModelFor("weather-long", Fix.Load("weather-long"), dpi), dpi));
        Sta.Run(() =>
        {
            foreach (var t in Fix.Walk<TextBlock>(Ids(c.View, "weather").Single()))
            {
                var avail = t.ActualWidth;
                t.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                Fix.Rec($"N24 natural/available width ({dpi})", $"{t.DesiredSize.Width:0.#}/{avail:0.#}");
                Assert.True(t.DesiredSize.Width <= avail + 0.01, $"{t.Text}: {t.DesiredSize.Width} > {avail}");
            }
        });
        Assert.Equal("feels -10° · H -2° · L -15° · 100% rain", Copy.WeatherLine2(Fix.Load("weather-long").Weather!));
    }

    [Fact]
    public void N32_dim_weather_quietens_the_temperature_and_glyph_only()
    {
        var live = Sta.Run(() => Fix.Compose("weather-on"));
        var dim = Sta.Run(() => Fix.Compose("weather-dim"));
        Sta.Run(() =>
        {
            Color Temp(Snapshot.Composed c) => ((SolidColorBrush)Fix.Walk<TextBlock>(Ids(c.View, "weather").Single()).First().Inlines.OfType<System.Windows.Documents.Run>().First().Foreground).Color;
            Color Glyph(Snapshot.Composed c) => ((SolidColorBrush)Fix.Walk<System.Windows.Shapes.Path>(Ids(c.View, "weather").Single()).Single().Stroke).Color;
            Color Line2(Snapshot.Composed c) => ((SolidColorBrush)Fix.Walk<TextBlock>(Ids(c.View, "weather").Single()).ElementAt(1).Foreground).Color;
            Assert.Equal(Brush("ink"), Temp(live)); Assert.Equal(Brush("ink-dim"), Glyph(live));
            Assert.Equal(Brush("ink-dim"), Temp(dim)); Assert.Equal(Brush("ink-faint"), Glyph(dim));
            Assert.Equal(Brush("ink-dim"), Line2(dim)); Assert.Equal(Brush("ink-dim"), Line2(live));
            Fix.Rec("N32 dim temp/glyph/line2", $"{Temp(dim)}/{Glyph(dim)}/{Line2(dim)}");
        });
    }

    [Fact]
    public void Every_glance_icon_has_a_glyph_and_an_unknown_one_is_a_cloud()
    {
        var keys = WeatherGlyph.Keys.ToHashSet();
        foreach (var icon in new[] { "clear", "partly-cloudy", "cloudy", "fog", "drizzle", "rain", "snow", "showers", "thunderstorm", "mystery", null })
            Assert.Contains(Copy.GlyphKey(icon), keys);
        Assert.Equal(9, keys.Count);
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            foreach (var icon in new[] { "clear", "partly-cloudy", "cloudy", "fog", "drizzle", "rain", "snow", "showers", "thunderstorm" })
            {
                var g = (Viewbox)WeatherGlyph.Build(icon, "ink-dim");
                Assert.Equal(16, g.Width);
                Assert.Equal(2.25, ((System.Windows.Shapes.Path)((Canvas)g.Child).Children[0]).StrokeThickness); // 1.5 DIP rendered
            }
        });
    }

    [Fact]
    public void Weather_null_draws_no_strip_and_is_the_healthy_height()
    {
        var hidden = Sta.Run(() => Fix.Compose("weather-null"));
        var healthy = Sta.Run(() => Fix.Compose("healthy"));
        Sta.Run(() => Assert.Empty(Ids(hidden.View, "weather")));
        Assert.Equal(healthy.View.ActualHeight, hidden.View.ActualHeight);
    }

    // --- camera block -----------------------------------------------------------------------
    [Fact]
    public void N25_N26_frame_size_chrome_and_letterbox()
    {
        foreach (var dpi in new[] { 96, 144 })
        {
            var c = Sta.Run(() => Fix.Compose("camera-letterbox", dpi));
            Sta.Run(() =>
            {
                var f = Ids(c.View, "camera-frame").Single();
                Assert.Equal(Theme.D("win-width") - 2 * Theme.D("sp-lg"), f.ActualWidth);
                Near($"N25 frame width ({dpi})", 288, f.ActualWidth);
                Near($"N25 frame height ({dpi})", 162, f.ActualHeight);
                Assert.True(Math.Abs(f.ActualWidth * 9 / 16 - f.ActualHeight) <= 1);
                var px = f.TransformToAncestor(c.Host).TransformBounds(new Rect(0, 0, f.ActualWidth, f.ActualHeight));
                Fix.Rec($"N25 frame px ({dpi})", $"{px.Width * dpi / 96:0}x{px.Height * dpi / 96:0}");
                var edge = Fix.Walk<Border>(f).First(b => b.Name == "Edge");
                Assert.Equal(1, edge.BorderThickness.Left);
                Assert.Equal(Brush("line"), ((SolidColorBrush)edge.BorderBrush).Color);
                Assert.Equal(Theme.D("r-md"), edge.CornerRadius.TopLeft);
                Assert.Equal(Theme.D("r-md"), ((RectangleGeometry)((FrameworkElement)((Button)f).Content).Clip).RadiusX);
                // The 4:3 picture is 216 wide, so 36 DIP either side show the frame fill.
                var s = dpi / 96.0;
                var p = LayoutTests.Pixel(c.Bitmap, (int)((px.Left + 10) * s), (int)((px.Top + px.Height / 2) * s));
                Fix.Rec($"N26 letterbox pixel ({dpi})", p.ToString());
                Assert.Equal(Brush("bg"), p);
            });
        }
        var hover = Sta.Run(() => Fix.Compose("camera-hover-frame"));
        Sta.Run(() =>
        {
            var f = (Button)Ids(hover.View, "camera-frame").Single();
            Assert.Equal(Brush("line-bright"), ((SolidColorBrush)Fix.Walk<Border>(f).First(b => b.Name == "Edge").BorderBrush).Color);
        });
    }

    [Theory]
    [InlineData("camera-loading", 207)]
    [InlineData("camera-live", 207)]
    [InlineData("camera-letterbox", 207)]
    [InlineData("camera-stale", 207)]
    [InlineData("camera-no-picture", 207)]
    [InlineData("camera-collapsed", 33)]
    [InlineData("camera-folded", 33)]
    public void N27_camera_block_height_is_the_same_in_every_open_frame_state(string state, double want)
    {
        var c = Sta.Run(() => Fix.Compose(state));
        // the header and the Watch live button now share a row, so the block is found by its own id
        Sta.Run(() => Near($"N27 camera block ({state})", want, Ids(c.View, "camera-block").Single().ActualHeight));
    }

    [Fact]
    public void N28_N29_window_totals_and_no_jump_on_a_frame()
    {
        var heights = new[] { "camera-loading", "camera-live", "camera-letterbox", "camera-stale", "camera-no-picture" }
            .Select(s => Sta.Run(() => Fix.Compose(s).View.ActualHeight)).ToArray();
        Fix.Rec("N28 heights loading/live/swap/stale/none", string.Join("/", heights.Select(h => h.ToString("0.###"))));
        Assert.All(heights, h => Assert.Equal(heights[0], h));
        // slice 2: TODAY (89 with the strip) replaces the strip alone (57): +32 on every total
        Near("N29 all clear, open", 452.6, heights[1], 1);
        Near("N29 all clear, collapsed", 278.6, Sta.Run(() => Fix.Compose("camera-collapsed").View.ActualHeight), 1);
        Near("N29 weather and camera hidden = N11", 189.6, Sta.Run(() => Fix.Compose("weather-null").View.ActualHeight), 1);
        Near("N29 camera hidden = weather-on", Sta.Run(() => Fix.Compose("weather-on").View.ActualHeight), Sta.Run(() => Fix.Compose("camera-hidden").View.ActualHeight), 0.01);
    }

    [Fact]
    public void N30_fit_fold_order_camera_then_today_at_a_480_work_area()
    {
        // slice 2: the TODAY header and forecast made every window 32 taller, so the old 464 work area now folds the all-clear camera;
        // 480 (limit 464) keeps the old story: all clear fits, one lane folds the camera, three items fold the camera and then TODAY
        const double Work = 480;
        var clear = Open("camera", work: Work);
        Sta.Run(() => Assert.False(clear.View.CameraFolded));
        Sta.Run(() => Assert.False(clear.View.TodayFolded));
        Near("N30 all clear stays open", 452.6, clear.View.ActualHeight, 1);

        var one = Fix.Load("one-lane") with { Weather = Fix.Load("camera").Weather, Camera = true };
        var m = Snapshot.ModelFor("camera-live", one) with { };
        m = m with { WorkHeight = Work };
        var c1 = Sta.Run(() => Snapshot.Compose(m, 96));
        Sta.Run(() => Assert.True(c1.View.CameraFolded));
        Sta.Run(() => Assert.False(c1.View.TodayFolded));
        Near("N30 one lane folds the camera only", 361.6, c1.View.ActualHeight, 1);

        var three = Open("camera-3-items", work: Work);
        Sta.Run(() => Assert.True(three.View.CameraFolded));
        Sta.Run(() => Assert.True(three.View.TodayFolded)); // 475.6 with the camera folded is still over 464: TODAY folds next
        Near("N30 3 items fold the camera, then TODAY", 419.6, three.View.ActualHeight, 1);
        Assert.True(three.View.ActualHeight <= Work - 16);

        // a view state only: unfolds on the first render that fits, and WinState has nothing to save it in
        Sta.Run(() =>
        {
            var wide = Snapshot.ModelFor("camera-live", Fix.Load("camera-3-items")) with { };
            three.View.Render(wide);
            Assert.False(three.View.CameraFolded);
            Assert.DoesNotContain(typeof(WinState).GetProperties(), p => p.Name.Contains("Fold", StringComparison.OrdinalIgnoreCase));
            var header = (Button)Ids(three.View, "camera-header").Single();
            Assert.True(header.IsEnabled);
        });
        var folded = Sta.Run(() => Fix.Compose("camera-folded"));
        Sta.Run(() =>
        {
            var h = (Button)Ids(folded.View, "camera-header").Single();
            Assert.False(h.IsEnabled);
            Assert.Equal(Visibility.Collapsed, Ids(folded.View, "camera-frame").Single().Visibility);
            Assert.Contains(Copy.CameraFolded, Fix.Walk<TextBlock>(h).Select(t => t.Text));
            Assert.Equal(Copy.CameraHeaderTip(false, true), h.ToolTip);
        });
    }

    [Fact]
    public void N31b_one_warn_voice_when_the_box_is_offline()
    {
        var off = Sta.Run(() => Fix.Compose("offline-last-frame"));
        var stale = Sta.Run(() => Fix.Compose("camera-stale"));
        Sta.Run(() =>
        {
            Color AgeInk(Snapshot.Composed c) =>
                ((SolidColorBrush)Fix.Walk<TextBlock>(Ids(c.View, "camera-header").Single()).First(t => t.Text.StartsWith("as of")).Foreground).Color;
            Assert.Equal(Brush("ink-dim"), AgeInk(off)); // the box line already says it in warn
            Near("N31b offline frame opacity", Theme.D("frame-dim"), Fix.Walk<Image>(Ids(off.View, "camera-frame").Single()).Single().Opacity);
            Assert.Equal(Brush("warn"), AgeInk(stale)); // a healthy box keeps the warn age
        });
    }

    [Fact]
    public void N31_stale_frame_is_dimmed_and_its_age_is_warn()
    {
        var c = Sta.Run(() => Fix.Compose("camera-stale"));
        var live = Sta.Run(() => Fix.Compose("camera-live"));
        Sta.Run(() =>
        {
            var img = Fix.Walk<Image>(Ids(c.View, "camera-frame").Single()).Single();
            Near("N31 stale opacity", Theme.D("frame-dim"), img.Opacity);
            var age = Fix.Walk<TextBlock>(Ids(c.View, "camera-header").Single()).First(t => t.Text.StartsWith("as of"));
            Assert.Equal(Brush("warn"), ((SolidColorBrush)age.Foreground).Color);
            Assert.Equal("as of 14:03:55", age.Text);
            var ageLive = Fix.Walk<TextBlock>(Ids(live.View, "camera-header").Single()).First(t => t.Text.StartsWith("as of"));
            Assert.Equal(Brush("ink-dim"), ((SolidColorBrush)ageLive.Foreground).Color);
            Assert.Equal(1, Fix.Walk<Image>(Ids(live.View, "camera-frame").Single()).Single().Opacity);
        });
    }

    [Fact]
    public void Frame_text_for_loading_and_no_picture_and_automation_names()
    {
        var load = Sta.Run(() => Fix.Compose("camera-loading"));
        var none = Sta.Run(() => Fix.Compose("camera-no-picture"));
        Sta.Run(() =>
        {
            var l = Fix.Walk<TextBlock>(Ids(load.View, "camera-frame").Single()).Where(t => t.Visibility == Visibility.Visible).Select(t => t.Text).ToArray();
            Assert.Equal(new[] { "Waking the camera…" }, l);
            var n = Fix.Walk<TextBlock>(Ids(none.View, "camera-frame").Single()).Where(t => t.Visibility == Visibility.Visible).Select(t => t.Text).ToArray();
            Assert.Equal("No picture", n[0]);
            Assert.StartsWith("Last frame at ", n[1]);
            Assert.Equal("Front door camera, waking. Opens the kiosk.", AutomationProperties.GetName(Ids(load.View, "camera-frame").Single()));
            Assert.Equal("Front door camera, no picture. Opens the kiosk.", AutomationProperties.GetName(Ids(none.View, "camera-frame").Single()));
        });
    }

    [Fact]
    public void Header_toggles_expand_collapse_and_the_frame_opens_the_kiosk()
    {
        var c = Sta.Run(() => Fix.Compose("camera-live"));
        Sta.Run(() =>
        {
            var opened = new List<string>(); var toggled = 0;
            c.View.Open = opened.Add; c.View.CameraToggled = () => toggled++;
            c.View.CameraFrameButton.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
            c.View.CameraHeaderButton.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
            Assert.Equal(new[] { "/kiosk?door=1" }, opened);
            Assert.Equal(1, toggled);
            var peer = (IExpandCollapseProvider)new CameraHeaderPeerAccess().Peer(c.View.CameraHeaderButton);
            Assert.Equal(ExpandCollapseState.Expanded, peer.ExpandCollapseState);
            Assert.Equal("Hide the camera", c.View.CameraHeaderButton.ToolTip);
        });
        var col = Sta.Run(() => Fix.Compose("camera-collapsed"));
        Sta.Run(() =>
        {
            var peer = (IExpandCollapseProvider)new CameraHeaderPeerAccess().Peer(col.View.CameraHeaderButton);
            Assert.Equal(ExpandCollapseState.Collapsed, peer.ExpandCollapseState);
            Assert.Equal("Show the camera", col.View.CameraHeaderButton.ToolTip);
            Assert.Equal(Visibility.Collapsed, Ids(col.View, "camera-frame").Single().Visibility);
        });
    }

    sealed class CameraHeaderPeerAccess
    {
        public object Peer(Button b) => UIElementAutomationPeer.CreatePeerForElement(b).GetPattern(PatternInterface.ExpandCollapse)!;
    }

    [Fact]
    public void N36_tab_order_is_rows_more_header_frame_and_a_folded_header_is_not_a_stop()
    {
        string[] Stops(Snapshot.Composed c) => Sta.Run(() => Fix.Walk<Button>(c.View)
            .Where(b => b.IsEnabled && b.Focusable && Fix.Shown(b)).Select(b => AutomationProperties.GetAutomationId(b)).ToArray());
        var open = Open("camera-3-items");
        var s = Stops(open);
        Fix.Rec("N36 tab stops", string.Join(" > ", s));
        // slice 2: the TODAY header (camera-3-items has weather, so it is a button) comes right before the camera's
        Assert.Equal(new[] { "today-header", "camera-header", "camera-live-button", "camera-frame" }, s.TakeLast(4));
        Assert.All(s.SkipLast(4), id => Assert.True(id is "row" or "more"));
        Assert.DoesNotContain("today-header", Stops(Open("camera-3-items", work: 464))); // TODAY folds too, and a folded header is not a stop
        Assert.DoesNotContain("camera-header", Stops(Open("camera-3-items", work: 464)));
        Assert.DoesNotContain("camera-live-button", Stops(Open("camera-3-items", work: 464)));
        Assert.DoesNotContain("camera-frame", Stops(Open("camera-3-items", collapsed: true)));
        Sta.Run(() => Assert.DoesNotContain(Fix.Walk<Button>(open.View), b => Ids(b, "weather").Length > 0));
    }

    [Fact]
    public void N37_healthy_look_has_no_state_colour_on_weather_and_camera()
    {
        var states = Sta.Run(() => new[] { Brush("warn"), Brush("bad"), Color.FromRgb(0x34, 0xd3, 0x99), Color.FromRgb(0x4a, 0xde, 0x80) });
        foreach (var s in new[] { "weather-on", "camera-live" })
        {
            var c = Sta.Run(() => Fix.Compose(s));
            var (w, h, mask) = Sta.Run(() =>
            {
                var f = Ids(c.View, "camera-frame").FirstOrDefault();
                var r = f is null ? Rect.Empty : f.TransformToAncestor(c.Host).TransformBounds(new Rect(0, 0, f.ActualWidth, f.ActualHeight));
                return (c.Bitmap.PixelWidth, c.Bitmap.PixelHeight, r); // the frame rect is masked
            });
            var buf = new byte[w * h * 4];
            Sta.Run(() => c.Bitmap.CopyPixels(buf, w * 4, 0));
            var min = double.MaxValue;
            for (var y = 0; y < h; y++)
                for (var x = 0; x < w; x++)
                {
                    if (mask.Contains(x, y)) continue;
                    var i = (y * w + x) * 4;
                    var px = Color.FromRgb(buf[i + 2], buf[i + 1], buf[i]);
                    foreach (var st in states) min = Math.Min(min, LayoutTests.DeltaE(px, st));
                }
            Fix.Rec($"N37 {s} min deltaE", min.ToString("0.#"));
            Assert.True(min > 10);
        }
    }

    [Fact]
    public void N40_new_hairlines_and_the_frame_edge_land_on_whole_device_pixels_at_150_percent()
    {
        var c = Open("camera", dpi: 144);
        var bad = new List<string>();
        Sta.Run(() =>
        {
            var line = Brush("line");
            foreach (var hl in Ids(c.View, "hairline").Where(Fix.Shown))
            {
                var r = hl.TransformToAncestor(c.Host).TransformBounds(new Rect(0, 0, hl.ActualWidth, hl.ActualHeight));
                var top = r.Top * 1.5; var hgt = r.Height * 1.5;
                if (Math.Abs(top - Math.Round(top)) > 0.01 || Math.Abs(hgt - Math.Round(hgt)) > 0.01 || hgt < 1) { bad.Add($"{top}/{hgt}"); continue; }
                var p = LayoutTests.Pixel(c.Bitmap, (int)(r.Left * 1.5) + 40, (int)Math.Round(top));
                if (p.R != line.R || p.G != line.G || p.B != line.B) bad.Add($"px {p} vs {line}");
            }
            var f = Ids(c.View, "camera-frame").Single();
            var fr = f.TransformToAncestor(c.Host).TransformBounds(new Rect(0, 0, f.ActualWidth, f.ActualHeight));
            foreach (var v in new[] { fr.Left * 1.5, fr.Top * 1.5, fr.Width * 1.5, fr.Height * 1.5 })
                if (Math.Abs(v - Math.Round(v)) > 0.01) bad.Add("frame " + v);
            Assert.Equal(3, Ids(c.View, "hairline").Where(Fix.Shown).Count()); // vitals, weather, camera (the collapsed MEDIA block holds a fourth, hidden one)
        });
        Fix.Rec("N40 misses at 144 dpi", bad.Count.ToString());
        Assert.Empty(bad);
    }

    // --- decode, feed, pause ----------------------------------------------------------------
    [Fact]
    public void Decode_is_frozen_at_the_pixel_width_and_rejects_bytes_that_are_not_a_picture()
    {
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            var jpeg = Snapshot.TestFrame(640, 360, "16:9");
            var a = (System.Windows.Media.Imaging.BitmapSource)CameraFeed.Decode(jpeg, 1)!;
            var b = (System.Windows.Media.Imaging.BitmapSource)CameraFeed.Decode(jpeg, 1.5)!;
            Assert.True(a.IsFrozen && b.IsFrozen);
            Assert.Equal(288, a.PixelWidth);
            Assert.Equal(432, b.PixelWidth);
            Assert.Null(CameraFeed.Decode(new byte[] { 1, 2, 3, 4 }, 1));
        });
    }

    sealed class Rig
    {
        public int Fetches;
        public DateTimeOffset Now = new(2026, 1, 1, 14, 0, 0, TimeSpan.Zero);
        public bool Fail;
        public readonly CameraFeed Feed;
        public Rig(int interval = 30)
        {
            var jpeg = Snapshot.TestFrame(640, 360, "16:9");
            Feed = new CameraFeed(_ => { Fetches++; return Task.FromResult<FrameOutcome>(Fail ? new FrameOutcome.Failure() : new FrameOutcome.Frame(jpeg)); }, () => Now, () => 1)
            { IntervalSeconds = interval };
        }
    }

    [Fact]
    public void N1_state_is_pure_and_a_stale_frame_drops_on_hide()
    {
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            var r = new Rig(30);
            r.Feed.BlockHidden = false; // first frame at t0
            Assert.NotNull(r.Feed.Image);
            r.Now = r.Now.AddSeconds(301);
            Assert.Equal(FrameState.NoPicture, r.Feed.State);
            Assert.Equal(FrameState.NoPicture, r.Feed.State);
            Assert.NotNull(r.Feed.Image); // reading State twice clears nothing
            r.Feed.BlockHidden = true; // hiding drops the stale frame; the time stays
            Assert.Null(r.Feed.Image);
            Assert.NotNull(r.Feed.FrameAt);
        });
    }

    [Fact]
    public void N3_resume_and_tick_during_a_fetch_make_no_second_fetch_and_the_feed_is_not_stuck()
    {
        var jpeg = Sta.Run(() => { Theme.EnsureLoaded(); return Snapshot.TestFrame(640, 360, "16:9"); });
        var gate = new TaskCompletionSource<FrameOutcome>();
        var fetches = 0;
        var feed = Sta.Run(() => new CameraFeed(_ => { fetches++; return fetches == 1 ? gate.Task : Task.FromResult<FrameOutcome>(new FrameOutcome.Frame(jpeg)); },
            () => new DateTimeOffset(2026, 1, 1, 14, 0, 0, TimeSpan.Zero), () => 1));
        Sta.Run(() =>
        {
            feed.BlockHidden = false; // resume starts fetch 1, held at the gate
            Assert.Equal(1, fetches);
            feed.WindowHidden = true; feed.WindowHidden = false; // a resume while in flight
            feed.TickAsync().GetAwaiter().GetResult(); // and a tick
            Assert.Equal(1, fetches);
            gate.SetResult(new FrameOutcome.Frame(jpeg)); // the continuation queues on the dispatcher
        });
        Sta.Run(() => { }); // runs after the queued continuation
        Sta.Run(() =>
        {
            Assert.NotNull(feed.FrameAt);
            feed.TickAsync().GetAwaiter().GetResult();
            Assert.Equal(2, fetches); // not stuck
        });
    }

    [Fact]
    public void N35_no_fetch_while_paused_and_exactly_one_on_each_resume()
    {
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            var r = new Rig();
            r.Feed.Locked = false;
            r.Feed.TickAsync().GetAwaiter().GetResult();
            Assert.Equal(0, r.Fetches); // the block starts hidden
            r.Feed.BlockHidden = false;
            Assert.Equal(1, r.Fetches); // showing it is a resume
            r.Feed.TickAsync().GetAwaiter().GetResult();
            Assert.Equal(2, r.Fetches); // the interval timer
            var pauses = new (string Name, Action<bool> Set)[]
            {
                ("minimised or hidden", v => r.Feed.WindowHidden = v), ("collapsed, folded or hidden", v => r.Feed.BlockHidden = v),
                ("client error", v => r.Feed.ClientError = v), ("locked", v => r.Feed.Locked = v), ("suspended", v => r.Feed.Suspended = v),
            };
            var log = new List<string>();
            foreach (var (name, set) in pauses)
            {
                var before = r.Fetches;
                set(true);
                r.Feed.TickAsync().GetAwaiter().GetResult();
                r.Feed.TickAsync().GetAwaiter().GetResult();
                Assert.Equal(before, r.Fetches);
                set(false);
                Assert.Equal(before + 1, r.Fetches);
                log.Add($"{name}: paused 0, resume 1");
            }
            Fix.Rec("N35 pauses", string.Join("; ", log));
            // two pauses at once: only the last release resumes
            var b2 = r.Fetches;
            r.Feed.Locked = true; r.Feed.Suspended = true; r.Feed.Locked = false;
            Assert.Equal(b2, r.Fetches);
            r.Feed.Suspended = false;
            Assert.Equal(b2 + 1, r.Fetches);
        });
    }

    [Theory]
    [InlineData(30, 60, 61, 300)]
    [InlineData(300, 600, 601, 900)]
    public void N33_frame_thresholds_through_the_feed(int i, int live, int stale, int none)
    {
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            var r = new Rig(i);
            var t0 = r.Now;
            r.Feed.BlockHidden = false; // fetches the first frame at t0
            Assert.Equal(1, r.Fetches);
            FrameState At(int s) { r.Now = t0.AddSeconds(s); return r.Feed.State; }
            Assert.Equal(FrameState.Live, At(live));
            Assert.Equal(FrameState.Stale, At(stale));
            Assert.NotNull(r.Feed.Image);
            Assert.Equal(FrameState.NoPicture, At(none));
            r.Feed.BlockHidden = true; // the pause drops the stale bitmap (State itself is pure)
            Assert.Null(r.Feed.Image); // No picture drops the bitmap
            Assert.NotNull(r.Feed.FrameAt); // and keeps the time for the line under it
            Fix.Rec($"N33 I={i}", $"{live}s live / {stale}s stale / {none}s no picture");
        });
    }

    [Fact]
    public void A_failure_keeps_the_last_frame_and_a_resume_drops_one_past_the_threshold()
    {
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            var r = new Rig();
            var t0 = r.Now;
            r.Feed.BlockHidden = false;
            r.Fail = true;
            r.Now = t0.AddSeconds(30);
            r.Feed.TickAsync().GetAwaiter().GetResult();
            Assert.NotNull(r.Feed.Image); // kept
            Assert.Equal(t0, r.Feed.FrameAt);
            r.Feed.Suspended = true;
            r.Now = t0.AddSeconds(4 * 3600);
            r.Feed.Suspended = false; // resume: the 4 hour old frame is dropped, the fetch fails
            Assert.Null(r.Feed.Image);
            Assert.Null(r.Feed.FrameAt);
            Assert.Equal(FrameState.NoPicture, r.Feed.State);
            r.Fail = false;
            r.Feed.TickAsync().GetAwaiter().GetResult();
            Assert.Equal(FrameState.Live, r.Feed.State);
        });
    }

    [Fact]
    public void N39_frame_bytes_reach_no_file_and_no_output()
    {
        string[] Files() => new[] { Path.GetTempPath(), DeskFiles.Dir }.Where(Directory.Exists)
            .SelectMany(d => Directory.GetFiles(d, "*", SearchOption.TopDirectoryOnly)).OrderBy(x => x)
            .Select(f => $"{f}|{new FileInfo(f).Length}|{File.GetLastWriteTimeUtc(f).Ticks}").ToArray();
        var before = Files();
        var stdout = Console.Out; var stderr = Console.Error;
        var sw = new StringWriter();
        Console.SetOut(sw); Console.SetError(sw);
        byte[] jpeg = [];
        try
        {
            Sta.Run(() =>
            {
                Theme.EnsureLoaded();
                var r = new Rig();
                jpeg = Snapshot.TestFrame(640, 360, "16:9");
                r.Feed.BlockHidden = false;
                r.Feed.TickAsync().GetAwaiter().GetResult();
                r.Fail = true;
                r.Feed.TickAsync().GetAwaiter().GetResult();
                _ = r.Feed.State;
            });
        }
        finally { Console.SetOut(stdout); Console.SetError(stderr); }
        var after = Files();
        Fix.Rec("N39 files before/after, output chars", $"{before.Length}/{after.Length}, {sw.ToString().Length}");
        Assert.Equal(before, after);
        Assert.Equal("", sw.ToString());
        Assert.DoesNotContain(Convert.ToBase64String(jpeg, 0, 64), sw.ToString());
    }

    // --- the collapsed flag lives in state.json beside the window's place ---
    [Fact]
    public void Collapsing_then_moving_the_window_keeps_both_and_an_old_file_loads_expanded()
    {
        var dir = Path.Combine(Path.GetTempPath(), "nwdesk-test-" + Guid.NewGuid().ToString("N"));
        var path = Path.Combine(dir, "state.json");
        try
        {
            var s = new WinState(10, 20, "top", false, null);
            s.Save(path);
            s = s with { CameraCollapsed = true };
            s.Save(path);
            s = s with { Left = 400, Top = 300, Anchor = "bottom" }; // a drag after the collapse
            s.Save(path);
            var back = WinState.Load(path)!;
            Assert.True(back.CameraCollapsed);
            Assert.Equal((400d, 300d, "bottom"), (back.Left, back.Top, back.Anchor));
            File.WriteAllText(path, "{\"Left\":10,\"Top\":20,\"Anchor\":\"top\",\"AlwaysOnTop\":false,\"WorkArea\":null}");
            Assert.False(WinState.Load(path)!.CameraCollapsed);
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }
}
