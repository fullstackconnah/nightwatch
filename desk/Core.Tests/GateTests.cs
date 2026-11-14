using NightwatchDesk.Core;

namespace Core.Tests;

public class GateTests
{
    DateTimeOffset now = new(2026, 1, 1, 4, 0, 0, TimeSpan.Zero);
    readonly Gate gate;
    readonly Glance g = GlanceTests.Golden();
    public GateTests() => gate = new Gate(() => now);
    void Pass(int sec) => now = now.AddSeconds(sec);

    View Live(Glance x) => new View.Live(x);
    Glance MoreRows() => g with { Items = g.Items.Append(g.Items[0] with { Id = "x", Headline = "New" }).ToArray() };

    [Fact]
    public void First_offer_commits()
    {
        Assert.True(gate.Offer(Live(g)));
        Assert.NotNull(gate.Committed);
    }

    [Fact]
    public void Held_pointer_keeps_rows_and_shows_update_held()
    {
        var first = Live(g);
        gate.Offer(first);
        gate.SetPointer(true);
        Assert.False(gate.Offer(Live(MoreRows())));
        Assert.Same(first, gate.Committed);
        Assert.True(gate.UpdateHeld);
    }

    [Fact]
    public void Leaving_commits_the_waiting_update()
    {
        gate.Offer(Live(g));
        gate.SetPointer(true);
        var next = Live(MoreRows());
        gate.Offer(next);
        Assert.True(gate.SetPointer(false));
        Assert.Same(next, gate.Committed);
        Assert.False(gate.UpdateHeld);
    }

    [Theory]
    [InlineData("focus")]
    [InlineData("menu")]
    public void Focus_and_menu_hold_the_gate_too_and_release_commits(string which)
    {
        gate.Offer(Live(g));
        void Set(bool on) { if (which == "focus") gate.SetFocus(on); else gate.SetMenu(on); }
        Set(true);
        Assert.False(gate.Offer(Live(MoreRows())));
        Set(false);
        Assert.False(gate.UpdateHeld);
        Assert.Equal(3, ((View.Live)gate.Committed!).Glance.Items.Length);
    }

    [Fact]
    public void A_pointer_still_for_30s_commits_on_the_next_offer_or_release()
    {
        gate.Offer(Live(g));
        gate.SetPointer(true);
        gate.Offer(Live(MoreRows()));
        Pass(29);
        Assert.False(gate.Release());
        Pass(1);
        Assert.True(gate.Release());
        Assert.Equal(3, ((View.Live)gate.Committed!).Glance.Items.Length);
    }

    [Fact]
    public void A_moving_pointer_restarts_the_still_clock()
    {
        gate.Offer(Live(g));
        gate.SetPointer(true);
        gate.Offer(Live(MoreRows()));
        Pass(25);
        gate.Touch();
        Pass(25);
        Assert.False(gate.Release());
        Assert.True(gate.UpdateHeld);
    }

    [Fact]
    public void Footer_and_vitals_changes_pass_while_held_because_they_move_nothing()
    {
        gate.Offer(Live(g));
        gate.SetPointer(true);
        var next = Live(g with { CheckedAt = g.CheckedAt.AddSeconds(30), Vitals = new Vitals(50, 50, 50) });
        Assert.True(gate.Offer(next));
        Assert.Same(next, gate.Committed);
        Assert.False(gate.UpdateHeld);
    }

    [Fact]
    public void Live_to_Stale_with_the_same_rows_is_a_restyle_not_a_hold()
    {
        gate.Offer(Live(g));
        gate.SetPointer(true);
        var stale = new View.Stale(g, now);
        Assert.True(gate.Offer(stale));
        Assert.IsType<View.Stale>(gate.Committed);
    }

    [Fact]
    public void Latest_tracks_every_offer_even_when_held()
    {
        gate.Offer(Live(g));
        gate.SetPointer(true);
        var next = Live(MoreRows());
        gate.Offer(next);
        Assert.Same(next, gate.Latest);
    }

    [Fact]
    public void A_later_offer_with_the_committed_rows_drops_the_waiting_update()
    {
        gate.Offer(Live(g));
        gate.SetPointer(true);
        gate.Offer(Live(MoreRows()));
        gate.Offer(Live(g));
        Assert.False(gate.UpdateHeld);
    }
}

public class TrayAndPollAndPlacementTests
{
    static readonly Glance G = GlanceTests.Golden();

