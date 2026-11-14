using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Automation.Provider;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Media;
using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

/// <summary>Slice 2 (desk-wide SHAPE, PLAN T3-T5): the shared section header, TODAY, its saved open or closed state and the fold order.</summary>
public class TodayTests
{
    static readonly DateTimeOffset At = new(2026, 1, 1, 14, 5, 0, TimeSpan.Zero);
    static string Tmp() => Path.Combine(Path.GetTempPath(), "nwdesk-test-" + Guid.NewGuid().ToString("N"));

    static FrameworkElement[] Ids(DependencyObject root, string id) =>
        Fix.Walk<FrameworkElement>(root).Where(e => AutomationProperties.GetAutomationId(e) == id).ToArray();
    static FrameworkElement One(Snapshot.Composed c, string id) => Sta.Run(() => Ids(c.View, id).Single());
    static SectionHeader Header(Snapshot.Composed c) => (SectionHeader)One(c, "today-header");
    static void Near(string n, double want, double got, double tol = 0.05) { Fix.Rec(n, got.ToString("0.###")); Assert.InRange(got, want - tol, want + tol); }
    static Rect Bounds(Snapshot.Composed c, FrameworkElement e) => e.TransformToAncestor(c.View).TransformBounds(new Rect(0, 0, e.ActualWidth, e.ActualHeight));
    static Color Ink(string key) => ((SolidColorBrush)Theme.B(key)).Color;
    static Color Of(Brush b) => ((SolidColorBrush)b).Color;
    static double Side => Theme.D("sp-lg") - Theme.D("hairline");

    static readonly string[] TodayStates = { "today-open", "today-closed", "today-no-weather", "today-no-forecast", "today-stale", "forecast-long", "today-folded" };

    static Snapshot.Composed Comp(string state, double dpi = 96) => Sta.Run(() => Fix.Compose(state, dpi));

    // A composed model: forecast-long, stale, and closed (the widest header: the label with its suffix, the clock and the temperature).
    static Snapshot.Composed ClosedStale(double dpi)
    {
        var g = Fix.Load("forecast-long");
        var m = Snapshot.ModelFor("forecast-long", g, dpi);
        var stale = new View.Stale(g, At);
        m = m with { Committed = stale, Latest = stale, Closed = ["today"], Weather = m.Weather! with { Dim = true } };
        return Sta.Run(() => Snapshot.Compose(m, dpi));
    }

