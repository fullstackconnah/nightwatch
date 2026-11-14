using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

/// <summary>Slice 3: the work height on the model (T4) and the MEDIA section (T5).</summary>
public class MediaTests
{
    static FrameworkElement[] Ids(DependencyObject root, string id) =>
        Fix.Walk<FrameworkElement>(root).Where(e => AutomationProperties.GetAutomationId(e) == id).ToArray();
    static void Near(string n, double want, double got, double tol = 0.05) { Fix.Rec(n, got.ToString("0.###")); Assert.InRange(got, want - tol, want + tol); }

    static Snapshot.Composed Comp(string state, double dpi = 96) => Sta.Run(() => Fix.Compose(state, dpi));
    static Snapshot.Composed Of(Model m, double dpi = 96) => Sta.Run(() => Snapshot.Compose(m, dpi));
    static FrameworkElement One(Snapshot.Composed c, string id) => Sta.Run(() => Ids(c.View, id).Single());
    static SectionHeader Header(Snapshot.Composed c) => (SectionHeader)One(c, "media-header");
    static Color Ink(string key) => ((SolidColorBrush)Theme.B(key)).Color;
    static Color BrushOf(Brush b) => ((SolidColorBrush)b).Color;
    static Rect Bounds(Snapshot.Composed c, FrameworkElement e) => e.TransformToAncestor(c.View).TransformBounds(new Rect(0, 0, e.ActualWidth, e.ActualHeight));
    static string[] Shown(Snapshot.Composed c, string id) => Sta.Run(() => Ids(c.View, id).Where(Fix.Shown).Select(e => AutomationProperties.GetName(e)).ToArray());
    static Model Media(string state, Func<MediaNow, MediaNow>? edit = null, string fixture = "media")
    {
        var m = Snapshot.ModelFor(state, Fix.Load(fixture));
        return edit is null ? m : m with { Media = edit(m.Media!) };
    }

    static readonly string[] MediaStates = { "media-playing", "media-paused", "media-downloads-only", "media-more", "media-long", "media-hidden", "media-stale", "media-closed", "media-folded" };

    // --- T4: Today folds with no camera ---
    [Fact]
    public void Today_folds_with_no_camera_on_a_short_work_area()
    {
        var g = Fix.Load("camera-3-items") with { Forecast = Fix.Load("today").Forecast };
        var m = Snapshot.ModelFor("today-open", g);
        Assert.Null(m.Camera);
        var c = Sta.Run(() => Snapshot.Compose(m with { WorkHeight = Snapshot.FoldedWorkHeight }, 96));
        Sta.Run(() =>
        {
            Assert.True(c.View.TodayFolded);
            Assert.False(c.View.CameraFolded);
            Assert.True(c.View.ActualHeight <= Snapshot.FoldedWorkHeight - Theme.D("sp-lg"));
            Near("T4 no-camera fold height", 386.6, c.View.ActualHeight, 1);
        });
        var open = Sta.Run(() => Snapshot.Compose(m with { WorkHeight = double.PositiveInfinity }, 96));
        Sta.Run(() => Assert.False(open.View.TodayFolded));
    }

    [Fact]
    public void No_work_height_or_nothing_to_fold_never_probes_and_a_clock_tick_reuses_the_answer()
    {
        var g = Fix.Load("camera-3-items") with { Forecast = Fix.Load("today").Forecast };
        var m = Snapshot.ModelFor("today-open", g);
        Sta.Run(() =>
        {
            var inf = new DeskView(TimeZoneInfo.Utc);
            inf.Render(m);
            Assert.Equal(0, inf.FoldProbes);
            Assert.False(inf.TodayFolded);
            // The early return must not poison the cache: a finite height afterwards still folds.
            inf.Render(m with { WorkHeight = Snapshot.FoldedWorkHeight });
            Assert.True(inf.TodayFolded);
            Assert.Equal(1, inf.FoldProbes);

            var v = new DeskView(TimeZoneInfo.Utc);
            var short1 = m with { WorkHeight = Snapshot.FoldedWorkHeight, Now = m.Now };
            v.Render(short1);
            v.Render(short1 with { Now = m.Now!.Value.AddMinutes(1) }); // a clock-only render: same fold key
            v.Render(short1 with { Now = m.Now!.Value.AddMinutes(2) });
            Assert.Equal(1, v.FoldProbes);
            v.Render(short1 with { WorkHeight = Snapshot.FoldedWorkHeight + 100 }); // a new work height is a new key
            Assert.Equal(2, v.FoldProbes);

            var nothing = new DeskView(TimeZoneInfo.Utc); // no camera, TODAY header only (no weather): nothing is foldable
            nothing.Render(Snapshot.ModelFor("today-no-weather", Fix.Load("healthy")) with { WorkHeight = Snapshot.FoldedWorkHeight });
            Assert.Equal(0, nothing.FoldProbes);
            Assert.False(nothing.TodayFolded);
        });
    }

