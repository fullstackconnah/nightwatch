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
}
