using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

/// <summary>Slice 4: the HOME section (lights, climate, containers), its folds and its saved state.</summary>
public class HomeTests
{
    static FrameworkElement[] Ids(DependencyObject root, string id) =>
        Fix.Walk<FrameworkElement>(root).Where(e => AutomationProperties.GetAutomationId(e) == id).ToArray();
    static void Near(string n, double want, double got, double tol = 0.05) { Fix.Rec(n, got.ToString("0.###")); Assert.InRange(got, want - tol, want + tol); }

    static Snapshot.Composed Comp(string state, double dpi = 96) => Sta.Run(() => Fix.Compose(state, dpi));
    static Snapshot.Composed Of(Model m, double dpi = 96) => Sta.Run(() => Snapshot.Compose(m, dpi));
    static FrameworkElement One(Snapshot.Composed c, string id) => Sta.Run(() => Ids(c.View, id).Single());
    static SectionHeader Header(Snapshot.Composed c) => (SectionHeader)One(c, "home-header");
    static Color Ink(string key) => ((SolidColorBrush)Theme.B(key)).Color;
    static Color BrushOf(Brush b) => ((SolidColorBrush)b).Color;
    static Rect Bounds(Snapshot.Composed c, FrameworkElement e) => e.TransformToAncestor(c.View).TransformBounds(new Rect(0, 0, e.ActualWidth, e.ActualHeight));
    static string[] ShownIds(Snapshot.Composed c, string id) => Sta.Run(() => Ids(c.View, id).Where(Fix.Shown).Select(e => AutomationProperties.GetAutomationId(e)).ToArray());
    static TextBlock Value(Snapshot.Composed c, string id) => Sta.Run(() => Fix.Walk<TextBlock>(Ids(c.View, id).Single()).Last());
    static TextBlock Caption(Snapshot.Composed c, string id) => Sta.Run(() => Fix.Walk<TextBlock>(Ids(c.View, id).Single()).First());
    static Run[] Runs(TextBlock t) => Sta.Run(() => t.Inlines.OfType<Run>().ToArray());
    static Model ModelOf(string state, string? fixture = null) => Snapshot.ModelFor(state, Fix.Load(fixture ?? Fix.For(state)));
    static HomeNow HomeOf(string fixture, bool dim = false) { var g = Fix.Load(fixture); return new HomeNow(g.Home, g.Containers, dim); }

    static readonly string[] HomeStates = { "home-on", "home-all-off", "home-issues", "home-containers-only", "home-hidden", "home-closed", "home-stale", "home-folded" };

    [Theory]
    [InlineData(96)]
    [InlineData(144)]
    public void N1_width_and_N2_header_height_in_every_home_state(double dpi)
    {
        foreach (var state in HomeStates)
        {
            var c = Comp(state, dpi);
            Sta.Run(() => Near($"N1 width ({state} {dpi})", Theme.D("win-width"), c.View.ActualWidth, 0.01));
            if (state == "home-hidden") continue;
            Sta.Run(() => Near($"N2 header ({state} {dpi})", Theme.D("more-height"), Header(c).ActualHeight, 0.05));
        }
    }

    [Fact]
    public void N3_N6_lines_and_block_heights()
    {
        Sta.Run(Theme.EnsureLoaded);
        var head = Theme.D("hairline") + Theme.D("more-height"); var more = Theme.D("more-height");
        foreach (var (state, lines, block) in new[]
        {
            ("home-on", 3, head + 3 * more), ("home-issues", 3, head + 3 * more), ("home-all-off", 3, head + 3 * more), ("home-stale", 3, head + 3 * more),
            ("home-containers-only", 1, head + more), ("home-closed", 0, head), ("home-folded", 0, head),
        })
        {
            var c = Comp(state);
            var shown = new[] { "home-lights", "home-climate", "home-containers" }.SelectMany(id => ShownIds(c, id)).ToArray();
            Assert.Equal(lines, shown.Length);
            Sta.Run(() =>
            {
                Near($"N6 home-block ({state})", block, Ids(c.View, "home-block").Single().ActualHeight);
                foreach (var id in shown) Near($"N3 line {id} ({state})", more, Ids(c.View, id).Single().ActualHeight);
            });
        }
        Assert.Equal(129, head + 3 * more);
        var hidden = Comp("home-hidden");
        Sta.Run(() => { Assert.Equal(Visibility.Collapsed, Ids(hidden.View, "home-block").Single().Visibility); Near("N6 home-block (home-hidden)", 0, Ids(hidden.View, "home-block").Single().ActualHeight); });
    }