    [Theory]
    [InlineData("ok", TrayKind.Live)]
    [InlineData("pending", TrayKind.Checking)]
    [InlineData("warn", TrayKind.NeedsWarn)]
    [InlineData("bad", TrayKind.NeedsBad)]
    public void Tray_follows_the_tone(string tone, TrayKind kind)
        => Assert.Equal(kind, TrayState.Of(new View.Live(G with { Tone = tone })));

    [Fact]
    public void Tray_for_the_other_views()
    {
        var t = DateTimeOffset.UnixEpoch;
        Assert.Equal(TrayKind.Checking, TrayState.Of(new View.FirstLaunch()));
        Assert.Equal(TrayKind.NoAnswer, TrayState.Of(new View.Stale(G, t)));
        Assert.Equal(TrayKind.NoAnswer, TrayState.Of(new View.Offline(null, null)));
        Assert.Equal(TrayKind.FixDesk, TrayState.Of(new View.Config(new ConfigResult.Missing())));
        Assert.Equal(TrayKind.FixDesk, TrayState.Of(new View.WrongToken(t)));
        Assert.Equal(TrayKind.FixDesk, TrayState.Of(new View.DeskOff(t)));
        Assert.Equal(TrayKind.FixDesk, TrayState.Of(new View.ServerTooNew(2)));
    }

    [Fact]
    public void Poll_maps_statuses()
    {
        Assert.IsType<Outcome.Ok>(Poll.Map(200, GlanceTests.Fixture()));
        Assert.IsType<Outcome.Failed>(Poll.Map(200, "<html>"));
        Assert.IsType<Outcome.Unauthorized>(Poll.Map(401, ""));
        Assert.IsType<Outcome.Off>(Poll.Map(503, ""));
        Assert.IsType<Outcome.Failed>(Poll.Map(500, ""));
        Assert.IsType<Outcome.Failed>(Poll.Map(404, ""));
        Assert.IsType<Outcome.Failed>(Poll.Map(302, ""));
    }

    static readonly Box Screen1 = new(0, 0, 1920, 1040);
    static readonly Box Screen2 = new(1920, 0, 1280, 1000);

    [Fact]
    public void Default_is_top_right_inset()
        => Assert.Equal(new Box(1920 - 16 - 320, 16, 320, 157), Placement.Default(Screen1, 320, 157, 16));

    [Fact]
    public void A_window_inside_a_work_area_is_unchanged()
    {
        var w = new Box(100, 100, 320, 200);
        Assert.Equal(w, Placement.Clamp(w, new[] { Screen1, Screen2 }, Screen1, 16));
    }

    [Fact]
    public void A_removed_monitor_clamps_into_the_nearest_work_area()
    {
        var w = new Box(2500, 50, 320, 200); // was on screen 2, which is gone
        var r = Placement.Clamp(w, new[] { Screen1 }, Screen1, 16);
        Assert.Equal(Placement.Default(Screen1, 320, 200, 16), r);
    }

    [Fact]
    public void A_partly_off_window_is_pulled_in()
    {
        var w = new Box(1800, 900, 320, 200);
        var r = Placement.Clamp(w, new[] { Screen1 }, Screen1, 16);
        Assert.Equal(new Box(1600, 840, 320, 200), r);
    }

    [Fact]
    public void WorkAreaOf_window_inside_one_area_gives_that_area()
    {
        Assert.Equal(Screen2, Placement.WorkAreaOf(new Box(2000, 100, 320, 200), new[] { Screen1, Screen2 }));
    }

    [Fact]
    public void WorkAreaOf_window_taller_than_the_short_secondary_gives_the_secondary()
    {
        var tall = new Box(2000, 0, 320, 1030);
        Assert.Equal(Screen2, Placement.WorkAreaOf(tall, new[] { Screen1, Screen2 }));
    }

    [Fact]
    public void WorkAreaOf_straddling_window_gives_the_larger_overlap()
    {
        Assert.Equal(Screen1, Placement.WorkAreaOf(new Box(1700, 100, 320, 200), new[] { Screen1, Screen2 }));
        Assert.Equal(Screen2, Placement.WorkAreaOf(new Box(1800, 100, 320, 200), new[] { Screen1, Screen2 }));
    }

    [Fact]
    public void WorkAreaOf_no_overlap_gives_null()
    {
        Assert.Null(Placement.WorkAreaOf(new Box(5000, 0, 320, 200), new[] { Screen1, Screen2 }));
    }

    [Fact]
    public void Growth_anchor_follows_the_half_of_the_work_area()
    {
        Assert.True(Placement.GrowsDown(new Box(0, 100, 320, 100), Screen1));
        Assert.False(Placement.GrowsDown(new Box(0, 700, 320, 100), Screen1));
    }
}
