using NightwatchDesk.Core;

namespace Core.Tests;

public class HomeCopyTests
{
    static HomeClimate Cl(string mode = "heat", double? cur = 21.5, double? tgt = 22, string? name = "Den heat pump") => new(name, mode, cur, tgt);
    static Containers Co(int total = 33, int running = 31, int restarting = 0, int unhealthy = 0, int dead = 0) => new(total, running, restarting, unhealthy, dead);

    [Theory]
    [InlineData(21.5, "21.5°")]
    [InlineData(22.0, "22°")]
    [InlineData(21.46, "21.5°")]
    [InlineData(21.44, "21.4°")]
    [InlineData(-3.5, "-3.5°")]
    [InlineData(-0.04, "0°")]
    public void ClimateDeg_rounds_half_up_to_a_tenth_and_drops_a_trailing_zero(double v, string expected)
        => Assert.Equal(expected, Copy.ClimateDeg(v));

    [Fact]
    public void ClimateDeg_null_or_not_finite_is_the_null_figure()
    {
        Assert.Equal("—", Copy.ClimateDeg(null));
        Assert.Equal("—", Copy.ClimateDeg(double.NaN));
    }

    [Fact]
    public void LightsValue_counts_or_says_all_off()
    {
        Assert.Equal("3 of 12 on", Copy.LightsValue(new HomeLights(3, 12)));
        Assert.Equal("All off", Copy.LightsValue(new HomeLights(0, 12)));
    }

    [Fact]
    public void ClimateValue_covers_every_row()
    {
        Assert.Equal("21.5° → 22°", Copy.ClimateValue(Cl()));
        Assert.Equal("21.5° · off", Copy.ClimateValue(Cl("off")));
        Assert.Equal("21.5°", Copy.ClimateValue(Cl("heat_cool", tgt: null)));
        Assert.Equal("—", Copy.ClimateValue(Cl(cur: null)));
    }

    [Fact]
    public void ClimateTip_names_the_unit_and_drops_null_clauses()
    {
        Assert.Equal("Den heat pump: heat, now 21.5°, set 22°", Copy.ClimateTip(Cl()));
        Assert.Equal("Climate: heat cool, now 21.5°", Copy.ClimateTip(Cl("heat_cool", tgt: null, name: null)));
        Assert.Equal("Climate: off", Copy.ClimateTip(Cl("off", cur: null, tgt: null, name: " ")));
    }

    [Fact]
    public void ContainersValue_and_issue_pick_the_worst_one_only()
    {
        Assert.Equal("31 of 33 up", Copy.ContainersValue(Co()));
        Assert.Null(Copy.ContainersIssue(Co()));
        Assert.Equal("1 dead", Copy.ContainersIssue(Co(dead: 1, unhealthy: 2, restarting: 3)));
        Assert.Equal("2 unhealthy", Copy.ContainersIssue(Co(unhealthy: 2, restarting: 3)));
        Assert.Equal("1 restarting", Copy.ContainersIssue(Co(restarting: 1)));
    }

    [Fact]
    public void ContainersTip_drops_zero_clauses_and_says_container_once()
    {
        Assert.Equal("33 containers: 31 up, 1 dead, 2 unhealthy", Copy.ContainersTip(Co(running: 31, dead: 1, unhealthy: 2)));
        Assert.Equal("33 containers: 31 up", Copy.ContainersTip(Co()));
        Assert.Equal("1 container: 1 up", Copy.ContainersTip(Co(1, 1)));
        Assert.Equal("1 container: 1 restarting", Copy.ContainersTip(Co(1, 0, restarting: 1)));
    }

    [Fact]
    public void HomeMeta_joins_the_usable_parts()
    {
        var home = new Home(new HomeLights(3, 12), Cl());
        Assert.Equal("3 on · 21.5° · 31 up", Copy.HomeMeta(home, Co()));
        Assert.Equal("All off · 19° · 30 up · 1 dead", Copy.HomeMeta(new Home(new HomeLights(0, 12), Cl(cur: 19)), Co(running: 30, dead: 1)));
        Assert.Equal("31 up", Copy.HomeMeta(null, Co()));
        Assert.Equal("3 on · 31 up", Copy.HomeMeta(new Home(new HomeLights(3, 12), Cl(cur: null)), Co()));
        Assert.Equal("", Copy.HomeMeta(new Home(new HomeLights(0, 0), null), null));
    }

    [Fact]
    public void HomeHeaderTip_follows_the_media_wording()
    {
        Assert.Equal(Copy.SectionFolded, Copy.HomeHeaderTip(false, true));
        Assert.Equal("Show home", Copy.HomeHeaderTip(true, false));
        Assert.Equal("Hide home", Copy.HomeHeaderTip(false, false));
    }
}
