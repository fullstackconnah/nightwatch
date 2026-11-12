using NightwatchDesk.Core;

namespace Core.Tests;

public class GlanceTests
{
    internal static string Fixture() => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "glance.v1.json"));
    internal static Glance Golden() => ((Outcome.Ok)GlanceParser.Parse(Fixture())).Glance;

    [Fact]
    public void Golden_fixture_parses_every_field()
    {
        var g = Golden();
        Assert.Equal(1, g.V);
        Assert.Equal(new DateTimeOffset(2026, 1, 1, 14, 5, 30, TimeSpan.Zero), g.CheckedAt);
        Assert.Equal("bad", g.Tone);
        Assert.Equal("4 things need you. First: Disk /data is almost full", g.Answer);
        var lane = Assert.Single(g.Lanes);
        Assert.Equal(new GlanceItem("orchestra:orchestra", "warn", "dev-lead is waiting for you", "Usually a permission prompt", null, null, "/orchestrators"), lane);
        Assert.Equal(2, g.Items.Length);
        Assert.Equal(new GlanceItem("disks:/data", "bad", "Disk /data is almost full", "97% used", "Free some space", "2026-01-01T13:00:00.000Z", "/resources?metric=disk"), g.Items[0]);
        Assert.Equal(new GlanceItem("backup:backup", "warn", "Backup is late", null, null, null, "/#backup"), g.Items[1]);
        Assert.Equal(new Probes(5, 1, 1), g.Probes);
        Assert.Equal(new Vitals(12, 34, 71), g.Vitals);
    }

    [Fact]
    public void Unknown_keys_are_ignored_and_vitals_may_be_null()
    {
        var json = Fixture().Replace("\"v\": 1,", "\"v\": 1, \"newThing\": {\"a\": 1},").Replace("\"cpu\": 12", "\"cpu\": 12, \"gpu\": 3");
        Assert.IsType<Outcome.Ok>(GlanceParser.Parse(json));
        var nullVitals = Fixture().Substring(0, Fixture().IndexOf("\"vitals\"")) + "\"vitals\": null}";
        Assert.Null(((Outcome.Ok)GlanceParser.Parse(nullVitals)).Glance.Vitals);
    }

    [Fact]
    public void Newer_version_is_TooNew_not_a_parse()
        => Assert.Equal(new Outcome.TooNew(2), GlanceParser.Parse("{\"v\":2,\"somethingNew\":[1]}"));

    [Theory]
    [InlineData("")]
    [InlineData("{not json")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{\"v\":1}")]
    [InlineData("{\"answer\":\"x\"}")]
    [InlineData("{\"v\":\"1\"}")]
    public void Malformed_or_incomplete_is_Failed_never_an_exception(string json)
        => Assert.IsType<Outcome.Failed>(GlanceParser.Parse(json));

    [Fact]
    public void Null_input_is_Failed() => Assert.IsType<Outcome.Failed>(GlanceParser.Parse(null!));
}
