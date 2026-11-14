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
        Assert.Null(g.NowPlaying);
        Assert.Null(g.Downloads);
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
    public void Old_bodies_without_a_forecast_still_parse_with_Forecast_null()
    {
        Assert.Null(Golden().Forecast);
        var legacy = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "glance.v1-legacy.json"));
        Assert.Null(((Outcome.Ok)GlanceParser.Parse(legacy)).Glance.Forecast);
    }

    [Fact]
    public void A_forecast_parses_and_null_highs_stay_null()
    {
        var json = Fixture().Replace("\"forecast\": null", "\"forecast\": [{\"day\":\"2026-01-02\",\"icon\":\"rain\",\"highC\":null,\"lowC\":15,\"rainPct\":60}]");
        var f = Assert.Single(Assert.IsType<Outcome.Ok>(GlanceParser.Parse(json)).Glance.Forecast!);
        Assert.Equal(new ForecastDay("2026-01-02", "rain", null, 15, 60), f);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[{}]")]
    [InlineData("[{\"day\":5,\"highC\":\"hot\"}]")]
    [InlineData("\"nope\"")]
    [InlineData("{\"a\":1}")]
    public void A_bad_forecast_never_fails_the_whole_glance(string forecast)
    {
        var json = Fixture().Replace("\"forecast\": null", "\"forecast\": " + forecast);
        var g = Assert.IsType<Outcome.Ok>(GlanceParser.Parse(json)).Glance;
        Assert.Equal("bad", g.Tone);
        Assert.Empty(ForecastDay.Usable(g.Forecast));
    }

    // The media fields as the server writes them (invented titles).
    const string PlayingJson = "{\"title\":\"The Lighthouse Keeper\",\"subtitle\":\"Harbour Lights\",\"appName\":\"Jellyfin\",\"state\":\"playing\",\"progress01\":0.4}";
    const string DownloadsJson = "{\"count\":2,\"items\":[{\"name\":\"Field Recordings Vol 3\",\"progress\":0.43,\"speedBps\":2100000,\"etaS\":720},{\"name\":\"Open Lecture Series 12\",\"progress\":0.08,\"speedBps\":640000,\"etaS\":null}]}";
    static string WithMedia(string nowPlaying, string downloads) =>
        Fixture().Replace("\"nowPlaying\": null", "\"nowPlaying\": " + nowPlaying).Replace("\"downloads\": null", "\"downloads\": " + downloads);

    [Fact]
    public void Old_bodies_without_media_parse_with_both_null()
    {
        var legacy = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "glance.v1-legacy.json"));
        var g = Assert.IsType<Outcome.Ok>(GlanceParser.Parse(legacy)).Glance;
        Assert.Null(g.NowPlaying);
        Assert.Null(g.Downloads);
        Assert.Null(g.Forecast);
    }

    [Fact]
    public void Media_fields_parse()
    {
        var g = Assert.IsType<Outcome.Ok>(GlanceParser.Parse(WithMedia(PlayingJson, DownloadsJson))).Glance;
        Assert.Equal(new NowPlaying("The Lighthouse Keeper", "Harbour Lights", "Jellyfin", "playing", 0.4), g.NowPlaying);
        Assert.Equal(2, g.Downloads!.Count);
        Assert.Equal(2, g.Downloads.Items.Length);
        Assert.Equal(new DownloadItem("Field Recordings Vol 3", 0.43, 2100000, 720), g.Downloads.Items[0]);
        Assert.Null(g.Downloads.Items[1].EtaS);
    }

    [Theory]
    [InlineData("\"x\"", "null")]
    [InlineData("5", "null")]
    [InlineData("[]", "null")]
    [InlineData("{\"title\":5}", "null")]
    [InlineData("null", "\"x\"")]
    [InlineData("null", "[]")]
    [InlineData("null", "{\"count\":2,\"items\":[{\"name\":5}]}")]
    public void A_bad_media_field_never_fails_the_glance(string nowPlaying, string downloads)
    {
        var json = WithMedia(nowPlaying, downloads).Replace("\"forecast\": null", "\"forecast\": [{\"day\":\"2026-01-02\",\"icon\":\"rain\",\"highC\":null,\"lowC\":15,\"rainPct\":60}]");
        var g = Assert.IsType<Outcome.Ok>(GlanceParser.Parse(json)).Glance;
        Assert.Null(g.NowPlaying);
        Assert.Null(g.Downloads);
        Assert.Equal("bad", g.Tone);
        Assert.Single(g.Forecast!);
    }

    [Fact]
    public void A_bad_media_field_leaves_the_other_untouched()
    {
        var a = Assert.IsType<Outcome.Ok>(GlanceParser.Parse(WithMedia("\"x\"", DownloadsJson))).Glance;
        Assert.Null(a.NowPlaying);
        Assert.Equal(2, a.Downloads!.Count);
        var b = Assert.IsType<Outcome.Ok>(GlanceParser.Parse(WithMedia(PlayingJson, "{\"count\":2,\"items\":[{\"name\":5}]}"))).Glance;
        Assert.Equal("The Lighthouse Keeper", b.NowPlaying!.Title);
        Assert.Null(b.Downloads);
    }

    [Fact]
    public void Downloads_read_at_most_three_items()
    {
        var ten = string.Join(",", Enumerable.Range(1, 10).Select(i => "{\"name\":\"n" + i + "\",\"progress\":0.1,\"speedBps\":1,\"etaS\":null}"));
        var g = Assert.IsType<Outcome.Ok>(GlanceParser.Parse(WithMedia("null", "{\"count\":10,\"items\":[" + ten + "]}"))).Glance;
        Assert.Equal(3, g.Downloads!.Items.Length);
        Assert.Equal(10, g.Downloads.Count);
        Assert.Equal("n3", g.Downloads.Items[2].Name);
        var two = "[{\"name\":\"a\"},{\"name\":\"b\"}]";
        Assert.Equal(0, Assert.IsType<Outcome.Ok>(GlanceParser.Parse(WithMedia("null", "{\"count\":\"x\",\"items\":[]}"))).Glance.Downloads!.Count);
        Assert.Equal(2, Assert.IsType<Outcome.Ok>(GlanceParser.Parse(WithMedia("null", "{\"count\":\"x\",\"items\":" + two + "}"))).Glance.Downloads!.Count);
        Assert.Equal(0, Assert.IsType<Outcome.Ok>(GlanceParser.Parse(WithMedia("null", "{\"count\":-4,\"items\":[]}"))).Glance.Downloads!.Count);
        Assert.Empty(Assert.IsType<Outcome.Ok>(GlanceParser.Parse(WithMedia("null", "{\"count\":2,\"items\":\"x\"}"))).Glance.Downloads!.Items);
        var blank = Assert.IsType<Outcome.Ok>(GlanceParser.Parse(WithMedia("null", "{\"count\":2,\"items\":[{\"name\":\"  \"},{\"name\":\"b\"}]}"))).Glance;
        Assert.Equal("b", Assert.Single(blank.Downloads!.Items).Name);
    }

    [Fact]
    public void Over_long_media_strings_are_cut_again()
    {
        var long80 = new string('t', 100);
        var np = "{\"title\":\"" + long80 + "\",\"subtitle\":\"" + long80 + "\",\"appName\":\"" + new string('a', 40) + "\",\"state\":\"paused\"}";
        var dl = "{\"count\":1,\"items\":[{\"name\":\"" + new string('n', 90) + "\"}]}";
        var g = Assert.IsType<Outcome.Ok>(GlanceParser.Parse(WithMedia(np, dl))).Glance;
        var u = NowPlaying.Usable(g.NowPlaying)!;
        Assert.Equal((80, 80, 24), (u.Title!.Length, u.Subtitle!.Length, u.AppName!.Length));
        Assert.Equal(60, g.Downloads!.Items[0].Name!.Length);
    }

    [Fact]
    public void Usable_is_null_for_a_blank_title_or_an_unknown_state()
    {
        Assert.Null(NowPlaying.Usable(null));
        Assert.Null(NowPlaying.Usable(new NowPlaying("  ", null, null, "playing", null)));
        Assert.Null(NowPlaying.Usable(new NowPlaying("T", null, null, "buffering", null)));
        Assert.Null(NowPlaying.Usable(new NowPlaying(null, null, null, "playing", null)));
        Assert.NotNull(NowPlaying.Usable(new NowPlaying("T", null, null, "paused", null)));
    }

    [Fact]
    public void Forecast_reads_at_most_four_entries()
    {
        var six = string.Join(",", Enumerable.Range(1, 6).Select(i => "{\"day\":\"2026-01-0" + i + "\",\"icon\":\"rain\",\"highC\":1,\"lowC\":0,\"rainPct\":1}"));
        var json = Fixture().Replace("\"forecast\": null", "\"forecast\": [" + six + "]");
        Assert.Equal(4, Assert.IsType<Outcome.Ok>(GlanceParser.Parse(json)).Glance.Forecast!.Length);
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