    // --- T5: the MEDIA section ---
    [Theory]
    [InlineData(96)]
    [InlineData(144)]
    public void N1_width_and_N2_header_height_in_every_media_state(double dpi)
    {
        foreach (var state in MediaStates)
        {
            var c = Comp(state, dpi);
            Sta.Run(() => Near($"N1 width ({state} {dpi})", Theme.D("win-width"), c.View.ActualWidth, 0.01));
            if (state == "media-hidden") continue;
            Sta.Run(() => Near($"N2 header ({state} {dpi})", Theme.D("more-height"), Header(c).ActualHeight, 0.05));
        }
    }

    [Fact]
    public void N3_N6_rows_and_block_heights()
    {
        Sta.Run(Theme.EnsureLoaded); // the tokens below are read off the UI thread's resources
        var hair = Theme.D("hairline"); var head = hair + Theme.D("more-height"); var row = Theme.D("row-height"); var more = Theme.D("more-height");
        // state, now-playing rows shown, download rows shown, block height
        foreach (var (state, np, dl, block) in new[]
        {
            ("media-playing", 1, 2, head + row + 2 * more), ("media-paused", 1, 0, head + row), ("media-downloads-only", 0, 3, head + 3 * more),
            ("media-more", 1, 3, head + row + 3 * more), ("media-long", 1, 3, head + row + 3 * more), ("media-stale", 1, 2, head + row + 2 * more),
            ("media-closed", 0, 0, head), ("media-folded", 0, 0, head),
        })
        {
            var c = Comp(state);
            Assert.Equal(np, Shown(c, "now-playing").Length);
            Assert.Equal(dl, Shown(c, "download").Length);
            Sta.Run(() =>
            {
                Near($"N6 media-block ({state})", block, Ids(c.View, "media-block").Single().ActualHeight);
                foreach (var r in Ids(c.View, "now-playing").Where(Fix.Shown)) Near($"N3 now-playing row ({state})", row, r.ActualHeight);
                foreach (var r in Ids(c.View, "download").Where(Fix.Shown)) Near($"N3 download row ({state})", more, r.ActualHeight);
            });
        }
    }

    [Fact]
    public void Open_header_shows_the_count_only_when_more_downloads_exist_than_rows()
    {
        var more = Comp("media-more"); // count 5, 3 rows drawn
        Sta.Run(() =>
        {
            Assert.Equal("5 downloading", Header(more).Meta.Text);
            Near("block height stays", 185, Ids(more.View, "media-block").Single().ActualHeight);
        });
        var dlOnly = Comp("media-downloads-only"); // its fixture also has count 5 and 3 rows, so the same rule applies
        Sta.Run(() => Assert.Equal("5 downloading", Header(dlOnly).Meta.Text));
        foreach (var s in new[] { "media-playing", "media-paused", "media-long" })
        {
            var c = Comp(s);
            Sta.Run(() => Assert.Equal("", Header(c).Meta.Text));
        }
    }

