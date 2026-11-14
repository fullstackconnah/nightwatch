using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Shapes;
using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

/// <summary>Slice 5: the VITALS section (history sparks), its folds, its saved state and the everything-open totals.</summary>
public class VitalsTests
{
    static readonly DateTimeOffset T0 = new(2026, 1, 1, 14, 5, 0, TimeSpan.Zero);
    static VitalsSample S(int i, double cpu, double mem) => new(T0.AddSeconds(30 * i), cpu, mem);

    static FrameworkElement[] Ids(DependencyObject root, string id) =>
        Fix.Walk<FrameworkElement>(root).Where(e => AutomationProperties.GetAutomationId(e) == id).ToArray();
    static void Near(string n, double want, double got, double tol = 0.05) { Fix.Rec(n, got.ToString("0.###")); Assert.InRange(got, want - tol, want + tol); }
    static double Px(double dpi) => dpi == 96 ? 0.05 : 0.7; // one device pixel at 150% is 0.67 DIP

    static Snapshot.Composed Comp(string state, double dpi = 96) => Sta.Run(() => Fix.Compose(state, dpi));
    static Snapshot.Composed Of(Model m, double dpi = 96) => Sta.Run(() => Snapshot.Compose(m, dpi));
    static Model ModelOf(string state, string? fixture = null) => Sta.Run(() => Snapshot.ModelFor(state, Fix.Load(fixture ?? Fix.For(state)))); // a camera state decodes a picture: on the UI thread
    static FrameworkElement One(Snapshot.Composed c, string id) => Sta.Run(() => Ids(c.View, id).Single());
    static SectionHeader Header(Snapshot.Composed c) => (SectionHeader)One(c, "vitals-header");
    static Color Ink(string key) => ((SolidColorBrush)Theme.B(key)).Color;
    static Color BrushOf(Brush b) => ((SolidColorBrush)b).Color;
    static Rect Bounds(Snapshot.Composed c, FrameworkElement e) => e.TransformToAncestor(c.View).TransformBounds(new Rect(0, 0, e.ActualWidth, e.ActualHeight));
    static Polyline[] Lines(Snapshot.Composed c, string slot) => Fix.Walk<Polyline>(Ids(c.View, slot).Single()).ToArray(); // call inside Sta.Run
    static double Natural(TextBlock t)
    {
        t.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        var w = t.DesiredSize.Width;
        t.InvalidateMeasure();
        return w;
    }

