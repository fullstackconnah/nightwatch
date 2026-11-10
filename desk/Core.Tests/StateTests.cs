using NightwatchDesk.Core;

namespace Core.Tests;

public class StateTests
{
    DateTimeOffset now = new(2026, 1, 1, 4, 0, 0, TimeSpan.Zero);
    readonly DeskState s;
    readonly Glance g = GlanceTests.Golden();
    public StateTests() => s = new DeskState(() => now);
    void Pass(int sec) => now = now.AddSeconds(sec);

    [Fact]
    public void Starts_as_FirstLaunch() => Assert.IsType<View.FirstLaunch>(s.Current);

    [Fact]
    public void Ok_is_Live_with_the_glance()
        => Assert.Equal(new View.Live(g), s.Apply(new Outcome.Ok(g)));

    [Fact]
    public void Stale_after_90s_without_success_keeping_glance_and_client_time()
    {
        var t0 = now;
        s.Apply(new Outcome.Ok(g));
        Pass(89);
        Assert.IsType<View.Live>(s.Current);
        Pass(1);
        Assert.Equal(new View.Stale(g, t0), s.Current);
    }

    [Fact]
    public void Three_failures_in_a_row_is_Offline_and_wins_over_Stale()
    {
        var t0 = now;
        s.Apply(new Outcome.Ok(g));
        Pass(100);
        s.Apply(new Outcome.Failed());
        s.Apply(new Outcome.Failed());
        Assert.IsType<View.Stale>(s.Current);
        Assert.Equal(new View.Offline(g, t0), s.Apply(new Outcome.Failed()));
    }

    [Fact]
    public void Success_clears_Stale_and_Offline()
    {
        s.Apply(new Outcome.Ok(g));
        for (var i = 0; i < 3; i++) s.Apply(new Outcome.Failed());
        Assert.IsType<View.Offline>(s.Current);
        Assert.IsType<View.Live>(s.Apply(new Outcome.Ok(g)));
        Pass(95);
        Assert.IsType<View.Stale>(s.Current);
        Assert.IsType<View.Live>(s.Apply(new Outcome.Ok(g)));
    }

    [Fact]
    public void A_success_resets_the_failure_run()
    {
        s.Apply(new Outcome.Failed());
        s.Apply(new Outcome.Failed());
        s.Apply(new Outcome.Ok(g));
        s.Apply(new Outcome.Failed());
        Assert.IsType<View.Live>(s.Current);
    }

    [Fact]
    public void Never_answered_goes_Stale_after_90s_and_Offline_after_three_failures_with_no_glance()
    {
        Pass(89);
        Assert.IsType<View.FirstLaunch>(s.Current);
        Pass(1);
        Assert.Equal(new View.Stale(null, null), s.Current);
        for (var i = 0; i < 3; i++) s.Apply(new Outcome.Failed());
        Assert.Equal(new View.Offline(null, null), s.Current);
    }

    [Fact]
    public void Unauthorized_and_Off_are_replies_not_failures_and_carry_no_glance()
    {
        s.Apply(new Outcome.Ok(g));
        for (var i = 0; i < 2; i++) s.Apply(new Outcome.Failed());
        var at = now;
        Assert.Equal(new View.WrongToken(at), s.Apply(new Outcome.Unauthorized()));
        Assert.Equal(new View.DeskOff(at), s.Apply(new Outcome.Off()));
        // the failure run was reset and the old glance dropped
        s.Apply(new Outcome.Failed());
        s.Apply(new Outcome.Failed());
        Assert.IsType<View.FirstLaunch>(s.Current);
        Assert.IsType<View.Live>(s.Apply(new Outcome.Ok(g)));
    }

    [Fact]
    public void Repeated_Unauthorized_stays_WrongToken()
    {
        for (var i = 0; i < 5; i++) s.Apply(new Outcome.Unauthorized());
        Assert.IsType<View.WrongToken>(s.Current);
    }

    [Fact]
    public void TooNew_is_ServerTooNew()
        => Assert.Equal(new View.ServerTooNew(2), s.Apply(new Outcome.TooNew(2)));

    [Fact]
    public void Config_error_wins_until_config_is_ok()
    {
        s.Apply(new Outcome.Ok(g));
        var bad = new ConfigResult.TokenMissing();
        s.SetConfig(bad);
        Assert.Equal(new View.Config(bad), s.Current);
        s.SetConfig(new ConfigResult.Ok("http://h:1", "t"));
        Assert.IsType<View.Live>(s.Current);
    }
}