    [Fact]
    public void N7_progress_bar()
    {
        var playing = Comp("media-playing");
        Sta.Run(() =>
        {
            var fill = Ids(playing.View, "progress-fill").Single();
            Near("N7 fill height", Theme.D("sp-hair"), fill.ActualHeight);
            Near("N7 fill width", 0.4 * Theme.D("frame-w"), fill.ActualWidth, 0.5);
            Assert.Equal(Ink("accent"), BrushOf(((Border)fill).Background));
        });
        Sta.Run(() => Assert.Empty(Ids(Comp("media-paused").View, "progress-fill")));
        var m = Media("media-playing", md => md with { NowPlaying = md.NowPlaying! with { State = "paused" } });
        Sta.Run(() => Assert.Equal(Ink("ink-faint"), BrushOf(((Border)Ids(Of(m).View, "progress-fill").Single()).Background)));
        var over = Media("media-playing", md => md with { NowPlaying = md.NowPlaying! with { Progress01 = 1.7 } });
        Sta.Run(() => Near("N7 fill clamps to frame-w", Theme.D("frame-w"), Ids(Of(over).View, "progress-fill").Single().ActualWidth, 0.5));
    }

    [Fact]
    public void Hidden_when_nothing_to_show()
    {
        var hidden = Comp("media-hidden");
        Sta.Run(() =>
        {
            var block = Ids(hidden.View, "media-block").Single();
            Assert.Equal(Visibility.Collapsed, block.Visibility);
            Assert.Equal(0, block.ActualHeight);
        });
        foreach (var md in new[] { new MediaNow(null, new Downloads(0, []), false), new MediaNow(new NowPlaying("  ", null, null, "playing", null), null, false), new MediaNow(new NowPlaying("T", null, null, "buffering", null), null, false) })
        {
            var c = Of(Media("media-playing") with { Media = md });
            Sta.Run(() =>
            {
                var block = Ids(c.View, "media-block").Single();
                Assert.Equal(Visibility.Collapsed, block.Visibility);
                Assert.Equal(0, block.ActualHeight);
            });
        }
    }

    [Fact]
    public void Toggle_raises_media_once_and_closed_draws_the_header_only()
    {
        var closed = Comp("media-closed");
        var open = Comp("media-playing");
        Sta.Run(() =>
        {
            var h = Header(closed);
            Assert.Equal("Playing · 2 downloading", h.Meta.Text);
            Assert.Equal(0, ((RotateTransform)h.Chevron.RenderTransform).Angle);
            Assert.Equal("Show media", h.ToolTip);
            Assert.True(h.IsEnabled);
            var o = Header(open);
            Assert.Equal("", string.Concat(o.Meta.Inlines.OfType<Run>().Select(r => r.Text)) + o.Meta.Text);
            Assert.Equal(90, ((RotateTransform)o.Chevron.RenderTransform).Angle);
            Assert.Equal("Hide media", o.ToolTip);
            Assert.Equal("Media", AutomationProperties.GetName(o));
            Assert.Equal("MEDIA", o.Label.Text);
        });
        var calls = new List<string>();
        Sta.Run(() =>
        {
            var v = new DeskView(TimeZoneInfo.Utc) { SectionToggled = calls.Add };
            v.Render(Snapshot.ModelFor("media-playing", Fix.Load("media")));
            var h = (SectionHeader)Ids(v, "media-header").Single();
            h.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
        });
        Assert.Equal(new[] { "media" }, calls.ToArray());
    }

    [Fact]
    public void Stale_dims_and_labels()
    {
        var stale = Comp("media-stale");
        var live = Comp("media-playing");
        Sta.Run(() =>
        {
            Assert.Equal("MEDIA · AS OF 14:05", Header(stale).Label.Text);
            var np = Fix.Walk<TextBlock>(Ids(stale.View, "now-playing").Single()).ToArray();
            Assert.Equal(Ink("ink-dim"), BrushOf(np[0].Foreground));
            Assert.Equal(Ink("ink-faint"), BrushOf(np[1].Foreground));
            Assert.Equal(Ink("ink-faint"), BrushOf(((Border)Ids(stale.View, "progress-fill").Single()).Background));
            Assert.Equal(Ink("ink-faint"), BrushOf(Fix.Walk<TextBlock>(Ids(stale.View, "download").First()).Last().Foreground));
            var fresh = Fix.Walk<TextBlock>(Ids(live.View, "now-playing").Single()).ToArray();
            Assert.Equal(Ink("ink"), BrushOf(fresh[0].Foreground));
            Assert.Equal(Ink("ink-dim"), BrushOf(fresh[1].Foreground));
            Assert.Equal(Ink("ink-dim"), BrushOf(Fix.Walk<TextBlock>(Ids(live.View, "download").First()).Last().Foreground));
        });
    }

