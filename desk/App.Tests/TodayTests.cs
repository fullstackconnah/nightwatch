using NightwatchDesk.App;

namespace NightwatchDesk.App.Tests;

public class TodayTests
{
    static string Tmp() => Path.Combine(Path.GetTempPath(), "nwdesk-test-" + Guid.NewGuid().ToString("N"));

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
    public void A_fold_is_never_a_stored_property()
    {
        Assert.DoesNotContain(typeof(WinState).GetProperties(), p => p.Name.Contains("Fold"));
    }
}
