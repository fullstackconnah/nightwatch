using NightwatchDesk.Core;

namespace Core.Tests;

public class CopyTests
{
    // UTC+10, fixed so the tests do not depend on the machine's zone database.
    static readonly TimeZoneInfo Tz = TimeZoneInfo.CreateCustomTimeZone("t", TimeSpan.FromHours(10), "t", "t");
    static readonly DateTimeOffset T0 = new(2026, 1, 1, 4, 5, 0, TimeSpan.Zero); // 14:05 in Tz
    readonly Glance g = GlanceTests.Golden();

    [Fact]
    public void Clock_is_24h_local() => Assert.Equal("14:05", Copy.Clock(T0, Tz));

    [Fact]
    public void Live_uses_the_server_answer_and_the_probe_line_at_checkedAt()
    {
        var v = new View.Live(g);
        Assert.Equal(g.Answer, Copy.Head(v));
        Assert.Null(Copy.Note(v));
        Assert.Equal("5 of 7 checks answered at 00:05", Copy.Footer(v, Tz)); // 14:05:30Z + 10 h
    }

    [Fact]
    public void FirstLaunch_copy()
    {
        var v = new View.FirstLaunch();
        Assert.Equal("Checking the box…", Copy.Head(v));
        Assert.Equal("Asking nightwatch…", Copy.Footer(v, Tz));
    }

    [Fact]
    public void Stale_keeps_the_last_answer_and_says_since_when()
    {
        var v = new View.Stale(g, T0);
        Assert.Equal(g.Answer, Copy.Head(v));
        Assert.Equal("No answer since 14:05", Copy.Footer(v, Tz));
        Assert.Equal("as of 14:05", Copy.AsOf(T0, Tz));
        Assert.Equal("No answer yet", Copy.Footer(new View.Stale(null, null), Tz));
        Assert.Equal("Checking the box…", Copy.Head(new View.Stale(null, null)));
    }

    [Fact]
    public void Offline_copy()
    {
        Assert.Equal("Can't get an answer from the box right now", Copy.Head(new View.Offline(g, T0)));
        Assert.Equal("No answer since 14:05", Copy.Footer(new View.Offline(g, T0), Tz));
        Assert.Equal("No answer yet", Copy.Footer(new View.Offline(null, null), Tz));
    }

    [Fact]
    public void Client_error_copy_is_exact()
    {
        Assert.Equal("Desk isn't set up yet", Copy.Head(new View.Config(new ConfigResult.Missing())));
        Assert.Equal(@"Run desk\install.ps1, or create desk.json in " + string.Join("\u2060", @"%APPDATA%\NightwatchDesk".ToCharArray()) + " with baseUrl and token. Then choose Refresh.", Copy.Note(new View.Config(new ConfigResult.Missing())));
        Assert.Equal("desk.json can't be read", Copy.Head(new View.Config(new ConfigResult.Unreadable(3))));
        Assert.Equal("It isn't valid JSON (line 3). Fix it, then choose Refresh.", Copy.Note(new View.Config(new ConfigResult.Unreadable(3))));
        Assert.Equal("Desk token missing", Copy.Head(new View.Config(new ConfigResult.TokenMissing())));
        Assert.Equal("Set \"token\" in desk.json to the desk token from nightwatch's config. Then choose Refresh.", Copy.Note(new View.Config(new ConfigResult.TokenMissing())));
        Assert.Equal("nightwatch address isn't valid", Copy.Head(new View.Config(new ConfigResult.BadAddress())));
        Assert.Equal("Set \"baseUrl\" in desk.json to a full address, like http://homelab.local:3005. Then choose Refresh.", Copy.Note(new View.Config(new ConfigResult.BadAddress())));
        Assert.Equal("nightwatch refused the desk token", Copy.Head(new View.WrongToken(T0)));
        Assert.Equal("The token in desk.json doesn't match the server's. Replace it, then choose Refresh.", Copy.Note(new View.WrongToken(T0)));
        Assert.Equal("Refused at 14:05", Copy.Footer(new View.WrongToken(T0), Tz));
        Assert.Equal("Desk access is off on nightwatch", Copy.Head(new View.DeskOff(T0)));
        Assert.Equal("Set system.deskToken on the server: 32 or more characters, different from the MCP token.", Copy.Note(new View.DeskOff(T0)));
        Assert.Equal("Refused at 14:05", Copy.Footer(new View.DeskOff(T0), Tz));
        Assert.Equal("Nightwatch Desk needs an update", Copy.Head(new View.ServerTooNew(3)));
        Assert.Equal("The server sends format v3. Pull origin/main and re-run the desk install.", Copy.Note(new View.ServerTooNew(3)));
        Assert.Null(Copy.Footer(new View.ServerTooNew(3), Tz));
    }

    [Fact]
    public void Probe_line_totals_answered_failed_and_pending()
        => Assert.Equal("5 of 7 checks answered at 14:05", Copy.ProbeLine(new Probes(5, 1, 1), T0, Tz));

    [Fact]
    public void Tooltip_is_the_head_with_as_of_in_Stale_and_never_over_63()
    {
        Assert.Equal("Checking the box…", Copy.Tooltip(new View.FirstLaunch(), Tz));
        var short_ = g with { Answer = "All clear." };
        Assert.Equal("All clear. (as of 14:05)", Copy.Tooltip(new View.Stale(short_, T0), Tz));
        var t = Copy.Tooltip(new View.Live(g with { Answer = new string('x', 100) }), Tz);
        Assert.Equal(63, t.Length);
        Assert.EndsWith("…", t);
        Assert.True(Copy.Tooltip(new View.Stale(g with { Answer = new string('x', 100) }, T0), Tz).Length <= 63);
    }

    [Fact]
    public void Trim_adds_an_ellipsis_within_the_limit_and_keeps_short_text()
    {
        Assert.Equal("abc", Copy.Trim("abc", 3));
        Assert.Equal("ab…", Copy.Trim("abcd", 3));
        // never splits a surrogate pair
        var cut = Copy.Trim("ab\U0001F600cd", 4);
        Assert.Equal("ab…", cut);
    }
}