    [Fact]
    public void Fold_order_is_camera_then_media_then_today()
    {
        var folded = Comp("media-folded");
        Sta.Run(() =>
        {
            Assert.True(folded.View.CameraFolded);
            Assert.True(folded.View.MediaFolded);
            Assert.False(folded.View.TodayFolded);
            var h = Header(folded);
            Assert.False(h.IsEnabled);
            Assert.Equal(Visibility.Collapsed, h.Chevron.Visibility);
            Assert.Equal(Copy.SectionFolded, h.ToolTip);
            Assert.Equal("Playing · 2 downloading", h.Meta.Text);
            Assert.Equal(Ink("ink-faint"), BrushOf(h.Meta.Foreground));
            Assert.True(folded.View.ActualHeight <= Snapshot.FoldedWorkHeight - Theme.D("sp-lg"));
            Near("fold height media-folded", 367.6, folded.View.ActualHeight, 1);
        });
        var cameraOnly = Of(Snapshot.ModelFor("media-folded", Fix.Load("media")) with { WorkHeight = Snapshot.CameraFoldWorkHeight });
        Sta.Run(() => { Assert.True(cameraOnly.View.CameraFolded); Assert.False(cameraOnly.View.MediaFolded); Assert.False(cameraOnly.View.TodayFolded); });
    }

    [Fact]
    public void Live_folds_media_then_today_before_it_ends()
    {
        var m = Snapshot.ModelFor("camera-watch-on", Fix.Load("media")) with { WorkHeight = Snapshot.FoldedWorkHeight };
        var c = Of(m);
        Sta.Run(() =>
        {
            Assert.True(c.View.MediaFolded);
            Assert.True(c.View.TodayFolded);
            Assert.False(c.View.CameraFolded);
            Near("fold height Live media", 434.6, c.View.ActualHeight, 1);
        });
    }

    [Fact]
    public void A_fold_never_writes_or_toggles()
    {
        var calls = new List<string>();
        Sta.Run(() =>
        {
            var v = new DeskView(TimeZoneInfo.Utc) { SectionToggled = calls.Add };
            v.Render(Snapshot.ModelFor("media-folded", Fix.Load("media")));
            Assert.True(v.MediaFolded);
            Assert.False(((SectionHeader)Ids(v, "media-header").Single()).IsEnabled);
        });
        Assert.Empty(calls);
        Assert.DoesNotContain(typeof(WinState).GetProperties(), p => p.Name.Contains("Fold") || p.Name.Contains("Media"));
    }

    [Theory]
    [InlineData(96)]
    [InlineData(144)]
    public void N8_label_meta_and_chevron_never_overlap(double dpi)
    {
        var m = Media("media-stale", fixture: "media-more") with { Closed = ["media"] };
        var c = Of(m, dpi);
        Sta.Run(() =>
        {
            var h = Header(c);
            var label = h.Label; var meta = h.Meta;
            var labelRight = Bounds(c, label).Left + label.ActualWidth;
            Assert.True(labelRight + Theme.D("sp-base") <= Bounds(c, meta).Left + 0.01, $"label {labelRight} meta {Bounds(c, meta).Left}");
            Assert.True(Bounds(c, meta).Right <= Bounds(c, h.Chevron).Left + 0.01);
            Assert.True(meta.DesiredSize.Width <= meta.ActualWidth + 1.0 / (dpi / 96), "the meta never trims");
        });
        var openMore = Of(Media("media-more", fixture: "media-more"), dpi); // the open header now carries "5 downloading"
        Sta.Run(() =>
        {
            var h = Header(openMore);
            Assert.Equal("5 downloading", h.Meta.Text);
            Assert.True(Bounds(openMore, h.Label).Left + h.Label.ActualWidth + Theme.D("sp-base") <= Bounds(openMore, h.Meta).Left + 0.01);
            Assert.True(Bounds(openMore, h.Meta).Right <= Bounds(openMore, h.Chevron).Left + 0.01);
            Assert.True(h.Meta.DesiredSize.Width <= h.Meta.ActualWidth + 1.0 / (dpi / 96), "the meta never trims");
        });
        var longC = Comp("media-long", dpi);
        Sta.Run(() =>
        {
            foreach (var row in Ids(longC.View, "download"))
            {
                var tbs = Fix.Walk<TextBlock>(row).ToArray();
                var (name, right) = (tbs[0], tbs[^1]);
                Assert.True(Bounds(longC, name).Right + Theme.D("sp-base") <= Bounds(longC, right).Left + 0.01);
                Assert.True(right.DesiredSize.Width - right.Margin.Left <= right.ActualWidth + 1.0 / (dpi / 96), "the right text never trims"); // DesiredSize includes the margin
            }
        });
    }