    [Fact]
    public void Line_order_and_copy()
    {
        var c = Comp("home-on");
        Sta.Run(() =>
        {
            Assert.Equal(new[] { "home-lights", "home-climate", "home-containers" }, Fix.Walk<FrameworkElement>(Ids(c.View, "home-block").Single()).Select(AutomationProperties.GetAutomationId).Where(i => i is "home-lights" or "home-climate" or "home-containers").ToArray());
            Assert.Equal("LIGHTS", Caption(c, "home-lights").Text);
            Assert.Equal("3 of 12 on", Value(c, "home-lights").Text);
            Assert.Equal("CLIMATE", Caption(c, "home-climate").Text);
            Assert.Equal("21.5° → 22°", Value(c, "home-climate").Text);
            Assert.Equal("CONTAINERS", Caption(c, "home-containers").Text);
            Assert.StartsWith("31 of 33 up", Value(c, "home-containers").Text);
            Assert.Equal("Den heat pump: heat, now 21.5°, set 22°", AutomationProperties.GetName(Ids(c.View, "home-climate").Single()));
            Assert.Equal("33 containers: 31 up", AutomationProperties.GetName(Ids(c.View, "home-containers").Single()));
            Assert.Equal("Lights: 3 of 12 on", ((FrameworkElement)Ids(c.View, "home-lights").Single()).ToolTip);
        });
    }

    [Fact]
    public void Hidden_when_nothing_is_usable()
    {
        var today = Snapshot.ModelFor("today-open", Fix.Load("today"));
        foreach (var hn in new[]
        {
            new HomeNow(new Home(new HomeLights(0, 0), null), null, false), // lights total 0, no climate, no containers
            new HomeNow(null, new Containers(0, 0, 0, 0, 0), false),
            new HomeNow(null, null, false),
        })
        {
            var c = Of(today with { Home = hn });
            Sta.Run(() =>
            {
                Assert.Equal(Visibility.Collapsed, Ids(c.View, "home-block").Single().Visibility);
                Assert.Empty(Ids(c.View, "home-header").Where(Fix.Shown));
            });
        }
        // an error view has no glance: whatever the model carries, HOME stays away
        var err = Of(ModelOf("wrong-token-401", "home"));
        Sta.Run(() => Assert.Equal(Visibility.Collapsed, Ids(err.View, "home-block").Single().Visibility));
    }

    [Fact]
    public void Header_press_toggles_home_and_the_closed_meta_carries_the_numbers()
    {
        var calls = new List<string>();
        Sta.Run(() =>
        {
            var v = new DeskView(TimeZoneInfo.Utc) { SectionToggled = calls.Add };
            v.Render(ModelOf("home-on"));
            var h = (SectionHeader)Ids(v, "home-header").Single();
            h.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
        });
        Assert.Equal(new[] { "home" }, calls.ToArray());

        var open = Comp("home-on");
        Sta.Run(() =>
        {
            var h = Header(open);
            Assert.Equal("", h.Meta.Text);
            Assert.Equal("HOME", h.Label.Text);
            Assert.Equal("Home", AutomationProperties.GetName(h));
            Assert.Equal("Hide home", h.ToolTip);
            Assert.Equal(90, ((RotateTransform)h.Chevron.RenderTransform).Angle);
            Assert.True(h.Expanded);
        });
        var closed = Comp("home-closed");
        Sta.Run(() =>
        {
            var h = Header(closed);
            Assert.Equal("3 on · 21.5° · 31 up", h.Meta.Text);
            Assert.Equal("Show home", h.ToolTip);
            Assert.Equal(0, ((RotateTransform)h.Chevron.RenderTransform).Angle);
            Assert.Equal(Ink("ink-dim"), BrushOf(h.Meta.Foreground));
            Assert.Empty(Ids(closed.View, "home-lights").Where(Fix.Shown));
        });
    }