    // --- T3: the closed set lives in state.json beside the window's place ---
    [Fact]
    public void An_old_state_file_without_Closed_loads_and_reads_as_empty()
    {
        var dir = Tmp();
        var path = Path.Combine(dir, "state.json");
        try
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(path, "{\"Left\":10,\"Top\":20,\"Anchor\":\"top\",\"AlwaysOnTop\":false,\"WorkArea\":null}");
            var s = WinState.Load(path)!;
            Assert.Null(s.Closed);
            Assert.False(s.CameraCollapsed);
            Assert.False(s.IsClosed("today"));
            Assert.Equal(["today"], s.WithClosed("today", true).Closed);
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    [Fact]
    public void Unknown_ids_are_kept_on_save_and_never_acted_on()
    {
        var dir = Tmp();
        var path = Path.Combine(dir, "state.json");
        try
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(path, "{\"Left\":1,\"Top\":2,\"Anchor\":\"top\",\"AlwaysOnTop\":false,\"WorkArea\":null,\"Closed\":[\"bogus\",\"today\"]}");
            var s = WinState.Load(path)!;
            Assert.True(s.IsClosed("today"));
            Assert.False(s.IsClosed("media")); // a newer widget's id is not ours to act on
            s = s.WithClosed("today", false);
            Assert.Equal(["bogus"], s.Closed);
            Assert.False(s.IsClosed("today"));
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    [Fact]
    public void WithClosed_round_trips_once_and_keeps_the_rest_of_the_state()
    {
        var dir = Tmp();
        var path = Path.Combine(dir, "state.json");
        try
        {
            var s = new WinState(10, 20, "top", false, null, CameraCollapsed: true).WithClosed("today", true).WithClosed("today", true);
            s.Save(path);
            var back = WinState.Load(path)!;
            Assert.Equal(["today"], back.Closed);
            Assert.True(back.CameraCollapsed);
            Assert.Equal((10d, 20d, "top"), (back.Left, back.Top, back.Anchor));
            Assert.False(back.WithClosed("today", false).IsClosed("today"));
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    [Fact]
    public void A_fold_is_never_a_stored_property_and_never_raises_a_toggle()
    {
        Assert.DoesNotContain(typeof(WinState).GetProperties(), p => p.Name.Contains("Fold"));
        var calls = new List<string>();
        var m = Snapshot.ModelFor("today-folded", Fix.Load("camera-3-items"));
        var c = Sta.Run(() => { var v = new DeskView(TimeZoneInfo.Utc) { SectionToggled = calls.Add }; v.Render(m with { Camera = m.Camera! with { WorkHeight = Snapshot.FoldedWorkHeight } }); return v; });
        Sta.Run(() => { Assert.True(c.TodayFolded); Assert.False(((Button)Ids(c, "today-header").Single()).IsEnabled); });
        Assert.Empty(calls);
    }

    // --- T4: the one header ---
    [Fact]
    public void SectionHeader_ids_and_peer()
    {
        var open = Comp("today-open");
        var closed = Comp("today-closed");
        var none = Comp("today-no-weather");
        Sta.Run(() =>
        {
            foreach (var id in new[] { "today-header", "today-label", "today-meta", "today-chevron" }) Assert.Single(Ids(open.View, id));
            ExpandCollapseState State(Snapshot.Composed c) =>
                ((IExpandCollapseProvider)UIElementAutomationPeer.CreatePeerForElement(Header(c)).GetPattern(PatternInterface.ExpandCollapse)!).ExpandCollapseState;
            Assert.Equal(ExpandCollapseState.Expanded, State(open));
            Assert.Equal(ExpandCollapseState.Collapsed, State(closed));
            var h = Header(none);
            var peer = UIElementAutomationPeer.CreatePeerForElement(h);
            Assert.Null(peer.GetPattern(PatternInterface.ExpandCollapse));
            Assert.Null(peer.GetPattern(PatternInterface.Invoke));
            Assert.Equal(AutomationControlType.Text, peer.GetAutomationControlType());
            Assert.False(h.Focusable);
            Assert.False(h.IsTabStop);
            Assert.Equal(Visibility.Collapsed, h.Chevron.Visibility);
        });
    }

    // --- T5 ---
    [Theory]
    [InlineData(96)]
    [InlineData(144)]
    public void N1_width_and_N2_header_height_in_every_state(double dpi)
    {
        foreach (var state in TodayStates)
        {
            var c = Sta.Run(() => Fix.Compose(state, dpi));
            Sta.Run(() => Near($"N1 width ({state} {dpi})", Theme.D("win-width"), c.View.ActualWidth, 0.01));
            Sta.Run(() => Near($"N2 header ({state} {dpi})", Theme.D("more-height"), Header(c).ActualHeight, 0.05));
        }
    }

    [Fact]
    public void N3_N6_rows_and_block_heights()
    {
        var hair = Theme.D("hairline"); var head = hair + Theme.D("more-height"); var row = Theme.D("row-height");
        var open = Comp("today-open");
        Sta.Run(() =>
        {
            Near("N3 strip", row, Ids(open.View, "weather").Single().ActualHeight);
            Near("N3 forecast row", row, Ids(open.View, "forecast").Single().ActualHeight);
        });
        foreach (var (state, want) in new[] { ("today-open", head + 2 * row), ("today-no-forecast", head + row), ("today-closed", head), ("today-no-weather", head), ("today-folded", head), ("forecast-long", head + 2 * row) })
            Near($"N6 today-block ({state})", want, One(Sta.Run(() => Fix.Compose(state)), "today-block").ActualHeight);
        Near("N2 no-weather header = open header", Sta.Run(() => Header(open).ActualHeight), Sta.Run(() => Header(Comp("today-no-weather")).ActualHeight), 0.01);
        // an id this build does not know is ignored: TODAY stays open
        var g = Fix.Load("today");
        var m = Snapshot.ModelFor("today-open", g) with { Closed = ["bogus"] };
        var unknown = Sta.Run(() => Snapshot.Compose(m, 96));
        Near("TODAY open with an unknown closed id", head + 2 * row, One(unknown, "today-block").ActualHeight);
    }

    [Fact]
    public void N4_columns_are_a_quarter_of_the_frame_and_left_aligned()
    {
        var open = Comp("today-open");
        Sta.Run(() =>
        {
            var cells = Ids(open.View, "forecast-day");
            Assert.Equal(4, cells.Length);
            foreach (var cell in cells) Near("N4 forecast column", Theme.D("frame-w") / 4, cell.ActualWidth, 0.01);
        });
        var two = Comp("forecast-long");
        Sta.Run(() =>
        {
            var cells = Ids(two.View, "forecast-day");
            Assert.Equal(2, cells.Length); // slots 3 and 4 stay blank
            Near("N4 column 1 starts at the content left", Side + Theme.D("hairline"), Bounds(two, cells[0]).Left, 0.05);
            Near("N4 column 2", Side + Theme.D("hairline") + Theme.D("frame-w") / 4, Bounds(two, cells[1]).Left, 0.05);
        });
    }

    [Theory]
    [InlineData(96)]
    [InlineData(144)]
    public void N8_label_meta_and_chevron_never_overlap(double dpi)
    {
        var px = 1 / (dpi / 96);
        foreach (var c in new[] { Sta.Run(() => Fix.Compose("forecast-long", dpi)), Sta.Run(() => Fix.Compose("today-stale", dpi)), ClosedStale(dpi) })
            Sta.Run(() =>
            {
                var gap = Theme.D("sp-base");
                var h = Header(c);
                var label = h.Label; var meta = h.Meta;
                var labelRight = Bounds(c, label).Left + label.ActualWidth;
                Fix.Rec($"N8 today header ({dpi})", $"label right {labelRight:0.#}, meta left {Bounds(c, meta).Left:0.#}, meta right {Bounds(c, meta).Right:0.#}, chevron left {Bounds(c, h.Chevron).Left:0.#}");
                Assert.True(labelRight <= Bounds(c, meta).Left - gap + px, "label reaches the meta");
                if (h.Chevron.Visibility == Visibility.Visible) Assert.True(Bounds(c, meta).Right <= Bounds(c, h.Chevron).Left + px, "meta reaches the chevron");
                meta.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                Assert.True(meta.DesiredSize.Width <= meta.ActualWidth + px, "the clock and temperature never trim");
            });
    }

    [Fact]
    public void N9_ellipsis_and_the_low_drops_when_it_does_not_fit()
    {
        foreach (var state in TodayStates)
        {
            var c = Sta.Run(() => Fix.Compose(state));
            Sta.Run(() => Assert.All(Fix.Walk<TextBlock>(Ids(c.View, "today-block").Single()), t => Assert.Equal(TextTrimming.CharacterEllipsis, t.TextTrimming)));
        }
        Visibility Low(string state, int cell) => Sta.Run(() => Fix.Walk<TextBlock>(Ids(Comp(state).View, "forecast-day")[cell]).Last().Visibility);
        Assert.Equal(Visibility.Collapsed, Low("forecast-long", 0));
        Assert.Equal(Visibility.Visible, Low("today-open", 0));
        Assert.Equal(Visibility.Visible, Low("today-open", 1)); // a null high still shows its low
    }

    [Fact]
    public void Copy_data_and_dimming()
    {
        var open = Comp("today-open");
        Sta.Run(() =>
        {
            Assert.Equal("THU 1 JAN", Header(open).Label.Text);
            Assert.Equal("14:05", string.Concat(Header(open).Meta.Inlines.OfType<Run>().Select(r => r.Text)));
            var cells = Ids(open.View, "forecast-day");
            Assert.Equal(["FRI", "SAT", "SUN", "MON"], cells.Select(x => Fix.Walk<TextBlock>(x).First().Text));
            Assert.Contains("—", Fix.Walk<TextBlock>(cells[1]).Select(t => t.Text)); // the null high
            Assert.Equal("Saturday: low 14°, rain 20%", AutomationProperties.GetName(cells[1]));
            Assert.Equal("Today, Thursday 1 January, 14:05", AutomationProperties.GetName(Header(open)));
            Assert.Equal(Copy.TodayHeaderTip(false, false), Header(open).ToolTip);
        });
        var closed = Comp("today-closed");
        Sta.Run(() =>
        {
            Assert.Equal("14:05 · 22°", string.Concat(Header(closed).Meta.Inlines.OfType<Run>().Select(r => r.Text)));
            Assert.Equal(Copy.TodayHeaderTip(true, false), Header(closed).ToolTip);
        });
        var stale = Comp("today-stale");
        Sta.Run(() =>
        {
            Assert.Equal("THU 1 JAN · AS OF 14:05", Header(stale).Label.Text);
            var cell = Ids(stale.View, "forecast-day")[0];
            Assert.Equal(Ink("ink-dim"), Of(Fix.Walk<TextBlock>(cell).First(t => t.Text.Contains('°')).Foreground)); // the high
            Assert.Equal(Ink("ink-faint"), Of(Fix.Walk<System.Windows.Shapes.Path>(cell).First().Stroke)); // the glyph
        });
        foreach (var c in new[] { stale, Comp("today-folded") })
            Sta.Run(() => Assert.Equal(Ink("ink"), Of(Header(c).Meta.Inlines.OfType<Run>().First().Foreground))); // the clock never dims
    }

    [Fact]
    public void A_changed_forecast_repaints()
    {
        var c = Comp("today-open");
        var m = Snapshot.ModelFor("today-open", Fix.Load("today"));
        Sta.Run(() =>
        {
            c.View.Render(m with { Weather = m.Weather! with { Forecast = [new("2026-01-10", "clear", 1, 1, 1)] } });
            var names = Fix.Walk<TextBlock>(Ids(c.View, "forecast").Single()).Select(t => t.Text).ToArray();
            Assert.Contains("SAT", names);
            Assert.DoesNotContain("MON", names);
        });
    }

    [Fact]
    public void Fold_order_is_camera_then_today()
    {
        var folded = Comp("today-folded");
        Sta.Run(() =>
        {
            Assert.True(folded.View.CameraFolded);
            Assert.True(folded.View.TodayFolded);
            var h = Header(folded);
            Assert.False(h.IsEnabled);
            Assert.Equal(Visibility.Collapsed, h.Chevron.Visibility);
            Assert.Equal(Copy.SectionFolded, h.ToolTip);
            Assert.Equal("14:05 · 22°", string.Concat(h.Meta.Inlines.OfType<Run>().Select(r => r.Text)));
            Assert.Equal(Ink("ink-faint"), Of(h.Meta.Inlines.OfType<Run>().Last().Foreground));
            Assert.True(folded.View.ActualHeight > 0);
            Assert.True(folded.View.ActualHeight <= Snapshot.FoldedWorkHeight - Theme.D("sp-lg"));
        });
        var cameraOnly = Comp("camera-folded"); // the 512 work area
        Sta.Run(() => { Assert.True(cameraOnly.View.CameraFolded); Assert.False(cameraOnly.View.TodayFolded); });
    }

    [Fact]
    public void Toggle_raises_today_once_and_closed_draws_the_header_only()
    {
        var open = Comp("today-open");
        var calls = new List<string>();
        Sta.Run(() =>
        {
            open.View.SectionToggled = calls.Add;
            Header(open).RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
        });
        Assert.Equal(["today"], calls);
        var m = Snapshot.ModelFor("today-open", Fix.Load("today")) with { Closed = ["today"] };
        Sta.Run(() =>
        {
            open.View.Render(m);
            open.Host.UpdateLayout();
            Near("closed block", Theme.D("hairline") + Theme.D("more-height"), Ids(open.View, "today-block").Single().ActualHeight);
            Assert.False(Header(open).Expanded);
        });
    }

    [Theory]
    [InlineData("config-missing")]
    [InlineData("offline-never-answered")]
    public void No_glance_shows_the_date_and_clock_and_no_chevron(string state)
    {
        var c = Comp(state);
        Sta.Run(() =>
        {
            var h = Header(c);
            Assert.Equal("THU 1 JAN", h.Label.Text);
            Assert.Equal("14:05", string.Concat(h.Meta.Inlines.OfType<Run>().Select(r => r.Text)));
            Assert.Equal(Visibility.Collapsed, h.Chevron.Visibility);
            Assert.False(h.IsTabStop);
            Assert.False(h.Focusable);
        });
    }
}