    [Fact]
    public void N9_ellipsis()
    {
        var c = Comp("media-long");
        Sta.Run(() =>
        {
            var block = Ids(c.View, "media-block").Single();
            var texts = Fix.Walk<TextBlock>(block).Where(t => t != Header(c).Meta).ToArray();
            Assert.NotEmpty(texts);
            foreach (var t in texts)
            {
                Assert.Equal(TextTrimming.CharacterEllipsis, t.TextTrimming);
                Assert.Equal(TextWrapping.NoWrap, t.TextWrapping);
            }
            var title = Fix.Walk<TextBlock>(Ids(c.View, "now-playing").Single()).First();
            var actual = title.ActualWidth;
            title.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            Assert.True(title.DesiredSize.Width > actual, "the 80-unit title trims");
        });
    }

    [Fact]
    public void N11_accent_only_on_the_fill_and_stalled_is_ink_faint()
    {
        var accent = Ink("accent");
        foreach (var state in MediaStates.Where(s => s != "media-hidden"))
        {
            var c = Comp(state);
            Sta.Run(() =>
            {
                var block = Ids(c.View, "media-block").Single();
                foreach (var e in Fix.Walk<FrameworkElement>(block))
                {
                    var brushes = e switch
                    {
                        TextBlock t => new[] { t.Foreground },
                        Border b => new[] { b.Background },
                        System.Windows.Shapes.Shape s => new[] { s.Fill, s.Stroke },
                        _ => [],
                    };
                    foreach (var br in brushes.OfType<SolidColorBrush>())
                        if (br.Color == accent) Assert.Equal("progress-fill", AutomationProperties.GetAutomationId(e));
                }
            });
        }
        var only = Comp("media-downloads-only");
        Sta.Run(() =>
        {
            var second = Ids(only.View, "download")[1]; // speed 0
            var right = Fix.Walk<TextBlock>(second).Last();
            Assert.Equal("8% · stalled", right.Text);
            Assert.Equal(Ink("ink-faint"), BrushOf(right.Foreground));
        });
    }

    [Fact]
    public void Unknown_closed_ids_leave_media_open()
    {
        var c = Of(Snapshot.ModelFor("media-playing", Fix.Load("media")) with { Closed = ["bogus"] });
        Sta.Run(() =>
        {
            Near("open block", Theme.D("hairline") + Theme.D("more-height") + Theme.D("row-height") + 2 * Theme.D("more-height"), Ids(c.View, "media-block").Single().ActualHeight);
            Assert.Equal(90, ((RotateTransform)Header(c).Chevron.RenderTransform).Angle);
        });
    }

    [Fact]
    public void Rows_are_read_only_text_with_the_tip_as_name()
    {
        var c = Comp("media-playing");
        Sta.Run(() =>
        {
            var np = Ids(c.View, "now-playing").Single();
            Assert.IsNotType<Button>(np);
            Assert.Equal("The Lighthouse Keeper\nHarbour Lights · Jellyfin", np.ToolTip);
            Assert.Equal((string)np.ToolTip, AutomationProperties.GetName(np));
            var d = Ids(c.View, "download");
            Assert.All(d, r => Assert.IsNotType<Button>(r));
            Assert.Equal("Field Recordings Vol 3, 43%, about 12 min left", d[0].ToolTip);
            Assert.Equal("Open Lecture Series 12, 8%", d[1].ToolTip);
            Assert.Empty(Fix.Walk<Button>(Ids(c.View, "media-block").Single()).Where(b => b != Header(c)));
        });
    }
}