    [Fact]
    public void Stale_dims_and_labels()
    {
        var stale = Comp("home-stale");
        var live = Comp("home-on");
        Sta.Run(() =>
        {
            Assert.Equal("HOME · AS OF 14:05", Header(stale).Label.Text);
            foreach (var id in new[] { "home-lights", "home-climate", "home-containers" })
            {
                Assert.Equal(Ink("ink-dim"), BrushOf(Value(stale, id).Foreground));
                Assert.Equal(Ink("ink"), BrushOf(Value(live, id).Foreground));
                Assert.Equal(Ink("ink-faint"), BrushOf(Caption(stale, id).Foreground));
            }
        });
        var issueStale = Of(ModelOf("home-stale", "home-issues"));
        Sta.Run(() => Assert.Equal(Ink("ink-dim"), BrushOf(Runs(Value(issueStale, "home-containers"))[1].Foreground)));
    }

    [Fact]
    public void N11_issue_colours_and_no_accent()
    {
        var issues = Comp("home-issues");
        var allOff = Comp("home-all-off");
        Sta.Run(() =>
        {
            var r = Runs(Value(issues, "home-containers"));
            Assert.Equal("30 of 33 up", r[0].Text);
            Assert.Equal(" · 1 dead", r[1].Text); // only the worst issue; the 2 unhealthy are in the tooltip
            Assert.Equal(Ink("bad"), BrushOf(r[1].Foreground));
            Assert.Equal("33 containers: 30 up, 1 dead, 2 unhealthy", AutomationProperties.GetName(Ids(issues.View, "home-containers").Single()));
            Assert.Equal(" · 1 restarting", Runs(Value(allOff, "home-containers"))[1].Text);
            Assert.Equal(Ink("warn"), BrushOf(Runs(Value(allOff, "home-containers"))[1].Foreground));
            Assert.Equal("All off", Value(allOff, "home-lights").Text);
            Assert.Equal(Ink("ink-dim"), BrushOf(Value(allOff, "home-lights").Foreground));
            Assert.Equal("21.5°", Value(allOff, "home-climate").Text); // heat_cool, no single target
        });
        var unhealthy = Of(ModelOf("home-on") with { Home = HomeOf("home") with { Containers = new Containers(33, 31, 0, 2, 0) } });
        Sta.Run(() => Assert.Equal(Ink("warn"), BrushOf(Runs(Value(unhealthy, "home-containers"))[1].Foreground)));
        var accent = Ink("accent");
        foreach (var state in HomeStates.Where(s => s != "home-hidden"))
        {
            var c = Comp(state);
            Sta.Run(() =>
            {
                foreach (var e in Fix.Walk<FrameworkElement>(Ids(c.View, "home-block").Single()))
                {
                    var brushes = e switch { TextBlock t => new[] { t.Foreground }.Concat(t.Inlines.OfType<Run>().Select(r => r.Foreground)).ToArray(), Border b => new[] { b.Background }, System.Windows.Shapes.Shape s => new[] { s.Fill, s.Stroke }, _ => [] };
                    foreach (var br in brushes.OfType<SolidColorBrush>()) Assert.NotEqual(accent, br.Color);
                }
            });
        }
    }

    [Fact]
    public void Fold_order_without_live_is_camera_then_home_then_today()
    {
        var folded = Comp("home-folded");
        Sta.Run(() =>
        {
            Assert.True(folded.View.CameraFolded);
            Assert.True(folded.View.HomeFolded);
            Assert.False(folded.View.MediaFolded);
            Assert.False(folded.View.TodayFolded);
            var h = Header(folded);
            Assert.False(h.IsEnabled);
            Assert.Equal(Visibility.Collapsed, h.Chevron.Visibility);
            Assert.Equal(Copy.SectionFolded, h.ToolTip);
            Assert.Equal("3 on · 21.5° · 31 up", h.Meta.Text);
            Assert.Equal(Ink("ink-faint"), BrushOf(h.Meta.Foreground));
            Assert.True(folded.View.ActualHeight <= Snapshot.FoldedWorkHeight - Theme.D("sp-lg"));
            // slice 5: 681.6 - 174 = 507.6; VITALS -54 = 453.6 is over 448: HOME -96 = 357.6
            Assert.True(folded.View.VitalsFolded);
            Near("fold height home-folded", 357.6, folded.View.ActualHeight, 1);
        });
        var cameraOnly = Of(ModelOf("home-folded") with { WorkHeight = Snapshot.CameraFoldWorkHeight });
        // slice 5: 507.6 is over 496, so VITALS folds with the camera (453.6); HOME and TODAY stay open
        Sta.Run(() => { Assert.True(cameraOnly.View.CameraFolded); Assert.True(cameraOnly.View.VitalsFolded); Assert.False(cameraOnly.View.HomeFolded); Assert.False(cameraOnly.View.TodayFolded); });
    }