    [Fact]
    public void Spark_h_is_sp_xl_and_the_body_is_54()
    {
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            Assert.Equal(Theme.D("sp-xl"), Theme.D("spark-h"));
            Near("body = lh-data + sp-xs + spark-h + sp-md", 54, Theme.D("lh-data") + Theme.D("sp-xs") + Theme.D("spark-h") + Theme.D("sp-md"));
        });
    }

    // --- check 1, 2, 6: width, block and body heights ---
    [Theory]
    [InlineData(96)]
    [InlineData(144)]
    public void N1_N6_width_block_and_body_heights(double dpi)
    {
        Sta.Run(Theme.EnsureLoaded);
        var head = Theme.D("hairline") + Theme.D("more-height");
        foreach (var state in new[] { "vitals-sparks", "vitals-collecting", "vitals-flat", "vitals-null", "vitals-stale", "vitals-closed" })
        {
            var c = Comp(state, dpi);
            Sta.Run(() =>
            {
                Near($"N1 width ({state} {dpi})", Theme.D("win-width"), c.View.ActualWidth, 0.01);
                Near($"N2 header ({state} {dpi})", Theme.D("more-height"), Header(c).ActualHeight, 0.05);
                var closed = state == "vitals-closed";
                Near($"N6 vitals-block ({state} {dpi})", closed ? head : head + 54, Ids(c.View, "vitals-block").Single().ActualHeight, Px(dpi));
                if (!closed) Near($"N6 vitals-body ({state} {dpi})", 54, Ids(c.View, "vitals-body").Single().ActualHeight, 0.05);
                else Assert.Equal(Visibility.Collapsed, Ids(c.View, "vitals-body").Single().Visibility);
            });
        }
        var folded = Comp("home-folded", dpi);
        Sta.Run(() =>
        {
            Assert.True(folded.View.VitalsFolded);
            Near($"N6 vitals-block folded ({dpi})", head, Ids(folded.View, "vitals-block").Single().ActualHeight, Px(dpi));
        });
    }

    // --- check 4: columns and sparks ---
    [Theory]
    [InlineData(96)]
    [InlineData(144)]
    public void N4_columns_are_88_apart_by_100_and_the_sparks_are_88_by_spark_h(double dpi)
    {
        var c = Comp("vitals-sparks", dpi);
        Sta.Run(() =>
        {
            var body = Ids(c.View, "vitals-body").Single();
            var left = Bounds(c, body).Left;
            var col = (Theme.D("frame-w") - 2 * Theme.D("sp-md")) / 3;
            Near("N4 column width token", 88, col, 0.001);
            var i = 0;
            foreach (var id in new[] { "vitals-cpu", "vitals-mem", "vitals-disk" })
            {
                var e = Ids(c.View, id).Single();
                Near($"N4 {id} width ({dpi})", 88, e.ActualWidth, 0.5);
                Near($"N4 {id} left ({dpi})", i * (col + Theme.D("sp-md")), Bounds(c, e).Left - left, Px(dpi) + 0.01);
                Assert.Equal(TextTrimming.CharacterEllipsis, ((TextBlock)e).TextTrimming); // check 9
                i++;
            }
            foreach (var id in new[] { "vitals-spark-cpu", "vitals-spark-mem" })
            {
                var s = Ids(c.View, id).Single();
                Near($"N4 {id} width ({dpi})", 88, s.ActualWidth, 0.5);
                Near($"N4 {id} height ({dpi})", Theme.D("spark-h"), s.ActualHeight, 0.5);
            }
            Assert.Empty(Ids(c.View, "vitals-spark-disk")); // DISK has no spark
        });
    }

    [Fact]
    public void Sparks_spread_the_samples_over_the_column_on_a_fixed_0_to_100_scale()
    {
        var c = Comp("vitals-sparks");
        Sta.Run(() =>
        {
            foreach (var slot in new[] { "vitals-spark-cpu", "vitals-spark-mem" })
            {
                var p = Fix.Walk<Polyline>(Ids(c.View, slot).Single()).Single();
                Assert.Equal(24, p.Points.Count);
                Near($"{slot} first x", 0, p.Points[0].X, 0.001);
                Near($"{slot} last x", 88, p.Points[^1].X, 0.001);
                Near($"{slot} step", 88d / 23, p.Points[1].X - p.Points[0].X, 0.001);
                Assert.Equal(Theme.D("hairline"), p.StrokeThickness);
                Assert.Equal(Ink("accent"), BrushOf(p.Stroke));
            }
        });
        // three samples, so the spread is visible: 100% is hairline/2 from the top, 0% is hairline/2 from the bottom, 50% is the middle
        var m = ModelOf("vitals-sparks") with { History = [S(0, 100, 0), S(1, 50, 50), S(2, 0, 100)] };
        var two = Of(m);
        Sta.Run(() =>
        {
            var cpu = Fix.Walk<Polyline>(Ids(two.View, "vitals-spark-cpu").Single()).Single().Points;
            var mem = Fix.Walk<Polyline>(Ids(two.View, "vitals-spark-mem").Single()).Single().Points;
            var h = Theme.D("spark-h"); var hair = Theme.D("hairline");
            Near("100% y", hair / 2, cpu[0].Y, 0.001);
            Near("0% y", h - hair / 2, cpu[2].Y, 0.001);
            Near("50% y", h / 2, cpu[1].Y, 0.001);
            Near("x of the middle sample", 44, cpu[1].X, 0.001);
            Near("mem 0% y", h - hair / 2, mem[0].Y, 0.001);
            Near("mem 100% y", hair / 2, mem[2].Y, 0.001);
        });
        var over = Of(ModelOf("vitals-sparks") with { History = [S(0, 150, -20), S(1, 100, 0)] }); // clamped, never drawn outside the slot
        Sta.Run(() =>
        {
            var cpu = Fix.Walk<Polyline>(Ids(over.View, "vitals-spark-cpu").Single()).Single().Points;
            var mem = Fix.Walk<Polyline>(Ids(over.View, "vitals-spark-mem").Single()).Single().Points;
            Near("over 100 is clamped", Theme.D("hairline") / 2, cpu[0].Y, 0.001);
            Near("under 0 is clamped", Theme.D("spark-h") - Theme.D("hairline") / 2, mem[0].Y, 0.001);
        });
    }

    [Fact]
    public void Under_two_samples_the_slots_stay_empty_at_full_height_with_a_tooltip()
    {
        foreach (var state in new[] { "vitals-collecting" })
        {
            var c = Comp(state);
            Sta.Run(() =>
            {
                Assert.Empty(Fix.Walk<Polyline>(Ids(c.View, "vitals-body").Single()));
                foreach (var id in new[] { "vitals-spark-cpu", "vitals-spark-mem" }) Near($"slot {id}", Theme.D("spark-h"), Ids(c.View, id).Single().ActualHeight, 0.5);
                Assert.Equal("Collecting history", Ids(c.View, "vitals-body").Single().ToolTip);
            });
        }
        var none = Of(ModelOf("vitals-sparks") with { History = null });
        Sta.Run(() => { Assert.Empty(Fix.Walk<Polyline>(Ids(none.View, "vitals-body").Single())); Assert.Equal("Collecting history", Ids(none.View, "vitals-body").Single().ToolTip); });
        var full = Comp("vitals-sparks");
        Sta.Run(() => Assert.Null(Ids(full.View, "vitals-body").Single().ToolTip));
    }

    [Fact]
    public void Flat_history_is_a_horizontal_line()
    {
        var c = Comp("vitals-flat");
        Sta.Run(() =>
        {
            foreach (var slot in new[] { "vitals-spark-cpu", "vitals-spark-mem" })
            {
                var p = Lines(c, slot).Single();
                Assert.Equal(24, p.Points.Count);
                Assert.All(p.Points, pt => Assert.Equal(p.Points[0].Y, pt.Y));
            }
        });
    }

    [Fact]
    public void Null_vitals_is_one_centred_line_and_no_spark()
    {
        var c = Comp("vitals-null");
        Sta.Run(() =>
        {
            var body = Ids(c.View, "vitals-body").Single();
            var t = Fix.Walk<TextBlock>(body).Single();
            Assert.Equal("Host vitals unavailable", t.Text);
            Assert.Equal(TextTrimming.CharacterEllipsis, t.TextTrimming);
            Assert.Empty(Fix.Walk<Polyline>(body));
            var top = Bounds(c, t).Top - Bounds(c, body).Top;
            var bottom = Bounds(c, body).Bottom - Bounds(c, t).Bottom;
            Near("null line top gap vs bottom gap", 0, top - bottom, 1);
            Near("null body height", 54, body.ActualHeight, 0.05);
            Assert.Equal("", Header(c).Meta.Text); // open: the body says it
        });
    }

    [Fact]
    public void Stale_dims_the_captions_and_the_sparks_and_names_the_hour()
    {
        var c = Comp("vitals-stale");
        Sta.Run(() =>
        {
            foreach (var id in new[] { "vitals-cpu", "vitals-mem", "vitals-disk" })
                Assert.All(((TextBlock)Ids(c.View, id).Single()).Inlines.OfType<Run>(), r => Assert.Equal(Ink("ink-dim"), BrushOf(r.Foreground)));
            foreach (var slot in new[] { "vitals-spark-cpu", "vitals-spark-mem" })
                Assert.Equal(Ink("ink-faint"), BrushOf(Fix.Walk<Polyline>(Ids(c.View, slot).Single()).Single().Stroke));
            Assert.Equal("VITALS · AS OF 14:05", Header(c).Label.Text);
        });
        var live = Comp("vitals-sparks");
        Sta.Run(() => Assert.Equal("VITALS", Header(live).Label.Text));
    }

    [Fact]
    public void Closed_shows_the_summary_and_only_the_header_press_asks_to_toggle()
    {
        var closed = Comp("vitals-closed");
        Sta.Run(() =>
        {
            var h = Header(closed);
            Assert.Equal("CPU 12% · MEM 34% · DISK 71%", h.Meta.Text);
            Assert.Equal(Ink("ink-dim"), BrushOf(h.Meta.Foreground));
            Assert.Equal(0, ((RotateTransform)h.Chevron.RenderTransform).Angle);
            Assert.Equal(Copy.VitalsHeaderTip(true, false), h.ToolTip);
            Assert.Equal("", Header(Comp("vitals-sparks")).Meta.Text);
            Assert.Equal(90, ((RotateTransform)Header(Comp("vitals-sparks")).Chevron.RenderTransform).Angle);
        });
        var calls = new List<string>();
        Sta.Run(() =>
        {
            var v = new DeskView(TimeZoneInfo.Utc) { SectionToggled = calls.Add };
            v.Render(ModelOf("vitals-sparks"));
            ((Button)Ids(v, "vitals-header").Single()).RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
        });
        Assert.Equal(["vitals"], calls);
    }

    [Fact]
    public void Folded_shows_the_summary_in_ink_faint_and_the_header_is_disabled()
    {
        var folded = Comp("home-folded");
        Sta.Run(() =>
        {
            var h = Header(folded);
            Assert.True(folded.View.VitalsFolded);
            Assert.False(h.IsEnabled);
            Assert.Equal(Visibility.Collapsed, h.Chevron.Visibility);
            Assert.Equal(Copy.SectionFolded, h.ToolTip);
            Assert.Equal("CPU 12% · MEM 34% · DISK 71%", h.Meta.Text);
            Assert.Equal(Ink("ink-faint"), BrushOf(h.Meta.Foreground));
        });
    }

    [Theory]
    [InlineData("first-launch")]
    [InlineData("config-missing")]
    [InlineData("offline-never-answered")]
    public void No_glance_views_show_the_header_only(string state)
    {
        var c = Comp(state);
        Sta.Run(() =>
        {
            var h = Header(c);
            Assert.Equal("Host vitals unavailable", h.Meta.Text);
            Assert.False(h.Collapsible);
            Assert.Equal(Visibility.Collapsed, h.Chevron.Visibility);
            Assert.False(h.Focusable);
            Assert.False(h.IsTabStop);
            Assert.Null(h.ToolTip);
            Assert.Equal(System.Windows.Input.Cursors.Arrow, h.Cursor);
            Assert.Equal(Visibility.Collapsed, Ids(c.View, "vitals-body").Single().Visibility);
            Near($"vitals-block ({state})", Theme.D("hairline") + Theme.D("more-height"), Ids(c.View, "vitals-block").Single().ActualHeight);
            Assert.Equal(Visibility.Visible, Ids(c.View, "vitals-block").Single().Visibility);
        });
    }

    [Fact]
    public void A_clock_only_render_builds_no_spark_and_runs_no_fold_probe()
    {
        var m = ModelOf("vitals-sparks") with { WorkHeight = Snapshot.FoldedWorkHeight };
        Sta.Run(() =>
        {
            var v = new DeskView(TimeZoneInfo.Utc);
            v.Render(m);
            var line = Fix.Walk<Polyline>(Ids(v, "vitals-spark-cpu").Single()).Single();
            var mem = Fix.Walk<Polyline>(Ids(v, "vitals-spark-mem").Single()).Single();
            var probes = v.FoldProbes;
            Assert.Equal(1, probes);
            v.Render(m with { Now = m.Now!.Value.AddSeconds(1) });
            v.Render(m with { Now = m.Now!.Value.AddSeconds(2) });
            Assert.Same(line, Fix.Walk<Polyline>(Ids(v, "vitals-spark-cpu").Single()).Single());
            Assert.Same(mem, Fix.Walk<Polyline>(Ids(v, "vitals-spark-mem").Single()).Single());
            Assert.Equal(probes, v.FoldProbes);
            // a new sample is a new array: the sparks redraw, and the fold key (no sample count) is unchanged, so still no probe
            v.Render(m with { History = [.. m.History!.Skip(1), S(30, 20, 40)] });
            Assert.NotSame(line, Fix.Walk<Polyline>(Ids(v, "vitals-spark-cpu").Single()).Single());
            Assert.Equal(probes, v.FoldProbes);
            // the instance is the signal: the same samples in a new array redraw, the same array does not
            var again = Fix.Walk<Polyline>(Ids(v, "vitals-spark-cpu").Single()).Single();
            v.Render(m with { History = (VitalsSample[])m.History!.Clone() });
            Assert.NotSame(again, Fix.Walk<Polyline>(Ids(v, "vitals-spark-cpu").Single()).Single());
            Assert.Equal(probes, v.FoldProbes);
        });
    }

    [Fact]
    public void Accent_is_only_on_the_two_sparks()
    {
        foreach (var (state, sparks) in new[] { ("vitals-sparks", 2), ("vitals-stale", 0), ("vitals-closed", 0), ("vitals-null", 0) })
        {
            var c = Comp(state);
            Sta.Run(() =>
            {
                var accent = Ink("accent");
                var hits = 0;
                foreach (var e in Fix.Walk<FrameworkElement>(Ids(c.View, "vitals-block").Single()).Where(Fix.Shown)) // a closed body is built but collapsed
                {
                    var brushes = e switch { TextBlock t => new[] { t.Foreground }.Concat(t.Inlines.OfType<Run>().Select(r => r.Foreground)).ToArray(), Border b => new[] { b.Background }, Shape s => new[] { s.Fill, s.Stroke }, _ => [] };
                    var on = brushes.OfType<SolidColorBrush>().Any(br => br.Color == accent);
                    if (on) { Assert.True(e is Polyline, $"{state}: accent on {e.GetType().Name}"); hits++; }
                }
                Assert.Equal(sparks, hits);
            });
        }
    }

    [Fact]
    public void The_body_is_read_only()
    {
        foreach (var state in new[] { "vitals-sparks", "vitals-collecting", "vitals-null" })
        {
            var c = Comp(state);
            Sta.Run(() =>
            {
                var body = Ids(c.View, "vitals-body").Single();
                Assert.DoesNotContain(Fix.Walk<FrameworkElement>(body), e => e is System.Windows.Controls.Primitives.ButtonBase || e.Focusable);
                var stops = Fix.Walk<Button>(Ids(c.View, "vitals-block").Single()).Where(b => b.IsEnabled && b.Focusable && Fix.Shown(b)).ToArray();
                Assert.Equal(["vitals-header"], stops.Select(b => AutomationProperties.GetAutomationId(b)).ToArray()); // the header is the block's only stop
            });
        }
    }

    // --- check 8: the header never overlaps, at the worst case ---
    [Theory]
    [InlineData(96)]
    [InlineData(144)]
    public void N8_closed_stale_header_fits_at_100_100_100(double dpi)
    {
        var g = Fix.Load("healthy") with { Vitals = new Vitals(100, 100, 100) };
        var m = Snapshot.ModelFor("vitals-stale", g) with { Closed = ["vitals"] };
        var c = Of(m, dpi);
        Sta.Run(() =>
        {
            var h = Header(c);
            Assert.Equal("CPU 100% · MEM 100%", h.Meta.Text); // stale: DISK is dropped (PLAN-AMEND 3), the full line did not fit beside AS OF 14:05
            var labelRight = Bounds(c, h.Label).Left + Natural(h.Label);
            var meta = Bounds(c, h.Meta);
            Fix.Rec($"N8 vitals closed stale ({dpi})", $"label right {labelRight:0.#}, meta left {meta.Left:0.#}, meta '{h.Meta.Text}'");
            Assert.True(labelRight + Theme.D("sp-base") <= meta.Left + 0.01, $"label {labelRight} meta {meta.Left} ({h.Meta.Text})");
            Assert.True(h.Meta.ActualWidth >= Natural(h.Meta) - 0.5, "meta is trimmed");
            Assert.True(meta.Right <= Bounds(c, h.Chevron).Left + 0.7);
        });
    }

    // --- folds: VITALS joins the order (camera still, VITALS, MEDIA, HOME, TODAY; Live: VITALS, MEDIA, HOME, TODAY, camera) ---
    [Fact]
    public void Everything_open_still_at_1080_folds_the_camera_only()
    {
        var c = Comp("fold-order");
        Sta.Run(() =>
        {
            Assert.True(c.View.CameraFolded);
            Assert.False(c.View.VitalsFolded); Assert.False(c.View.MediaFolded); Assert.False(c.View.HomeFolded); Assert.False(c.View.TodayFolded);
            // the shape's 1003.6 leaves out the 2 DIP panel border (hairline x 2): measured 1005.6
            Near("N10 everything open, still, 1080", 1003.6 + 2 * Theme.D("hairline"), c.View.ActualHeight, 1);
            Assert.True(c.View.ActualHeight <= Snapshot.FullHdWorkHeight - Theme.D("sp-lg"));
        });
    }

    [Fact]
    public void Everything_open_live_at_1080_folds_vitals_then_media_and_keeps_live()
    {
        var c = Of(ModelOf("camera-watch-on", "everything") with { WorkHeight = Snapshot.FullHdWorkHeight });
        Sta.Run(() =>
        {
            Assert.True(c.View.VitalsFolded); Assert.True(c.View.MediaFolded);
            Assert.False(c.View.HomeFolded); Assert.False(c.View.TodayFolded); Assert.False(c.View.CameraFolded);
            Near("N10 everything open, Live, 1080", 976.6 + 2 * Theme.D("hairline"), c.View.ActualHeight, 1); // the shape's 976.6 plus the 2 DIP border
            Assert.True(c.View.ActualHeight <= Snapshot.FullHdWorkHeight - Theme.D("sp-lg"));
        });
    }

    [Fact]
    public void Everything_open_with_no_work_height_folds_nothing_and_never_probes()
    {
        var c = Comp("everything-open");
        Sta.Run(() =>
        {
            Assert.False(c.View.CameraFolded); Assert.False(c.View.VitalsFolded); Assert.False(c.View.MediaFolded); Assert.False(c.View.HomeFolded); Assert.False(c.View.TodayFolded);
            Assert.Equal(0, c.View.FoldProbes);
            Near("N10 everything open, no fold", 1177.6 + 2 * Theme.D("hairline"), c.View.ActualHeight, 1); // the shape's 1177.6 plus the 2 DIP border
            Near("N6 camera block still", 207, Ids(c.View, "camera-block").Single().ActualHeight, 1);
            Near("N6 today block", 145, Ids(c.View, "today-block").Single().ActualHeight, 1);
            Near("N6 media block", 185, Ids(c.View, "media-block").Single().ActualHeight, 1);
            Near("N6 home block", 129, Ids(c.View, "home-block").Single().ActualHeight, 1);
            Near("N6 vitals block", 87, Ids(c.View, "vitals-block").Single().ActualHeight, 1);
        });
    }

    [Fact]
    public void Everything_folded_is_the_floor_and_ends_live()
    {
        var c = Of(ModelOf("camera-watch-on", "everything") with { WorkHeight = Snapshot.FoldedWorkHeight });
        Sta.Run(() =>
        {
            Assert.True(c.View.CameraFolded); Assert.True(c.View.VitalsFolded); Assert.True(c.View.MediaFolded); Assert.True(c.View.HomeFolded); Assert.True(c.View.TodayFolded);
            Near("everything folded floor", 589.6 + 2 * Theme.D("hairline"), c.View.ActualHeight, 1); // 74.8 + 313 + 5 x 33 + 36.8 + the 2 DIP border; over 448 by design, the window clamps as today
        });
    }

    [Fact]
    public void A_fold_never_writes_and_a_header_press_is_the_only_toggle()
    {
        var calls = new List<string>();
        Sta.Run(() =>
        {
            var v = new DeskView(TimeZoneInfo.Utc) { SectionToggled = calls.Add };
            v.Render(ModelOf("home-folded"));
            Assert.True(v.VitalsFolded);
            Assert.False(((SectionHeader)Ids(v, "vitals-header").Single()).IsEnabled);
        });
        Assert.Empty(calls);
        Assert.DoesNotContain(typeof(WinState).GetProperties(), p => p.Name.Contains("Fold") || p.Name.Contains("Vitals"));
    }

    [Fact]
    public void Unknown_ids_are_kept_and_vitals_closes()
    {
        var c = Of(ModelOf("vitals-sparks") with { Closed = ["bogus", "vitals"] });
        Sta.Run(() => Near("closed block", Theme.D("hairline") + Theme.D("more-height"), Ids(c.View, "vitals-block").Single().ActualHeight));
        var open = Of(ModelOf("vitals-sparks") with { Closed = ["bogus"] });
        Sta.Run(() => Near("open block", 87, Ids(open.View, "vitals-block").Single().ActualHeight));
        var dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "nwdesk-vitals-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(dir);
            var path = System.IO.Path.Combine(dir, "state.json");
            File.WriteAllText(path, "{\"Left\":1,\"Top\":2,\"Anchor\":\"top\",\"AlwaysOnTop\":false,\"WorkArea\":null,\"Closed\":[\"bogus\",\"vitals\"]}");
            var s = WinState.Load(path)!;
            Assert.True(s.IsClosed("vitals"));
            s = s.WithClosed("vitals", false);
            Assert.Equal(["bogus"], s.Closed);
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }
}