    [Fact]
    public void Fold_order_with_media_and_home()
    {
        var m = Snapshot.ModelFor("media-folded", Fix.Load("media")) with { Home = HomeOf("home") };
        var c = Of(m);
        Sta.Run(() =>
        {
            Assert.True(c.View.CameraFolded); Assert.True(c.View.MediaFolded); Assert.True(c.View.HomeFolded); Assert.False(c.View.TodayFolded);
            Near("fold height media and home", 390.6, c.View.ActualHeight, 1); // slice 5: 834.6 - 174 - 54 - 120 - 96
        });
    }

    [Fact]
    public void Live_folds_media_home_today_then_ends()
    {
        var c = Of(ModelOf("camera-watch-on", "home") with { WorkHeight = Snapshot.FoldedWorkHeight });
        Sta.Run(() =>
        {
            Assert.True(c.View.HomeFolded); Assert.True(c.View.TodayFolded); Assert.False(c.View.CameraFolded);
            Near("fold height Live home", 424.6, c.View.ActualHeight, 1); // slice 5: 686.6 - 54 (VITALS) - 96 - 112
        });
        var all = Of(Snapshot.ModelFor("camera-watch-on", Fix.Load("media")) with { Home = HomeOf("home"), WorkHeight = Snapshot.FoldedWorkHeight });
        Sta.Run(() =>
        {
            Assert.True(all.View.MediaFolded); Assert.True(all.View.HomeFolded); Assert.True(all.View.TodayFolded); Assert.True(all.View.CameraFolded);
            Near("fold height Live media and home", 278.6, all.View.ActualHeight, 1); // slice 5: 839.6 - 54 - 120 - 96 - 112 = 457.6 is still over 448: Live ends (-179)
        });
    }

    [Fact]
    public void No_camera_vitals_folds_and_the_probe_never_runs_on_a_clock_tick()
    {
        var m = ModelOf("home-on");
        Assert.Null(m.Camera);
        var c = Of(m with { WorkHeight = Snapshot.FoldedWorkHeight });
        Sta.Run(() =>
        {
            Assert.False(c.View.HomeFolded); Assert.False(c.View.TodayFolded); Assert.False(c.View.CameraFolded);
            Assert.True(c.View.VitalsFolded); // slice 5: 474.6 is over 448, so VITALS (-54) folds first and 420.6 fits
            Near("home on, no camera, 464", 420.6, c.View.ActualHeight, 1);
        });
        Sta.Run(() =>
        {
            var inf = new DeskView(TimeZoneInfo.Utc);
            inf.Render(m);
            Assert.Equal(0, inf.FoldProbes);
            var v = new DeskView(TimeZoneInfo.Utc);
            var short1 = m with { WorkHeight = Snapshot.FoldedWorkHeight };
            v.Render(short1);
            v.Render(short1 with { Now = m.Now!.Value.AddMinutes(1) });
            v.Render(short1 with { Now = m.Now!.Value.AddMinutes(2) });
            Assert.Equal(1, v.FoldProbes);
        });
    }

    [Fact]
    public void A_fold_never_writes_or_toggles()
    {
        var calls = new List<string>();
        Sta.Run(() =>
        {
            var v = new DeskView(TimeZoneInfo.Utc) { SectionToggled = calls.Add };
            v.Render(ModelOf("home-folded"));
            Assert.True(v.HomeFolded);
        });
        Assert.Empty(calls);
        Assert.DoesNotContain(typeof(WinState).GetProperties(), p => p.Name.Contains("Fold") || p.Name.Contains("Home"));
    }

    [Fact]
    public void Lines_are_read_only()
    {
        foreach (var state in new[] { "home-on", "home-issues" })
        {
            var c = Comp(state);
            Sta.Run(() =>
            {
                foreach (var id in new[] { "home-lights", "home-climate", "home-containers" })
                    foreach (var e in Fix.Walk<FrameworkElement>(Ids(c.View, id).Single()))
                    {
                        Assert.False(e is System.Windows.Controls.Primitives.ButtonBase, id);
                        Assert.False(e.Focusable, id);
                    }
            });
        }
    }

    [Fact]
    public void Unknown_ids_are_kept_and_home_closes()
    {
        var c = Of(ModelOf("home-on") with { Closed = ["bogus", "home"] });
        Sta.Run(() => Near("closed block", Theme.D("hairline") + Theme.D("more-height"), Ids(c.View, "home-block").Single().ActualHeight));
        var open = Of(ModelOf("home-on") with { Closed = ["bogus"] });
        Sta.Run(() => Near("open block", 129, Ids(open.View, "home-block").Single().ActualHeight));
        var dir = Path.Combine(Path.GetTempPath(), "nwdesk-home-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "state.json");
            File.WriteAllText(path, "{\"Left\":1,\"Top\":2,\"Anchor\":\"top\",\"AlwaysOnTop\":false,\"WorkArea\":null,\"Closed\":[\"bogus\",\"home\"]}");
            var s = WinState.Load(path)!;
            Assert.True(s.IsClosed("home"));
            s = s.WithClosed("home", false);
            Assert.Equal(["bogus"], s.Closed);
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    [Theory]
    [InlineData(96)]
    [InlineData(144)]
    public void N8_label_meta_caption_and_value_never_overlap(double dpi)
    {
        foreach (var m in new[] { ModelOf("home-closed"), ModelOf("home-closed", "home-issues") })
        {
            var c = Of(m, dpi);
            Sta.Run(() =>
            {
                var h = Header(c);
                var labelRight = Bounds(c, h.Label).Left + h.Label.ActualWidth;
                Assert.True(labelRight + Theme.D("sp-base") <= Bounds(c, h.Meta).Left + 0.01, $"label {labelRight} meta {Bounds(c, h.Meta).Left}");
                Assert.True(Bounds(c, h.Meta).Right <= Bounds(c, h.Chevron).Left + 0.01);
                Assert.True(h.Meta.DesiredSize.Width <= h.Meta.ActualWidth + 1.0 / (dpi / 96), "the meta never trims");
            });
        }
        Sta.Run(() => Assert.Equal("All off · 19° · 30 up · 1 dead", Header(Of(ModelOf("home-closed", "home-issues"), dpi)).Meta.Text));
        var issues = Comp("home-issues", dpi);
        Sta.Run(() =>
        {
            foreach (var id in new[] { "home-lights", "home-climate", "home-containers" })
            {
                var cap = Caption(issues, id); var val = Value(issues, id);
                Assert.True(Bounds(issues, cap).Right + Theme.D("sp-base") <= Bounds(issues, val).Left + 0.01, id);
                Assert.True(val.DesiredSize.Width - val.Margin.Left <= val.ActualWidth + 1.0 / (dpi / 96), "the value never trims");
            }
        });
    }

    [Fact]
    public void N9_ellipsis_on_every_single_line_text()
    {
        foreach (var state in new[] { "home-issues", "home-on" })
        {
            var c = Comp(state);
            Sta.Run(() =>
            {
                var texts = Fix.Walk<TextBlock>(Ids(c.View, "home-block").Single()).Where(t => t != Header(c).Meta).ToArray();
                Assert.NotEmpty(texts);
                foreach (var t in texts)
                {
                    Assert.Equal(TextTrimming.CharacterEllipsis, t.TextTrimming);
                    Assert.Equal(TextWrapping.NoWrap, t.TextWrapping);
                }
            });
        }
    }
}
